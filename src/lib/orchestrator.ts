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

// Vague terms that indicate ambiguity
const VAGUE_TERMS = [
  'это', 'там', 'тут', 'то', 'такое', 'нормально',
  'красиво', 'быстро', 'лучше', 'правильно',
  'как надо', 'как обычно', 'стандартно',
  'this', 'that', 'it', 'better', 'nice', 'properly',
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

  let confidence = 0.5;
  if (hasSpecificTarget) confidence += 0.3;
  if (!hasVagueTerms) confidence += 0.2;
  if (scope) confidence += 0.1;

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
export async function detectAmbiguities(
  input: string,
  intent: ParsedIntent
): Promise<Ambiguity[]> {
  const ambiguities: Ambiguity[] = [];
  const lowerInput = input.toLowerCase();

  // Check for vague reference terms
  for (const term of VAGUE_TERMS) {
    if (lowerInput.includes(term)) {
      ambiguities.push({
        type: 'reference',
        term,
        question: `Что конкретно вы имеете в виду под "${term}"?`,
        candidates: [],
        severity: 'medium',
      });
    }
  }

  // Check for missing scope
  if (!intent.scope && ['create', 'modify', 'delete'].includes(intent.action)) {
    ambiguities.push({
      type: 'scope',
      term: intent.action,
      question: `Какой масштаб изменений для "${intent.action}"?`,
      candidates: ['Минимальный (только указанное)', 'Умеренный (+ связанное)', 'Полный (весь проект)'],
      severity: 'medium',
    });
  }

  // Check for technical ambiguity in implementation requests
  if (intent.action === 'create' && lowerInput.match(/авториз|auth|логин|login/)) {
    ambiguities.push({
      type: 'technical',
      term: 'authorization',
      question: 'Какой тип авторизации использовать?',
      candidates: ['JWT tokens', 'Session-based', 'OAuth (Google/GitHub)', 'Все вместе'],
      severity: 'high',
    });
  }

  // Check for missing target in fix requests
  if (intent.action === 'fix' && intent.object === 'target') {
    ambiguities.push({
      type: 'reference',
      term: 'bug',
      question: 'Какую именно проблему нужно исправить?',
      candidates: [],
      severity: 'high',
    });
  }

  return ambiguities;
}

// Generate clarification questions from ambiguities
export function generateClarificationQuestions(
  ambiguities: Ambiguity[]
): ClarificationRequest | null {
  if (ambiguities.length === 0) return null;

  const questions: ClarificationQuestion[] = ambiguities
    .filter(a => a.severity !== 'low')
    .slice(0, 3) // Max 3 questions at a time
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

  // Check for architecture keywords
  const needsArchitecture = /архитектур|структур|дизайн|design|implement.*system|создать.*проект/i.test(input);

  // Estimate complexity
  let complexity: 'simple' | 'medium' | 'complex' = 'simple';
  let estimatedSubtasks = 1;

  if (needsArchitecture) {
    complexity = 'complex';
    estimatedSubtasks = 5;
  } else if (lowerInput.match(/несколько|multiple|добавь.*и.*и|create.*and.*and/)) {
    complexity = 'medium';
    estimatedSubtasks = 3;
  } else if (intent.scope === 'full') {
    complexity = 'medium';
    estimatedSubtasks = 4;
  }

  // Determine execution mode
  let recommendedMode: ExecutionMode = 'single';

  if (complexity === 'complex' || needsArchitecture) {
    recommendedMode = 'council';
  } else if (estimatedSubtasks >= 3) {
    recommendedMode = 'swarm';
  } else if (intent.action === 'analyze' || intent.action === 'fix') {
    recommendedMode = 'deliberation';
  }

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
  classification: ReturnType<typeof classifyTask>
): ExecutionPlan {
  const phases: ExecutionPhase[] = [];
  const availableModels = getAvailableModels().filter(m => m.available);

  const getProviders = (): ModelProvider[] => {
    const providers: ModelProvider[] = [];
    if (availableModels.some(m => m.provider === 'claude')) providers.push('claude');
    if (availableModels.some(m => m.provider === 'openai')) providers.push('openai');
    if (availableModels.some(m => m.provider === 'gemini')) providers.push('gemini');
    if (availableModels.some(m => m.provider === 'qwen')) providers.push('qwen');
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

  // Main execution phase
  if (classification.recommendedMode === 'swarm' && classification.estimatedSubtasks >= 3) {
    phases.push({
      id: 'phase-swarm',
      mode: 'swarm',
      name: 'Parallel Implementation (Swarm)',
      status: 'pending',
      models: ['claude'], // Swarm uses Claude agents
      progress: 0,
    });
  } else {
    phases.push({
      id: 'phase-single',
      mode: 'single',
      name: 'Implementation',
      status: 'pending',
      models: ['claude'],
      progress: 0,
    });
  }

  // Add deliberation for quality review
  if (classification.complexity !== 'simple' && availableModels.length >= 2) {
    phases.push({
      id: 'phase-deliberation',
      mode: 'deliberation',
      name: 'Quality Review (Deliberation)',
      status: 'pending',
      models: ['claude', 'openai'],
      progress: 0,
    });
  }

  return {
    id: `plan-${Date.now()}`,
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

  // Get votes from each model in parallel
  const votePromises = models.map(async (provider) => {
    const model = availableModels.find(m => m.provider === provider && m.available);
    if (!model) return { provider, vote: null };

    const response = await generateWithModel(
      provider,
      model.apiModel,
      `You are participating in a council vote. Answer concisely.

Question: ${question}

Provide your recommendation in 1-2 sentences. Be specific about your choice.`,
      'You are an expert AI assistant participating in an architecture council.'
    );

    return { provider, vote: response.content };
  });

  const results = await Promise.all(votePromises);

  for (const { provider, vote } of results) {
    if (vote) votes[provider] = vote;
  }

  // Simple winner determination (first model's answer for now)
  const winner = Object.values(votes)[0] || 'No consensus';

  // Synthesize final answer
  const synthesis = Object.entries(votes)
    .map(([model, vote]) => `${model}: ${vote}`)
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

    // Generate/improve code
    const genPrompt = i === 0
      ? `Task: ${task}\n\nGenerate the code to accomplish this task.`
      : `Task: ${task}\n\nPrevious code:\n${code}\n\nReview feedback: improve the code based on the feedback.`;

    const genResponse = await generateWithModel(
      generatorProvider,
      generator.apiModel,
      genPrompt,
      'You are an expert programmer. Write clean, well-documented code.'
    );
    code = genResponse.content;

    // If no reviewer available, accept after first iteration
    if (!reviewer) {
      approved = true;
      break;
    }

    // Review code
    const reviewResponse = await generateWithModel(
      reviewerProvider,
      reviewer.apiModel,
      `Review this code for bugs, security issues, and improvements:

${code}

Respond with either:
- "APPROVED" if the code is good
- Or list specific issues to fix`,
      'You are a senior code reviewer. Be thorough but constructive.'
    );

    approved = reviewResponse.content.toUpperCase().includes('APPROVED');
  }

  return { code, iterations, approved };
}
