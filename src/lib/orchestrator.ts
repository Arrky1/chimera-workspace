import {
  ParsedIntent,
  Ambiguity,
  ClarificationQuestion,
  ClarificationRequest,
  ExecutionPlan,
  ExecutionPhase,
  ExecutionMode,
  ModelProvider,
} from '@/types';
import { generateWithModel, getAvailableModels, getBestModelForTask } from './models';

// Vague terms that indicate ambiguity - only truly ambiguous phrases
const VAGUE_TERMS = [
  'как надо', 'как обычно', 'стандартно',
  'the button', 'the form', 'the page',
];

const SCOPE_INDICATORS = {
  broad: ['везде', 'все', 'полностью', 'целиком', 'everywhere', 'all', 'entire'],
  narrow: ['только', 'именно', 'конкретно', 'один', 'only', 'just', 'specific'],
};

// Parse user input to extract intent
export async function parseIntent(input: string): Promise<ParsedIntent> {
  const lowerInput = input.toLowerCase();

  // Detect action
  let action: ParsedIntent['action'] = 'create';
  if (lowerInput.match(/исправ|fix|bug|ошибк|error/)) action = 'fix';
  else if (lowerInput.match(/удали|delete|remove|убери/)) action = 'delete';
  else if (lowerInput.match(/измени|update|modify|обнови|поменяй/)) action = 'modify';
  else if (lowerInput.match(/объясни|explain|расскаж|what is/)) action = 'explain';
  else if (lowerInput.match(/анализ|analyze|проверь|review/)) action = 'analyze';
  else if (lowerInput.match(/добав|create|сделай|add|implement|напиши/)) action = 'create';

  // Detect scope
  let scope: ParsedIntent['scope'];
  if (SCOPE_INDICATORS.broad.some(s => lowerInput.includes(s))) {
    scope = 'full';
  } else if (SCOPE_INDICATORS.narrow.some(s => lowerInput.includes(s))) {
    scope = 'minimal';
  }

  // Calculate confidence based on clarity
  const hasVagueTerms = VAGUE_TERMS.some(term => lowerInput.includes(term));
  const hasSpecificTarget = /\b(файл|file|функци|function|компонент|component|страниц|page)\s+\w+/i.test(input);

  // Start with high confidence - only reduce for truly ambiguous requests
  let confidence = 0.9;
  if (hasVagueTerms) confidence -= 0.3;
  if (hasSpecificTarget) confidence += 0.05;
  if (scope) confidence += 0.05;

  return {
    action,
    object: extractObject(input),
    scope,
    confidence: Math.min(confidence, 1),
  };
}

function extractObject(input: string): string {
  // Try to extract the main object/target from the request
  const patterns = [
    /(?:файл|file)\s+["']?([^"'\s]+)["']?/i,
    /(?:функци[юя]|function)\s+["']?(\w+)["']?/i,
    /(?:компонент|component)\s+["']?(\w+)["']?/i,
    /(?:страниц[у|а]|page)\s+["']?(\w+)["']?/i,
    /(?:кнопк[у|а]|button)\s+["']?([^"'\s]+)["']?/i,
    /(?:форм[у|а]|form)\s+["']?([^"'\s]+)["']?/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }

  return 'target';
}

// Detect ambiguities in the request
// POLICY: Almost never ask clarification. Only for dangerous destructive operations.
// For everything else — just do the task, make reasonable assumptions.
export async function detectAmbiguities(
  input: string,
  intent: ParsedIntent
): Promise<Ambiguity[]> {
  const ambiguities: Ambiguity[] = [];

  // ONLY ask for confirmation on destructive "delete all" operations
  if (!intent.scope && intent.action === 'delete' && /все|весь|целиком|полностью|all|entire/i.test(input)) {
    ambiguities.push({
      type: 'scope',
      term: intent.action,
      question: 'Подтвердите масштаб удаления:',
      candidates: ['Только указанные элементы', 'Всё связанное (включая зависимости)', 'Полная очистка'],
      severity: 'high',
    });
  }

  // For everything else — NO clarification. Just act.
  return ambiguities;
}

// Generate clarification questions from ambiguities
export function generateClarificationQuestions(
  ambiguities: Ambiguity[]
): ClarificationRequest | null {
  if (ambiguities.length === 0) return null;

  const questions: ClarificationQuestion[] = ambiguities
    .filter(a => a.severity === 'high')
    .slice(0, 2) // Max 2 critical questions
    .map((amb, idx) => ({
      id: `q-${idx}`,
      question: amb.question,
      type: amb.type,
      options: amb.candidates.map((c, i) => ({
        value: `opt-${i}`,
        label: c,
        recommended: i === 0,
      })),
      allowCustom: true,
    }));

  if (questions.length === 0) return null;

  return {
    questions,
    context: 'Для корректного выполнения задачи, пожалуйста, уточните:',
  };
}

// Classify task complexity and determine execution mode
export function classifyTask(intent: ParsedIntent, input: string): {
  complexity: 'simple' | 'medium' | 'complex';
  recommendedMode: ExecutionMode;
  estimatedSubtasks: number;
  needsArchitecture: boolean;
} {
  const lowerInput = input.toLowerCase();
  const inputLength = input.length;

  // Check for architecture keywords
  const needsArchitecture = /архитектур|структур|дизайн|design|implement.*system|создать.*проект|refactor|рефакторинг/i.test(input);

  // Detect multi-part tasks
  const isMultiPart = /несколько|multiple|добавь.*и.*и|create.*and.*and|а также|а ещё|а еще|кроме того|плюс|и ещё|и еще/i.test(lowerInput);

  // Detect analysis/review tasks (benefit from multiple perspectives)
  const isAnalysisTask = /анализ|ревизи|review|проверь|оцени|сравни|compare|audit|аудит|оптимиз|optimize/i.test(lowerInput);

  // Detect coding tasks that benefit from team
  const isCodingTask = /напиши|создай|реализуй|implement|write|build|сделай|разработай|develop|добавь функци|add feature/i.test(lowerInput);

  // Detect research tasks
  const isResearchTask = /исследуй|research|найди.*способ|find.*way|предложи.*вариант|suggest|объясни.*как|explain.*how/i.test(lowerInput);

  // Estimate complexity based on multiple signals
  let complexity: 'simple' | 'medium' | 'complex' = 'simple';
  let estimatedSubtasks = 1;

  if (needsArchitecture) {
    complexity = 'complex';
    estimatedSubtasks = 5;
  } else if (isMultiPart) {
    complexity = 'medium';
    estimatedSubtasks = 3;
  } else if (intent.scope === 'full') {
    complexity = 'medium';
    estimatedSubtasks = 4;
  } else if (isAnalysisTask && inputLength > 50) {
    // Нетривиальные аналитические запросы → средняя сложность (команда)
    complexity = 'medium';
    estimatedSubtasks = 3;
  } else if (isCodingTask && inputLength > 80) {
    // Развёрнутые задачи по коду → средняя сложность
    complexity = 'medium';
    estimatedSubtasks = 3;
  } else if (isResearchTask) {
    complexity = 'medium';
    estimatedSubtasks = 2;
  }

  // Determine execution mode
  let recommendedMode: ExecutionMode = 'single';

  if (complexity === 'complex' || needsArchitecture) {
    recommendedMode = 'council';
  } else if (complexity === 'medium') {
    // Средняя сложность → всегда swarm (задействуем команду)
    recommendedMode = 'swarm';
    // Убедимся что достаточно подзадач для swarm
    if (estimatedSubtasks < 2) estimatedSubtasks = 2;
  } else if (intent.action === 'analyze' || intent.action === 'fix') {
    recommendedMode = 'deliberation';
  }

  console.log(`[Classify] "${input.slice(0, 60)}..." → complexity=${complexity}, mode=${recommendedMode}, subtasks=${estimatedSubtasks}`);

  return {
    complexity,
    recommendedMode,
    estimatedSubtasks,
    needsArchitecture,
  };
}

// Create execution plan
export function createExecutionPlan(
  intent: ParsedIntent,
  classification: ReturnType<typeof classifyTask>,
  originalMessage: string // Now required!
): ExecutionPlan {
  const phases: ExecutionPhase[] = [];
  const availableModels = getAvailableModels().filter(m => m.available);

  const getProviders = (): ModelProvider[] => {
    const providers: ModelProvider[] = [];
    if (availableModels.some(m => m.provider === 'claude')) providers.push('claude');
    if (availableModels.some(m => m.provider === 'openai')) providers.push('openai');
    if (availableModels.some(m => m.provider === 'gemini')) providers.push('gemini');
    if (availableModels.some(m => m.provider === 'qwen')) providers.push('qwen');
    if (availableModels.some(m => m.provider === 'deepseek')) providers.push('deepseek');
    return providers;
  };

  // Add council phase for architecture decisions
  if (classification.needsArchitecture) {
    phases.push({
      id: 'phase-council',
      mode: 'council',
      name: 'Architecture Decision (Council)',
      status: 'pending',
      models: getProviders(),
      progress: 0,
    });
  }

  // Determine best model for the task type
  const taskType = intent.action === 'analyze' ? 'analysis' : 'code';
  const bestModel = getBestModelForTask(taskType, availableModels);
  const bestProvider: ModelProvider = bestModel?.provider || 'claude';

  // Main execution phase
  // Swarm: при рекомендации swarm И наличии 2+ доступных провайдеров
  const availableProviders = getProviders();
  if (classification.recommendedMode === 'swarm' && availableProviders.length >= 2) {
    phases.push({
      id: 'phase-swarm',
      mode: 'swarm',
      name: 'Parallel Implementation (Swarm)',
      status: 'pending',
      models: availableProviders,
      progress: 0,
    });
  } else {
    phases.push({
      id: 'phase-single',
      mode: 'single',
      name: 'Implementation',
      status: 'pending',
      models: [bestProvider],
      progress: 0,
    });
  }

  // Add deliberation for quality review — pick two different models
  if (classification.complexity !== 'simple' && availableModels.length >= 2) {
    const allProviders = getProviders();
    const reviewModel1 = bestProvider;
    const reviewModel2 = allProviders.find(p => p !== bestProvider) || allProviders[0];
    phases.push({
      id: 'phase-deliberation',
      mode: 'deliberation',
      name: 'Quality Review (Deliberation)',
      status: 'pending',
      models: [reviewModel1, reviewModel2],
      progress: 0,
    });
  }

  return {
    id: `plan-${Date.now()}`,
    originalMessage, // Store the original request!
    phases,
    estimatedModels: phases.reduce((sum, p) => sum + p.models.length, 0),
    currentPhase: 0,
    status: 'planning',
  };
}

// Execute council mode (voting)
export async function executeCouncil(
  question: string,
  models: ModelProvider[]
): Promise<{ votes: Record<ModelProvider, string>; winner: string; synthesis: string }> {
  const availableModels = getAvailableModels();
  const votes: Record<string, string> = {};

  console.log(`[Council] Starting with ${models.length} models: ${models.join(', ')}`);
  const availableList = availableModels.filter(m => m.available).map(m => `${m.provider}/${m.apiModel}`);
  console.log(`[Council] Available models: ${availableList.join(', ')}`);

  // Get votes from each model in parallel
  const votePromises = models.map(async (provider) => {
    const model = availableModels.find(m => m.provider === provider && m.available);
    if (!model) {
      console.log(`[Council] ${provider}: NOT AVAILABLE — skipping`);
      return { provider, vote: null };
    }

    console.log(`[Council] ${provider}: calling ${model.apiModel}...`);
    const response = await generateWithModel(
      provider,
      model.apiModel,
      `Ты участвуешь в голосовании консилиума. Отвечай кратко на русском.

Вопрос: ${question}

Дай рекомендацию в 1-2 предложениях. Будь конкретен.`,
      'Ты — эксперт AI-ассистент. Отвечай кратко и по делу на русском. ЗАПРЕЩЕНО выдавать блоки кода. Максимум 150 слов.',
      { maxTokens: 1000 }
    );

    if (response.status === 'error') {
      console.log(`[Council] ${provider}: ERROR — ${response.error}`);
      return { provider, vote: null };
    }

    console.log(`[Council] ${provider}: OK (${response.content.length} chars)`);
    return { provider, vote: response.content };
  });

  const results = await Promise.all(votePromises);

  for (const { provider, vote } of results) {
    if (vote) votes[provider] = vote;
  }

  const votedCount = Object.keys(votes).length;
  console.log(`[Council] Results: ${votedCount}/${models.length} voted (${Object.keys(votes).join(', ')})`);

  // Simple winner determination (first model's answer for now)
  const winner = Object.values(votes)[0] || 'No consensus';

  // Synthesize final answer
  const synthesis = Object.entries(votes)
    .map(([model, vote]) => `**${model}:** ${vote}`)
    .join('\n\n');

  return { votes: votes as Record<ModelProvider, string>, winner, synthesis };
}

// Execute deliberation mode (generator + reviewer)
export async function executeDeliberation(
  task: string,
  generatorProvider: ModelProvider = 'claude',
  reviewerProvider: ModelProvider = 'openai',
  maxIterations: number = 3
): Promise<{ code: string; iterations: number; approved: boolean }> {
  const availableModels = getAvailableModels();
  const generator = availableModels.find(m => m.provider === generatorProvider && m.available);
  const reviewer = availableModels.find(m => m.provider === reviewerProvider && m.available);

  if (!generator) throw new Error(`Generator model ${generatorProvider} not available`);

  let code = '';
  let approved = false;
  let iterations = 0;

  for (let i = 0; i < maxIterations && !approved; i++) {
    iterations++;

    // Generate/improve — КРАТКО, без полных модулей
    const genPrompt = i === 0
      ? `Задача: ${task}\n\nДай КРАТКИЙ ответ: ключевые решения, план, фрагменты кода (до 20 строк). НЕ пиши полные модули.`
      : `Задача: ${task}\n\nПредыдущий ответ:\n${code}\n\nОтзыв ревьюера. Улучши ответ. Будь КРАТОК — максимум 300 слов.`;

    const genResponse = await generateWithModel(
      generatorProvider,
      generator.apiModel,
      genPrompt,
      'Ты — эксперт-разработчик. Давай КРАТКИЕ, конкретные ответы. Максимум 300 слов. ЗАПРЕЩЕНО выдавать блоки кода (```). Только текстовые заключения, выводы и рекомендации простыми словами.',
      { maxTokens: 2000 }
    );
    code = genResponse.content;

    // If no reviewer available, accept after first iteration
    if (!reviewer) {
      approved = true;
      break;
    }

    // Review — тоже кратко
    const reviewResponse = await generateWithModel(
      reviewerProvider,
      reviewer.apiModel,
      `Проверь этот ответ на корректность и полноту:

${code.slice(0, 2000)}

Ответь:
- "APPROVED" если ответ хороший
- Или КРАТКО (до 100 слов) укажи что исправить`,
      'Ты — ревьюер. Будь кратким. Максимум 100 слов.',
      { maxTokens: 500 }
    );

    approved = reviewResponse.content.toUpperCase().includes('APPROVED');
  }

  return { code, iterations, approved };
}

// Execute debate mode (pro vs con with judge)
export async function executeDebate(
  question: string,
  proProvider: ModelProvider = 'claude',
  conProvider: ModelProvider = 'openai',
  judgeProvider: ModelProvider = 'qwen',
  rounds: number = 2
): Promise<{
  arguments: { model: ModelProvider; position: 'pro' | 'con'; argument: string; round: number }[];
  verdict: string;
  reasoning: string;
}> {
  const availableModels = getAvailableModels();
  const proModel = availableModels.find(m => m.provider === proProvider && m.available);
  const conModel = availableModels.find(m => m.provider === conProvider && m.available);
  const judgeModel = availableModels.find(m => m.provider === judgeProvider && m.available);

  if (!proModel || !conModel) {
    throw new Error('Need at least 2 models for debate');
  }

  const debateArgs: { model: ModelProvider; position: 'pro' | 'con'; argument: string; round: number }[] = [];
  let previousArguments = '';

  // Conduct debate rounds
  for (let round = 1; round <= rounds; round++) {
    // PRO argument
    const proPrompt = round === 1
      ? `You are arguing IN FAVOR of the following position. Make your strongest case.

Question: ${question}

Provide 2-3 compelling arguments supporting this position.`
      : `You are arguing IN FAVOR. Counter the opposing arguments and strengthen your position.

Question: ${question}

Previous arguments:
${previousArguments}

Provide your rebuttal and additional supporting arguments.`;

    const proResponse = await generateWithModel(
      proProvider,
      proModel.apiModel,
      proPrompt,
      'You are a skilled debater arguing FOR the position. Be persuasive but honest.'
    );

    debateArgs.push({
      model: proProvider,
      position: 'pro',
      argument: proResponse.content,
      round,
    });

    previousArguments += `\n\n[PRO Round ${round}]: ${proResponse.content}`;

    // CON argument
    const conPrompt = round === 1
      ? `You are arguing AGAINST the following position. Make your strongest case.

Question: ${question}

Previous PRO argument:
${proResponse.content}

Provide 2-3 compelling arguments against this position.`
      : `You are arguing AGAINST. Counter the supporting arguments.

Question: ${question}

Previous arguments:
${previousArguments}

Provide your rebuttal and additional opposing arguments.`;

    const conResponse = await generateWithModel(
      conProvider,
      conModel.apiModel,
      conPrompt,
      'You are a skilled debater arguing AGAINST the position. Be persuasive but honest.'
    );

    debateArgs.push({
      model: conProvider,
      position: 'con',
      argument: conResponse.content,
      round,
    });

    previousArguments += `\n\n[CON Round ${round}]: ${conResponse.content}`;
  }

  // Judge's verdict
  let verdict = 'PRO'; // default
  let reasoning = 'Based on the arguments presented.';

  if (judgeModel) {
    const judgeResponse = await generateWithModel(
      judgeProvider,
      judgeModel.apiModel,
      `You are an impartial judge evaluating a debate.

Question being debated: ${question}

Full debate transcript:
${previousArguments}

Evaluate both sides fairly and provide:
1. Your verdict: PRO or CON (which side made the stronger case)
2. Brief reasoning (2-3 sentences)

Format your response as:
VERDICT: [PRO/CON]
REASONING: [your explanation]`,
      'You are a fair and impartial judge. Evaluate arguments on their merit, logic, and evidence.'
    );

    const verdictMatch = judgeResponse.content.match(/VERDICT:\s*(PRO|CON)/i);
    const reasoningMatch = judgeResponse.content.match(/REASONING:\s*(.+)/is);

    verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'PRO';
    reasoning = reasoningMatch ? reasoningMatch[1].trim() : judgeResponse.content;
  } else {
    // Without judge, count argument strength (simplified)
    reasoning = 'No judge model available. Defaulting to PRO based on first-mover advantage.';
  }

  return { arguments: debateArgs, verdict, reasoning };
}

// Advanced council with weighted voting and synthesis
export async function executeAdvancedCouncil(
  question: string,
  context: string,
  models: ModelProvider[]
): Promise<{
  votes: { model: ModelProvider; vote: string; reasoning: string; confidence: number }[];
  consensus: number;
  synthesizedAnswer: string;
}> {
  const availableModels = getAvailableModels();
  const votes: { model: ModelProvider; vote: string; reasoning: string; confidence: number }[] = [];

  // Get votes from each model
  const votePromises = models.map(async (provider) => {
    const model = availableModels.find(m => m.provider === provider && m.available);
    if (!model) return null;

    const response = await generateWithModel(
      provider,
      model.apiModel,
      `You are participating in an architecture council. Analyze the question and provide your expert recommendation.

Context: ${context}

Question: ${question}

Respond in this format:
RECOMMENDATION: [your specific recommendation]
REASONING: [2-3 sentences explaining why]
CONFIDENCE: [HIGH/MEDIUM/LOW]`,
      'You are a senior architect. Provide thoughtful, well-reasoned recommendations.'
    );

    const recMatch = response.content.match(/RECOMMENDATION:\s*(.+?)(?=REASONING:|$)/is);
    const reasonMatch = response.content.match(/REASONING:\s*(.+?)(?=CONFIDENCE:|$)/is);
    const confMatch = response.content.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);

    const confidenceMap: Record<string, number> = { HIGH: 0.9, MEDIUM: 0.7, LOW: 0.5 };

    return {
      model: provider,
      vote: recMatch ? recMatch[1].trim() : response.content,
      reasoning: reasonMatch ? reasonMatch[1].trim() : '',
      confidence: confMatch ? confidenceMap[confMatch[1].toUpperCase()] || 0.7 : 0.7,
    };
  });

  const results = await Promise.all(votePromises);
  for (const result of results) {
    if (result) votes.push(result);
  }

  // Calculate consensus (how similar the votes are)
  const uniqueVotes = new Set(votes.map(v => v.vote.substring(0, 50).toLowerCase()));
  const consensus = 1 - (uniqueVotes.size - 1) / votes.length;

  // Synthesize final answer using the lead model (Claude)
  const leadModel = availableModels.find(m => m.provider === 'claude' && m.available);
  let synthesizedAnswer = votes[0]?.vote || 'No consensus reached';

  if (leadModel && votes.length > 1) {
    const synthesisPrompt = `As Lead Architect, synthesize these council votes into a final recommendation:

${votes.map(v => `**${v.model}** (confidence: ${v.confidence}):
${v.vote}
Reasoning: ${v.reasoning}`).join('\n\n---\n\n')}

Provide a unified recommendation that incorporates the best insights from each expert.`;

    const synthesisResponse = await generateWithModel(
      'claude',
      leadModel.apiModel,
      synthesisPrompt,
      'You are Alex, Lead Architect. Synthesize team input into a clear, actionable recommendation.'
    );

    synthesizedAnswer = synthesisResponse.content;
  }

  return { votes, consensus, synthesizedAnswer };
}
