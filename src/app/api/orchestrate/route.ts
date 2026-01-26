import { NextRequest, NextResponse } from 'next/server';
import {
  parseIntent,
  detectAmbiguities,
  generateClarificationQuestions,
  classifyTask,
  createExecutionPlan,
  executeCouncil,
  executeDeliberation,
  executeDebate,
  executeAdvancedCouncil,
} from '@/lib/orchestrator';
import { getTeamManager } from '@/lib/team';
import { getToolDescriptions, parseToolCalls, executeToolCalls } from '@/lib/mcp';
import { generateWithModel, getAvailableModels, getBestModelForTask } from '@/lib/models';
import { ExecutionPlan, ModelProvider } from '@/types';

// Rate limiting for parallel requests
const MAX_CONCURRENT_REQUESTS = 3;
const REQUEST_DELAY_MS = 500;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// Helper: retry with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES,
  initialDelay = INITIAL_RETRY_DELAY_MS
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on client errors (4xx)
      if (lastError.message.includes('401') || lastError.message.includes('403')) {
        throw lastError;
      }

      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1} after ${delay}ms: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Helper: execute with rate limiting
async function executeWithRateLimit<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent = MAX_CONCURRENT_REQUESTS
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < tasks.length; i += maxConcurrent) {
    const batch = tasks.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(batch.map(task => withRetry(task)));
    results.push(...batchResults);

    // Add delay between batches
    if (i + maxConcurrent < tasks.length) {
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, clarificationAnswers, confirmedPlan } = body;

    // If we have clarification answers, process them and continue
    if (clarificationAnswers) {
      return handleClarificationResponse(message, clarificationAnswers);
    }

    // If plan is confirmed, execute it
    if (confirmedPlan) {
      return handlePlanExecution(confirmedPlan);
    }

    // Initial message processing
    return handleInitialMessage(message);
  } catch (error) {
    console.error('Orchestrator error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function handleInitialMessage(message: string) {
  // 1. Parse intent
  const intent = await parseIntent(message);

  // 2. Detect ambiguities
  const ambiguities = await detectAmbiguities(message, intent);

  // 3. If high confidence and no critical ambiguities, proceed directly
  if (intent.confidence >= 0.85 && ambiguities.filter(a => a.severity === 'high').length === 0) {
    return proceedWithExecution(message, intent);
  }

  // 4. Generate clarification questions
  const clarificationRequest = generateClarificationQuestions(ambiguities);

  if (clarificationRequest) {
    return NextResponse.json({
      type: 'clarification',
      message: 'Для корректного выполнения задачи, пожалуйста, уточните детали:',
      clarification: clarificationRequest,
      intent,
    });
  }

  // 5. No ambiguities found, proceed
  return proceedWithExecution(message, intent);
}

async function handleClarificationResponse(originalMessage: string, answers: Record<string, string>) {
  // Re-parse with clarified context
  const clarifiedContext = Object.values(answers).join('. ');
  const enrichedMessage = `${originalMessage}\n\nУточнения: ${clarifiedContext}`;

  const intent = await parseIntent(enrichedMessage);
  intent.confidence = 0.95; // Bump confidence since we have clarifications

  return proceedWithExecution(enrichedMessage, intent);
}

async function proceedWithExecution(message: string, intent: Awaited<ReturnType<typeof parseIntent>>) {
  // 1. Classify task
  const classification = classifyTask(intent, message);

  // 2. Create execution plan WITH original message
  const plan = createExecutionPlan(intent, classification, message);

  // 3. For simple tasks, execute immediately
  if (classification.complexity === 'simple') {
    return executeSimpleTask(message, intent, plan);
  }

  // 4. For complex tasks, return plan for confirmation
  return NextResponse.json({
    type: 'plan',
    message: 'Вот план выполнения задачи:',
    plan,
    classification,
    requiresConfirmation: true,
  });
}

async function executeSimpleTask(
  message: string,
  intent: Awaited<ReturnType<typeof parseIntent>>,
  plan: ExecutionPlan
) {
  const availableModels = getAvailableModels();
  const bestModel = getBestModelForTask('code', availableModels.filter(m => m.available));

  if (!bestModel) {
    return NextResponse.json({
      type: 'error',
      message: 'Нет доступных моделей. Проверьте API ключи.',
    });
  }

  // Include available tools in system prompt
  const toolsDescription = getToolDescriptions();
  const systemPrompt = `You are a helpful AI assistant that helps with coding tasks. Be concise and provide working code.

Available tools you can use:
${toolsDescription}

To use a tool, format your response as:
<tool_use name="tool_name">{"param": "value"}</tool_use>`;

  const response = await withRetry(() => generateWithModel(
    bestModel.provider,
    bestModel.apiModel,
    message,
    systemPrompt
  ));

  // Process any tool calls in the response
  const toolCalls = parseToolCalls(response.content);
  let finalContent = response.content;

  if (toolCalls.length > 0) {
    const toolResults = await executeToolCalls(toolCalls);

    // Append tool results to response
    const toolResultsText = toolResults
      .map(r => `Tool ${r.toolName}: ${r.result.success ? JSON.stringify(r.result.data) : r.result.error}`)
      .join('\n');

    finalContent = `${response.content}\n\n---\nTool Results:\n${toolResultsText}`;
  }

  // Update plan status
  plan.status = 'completed';
  plan.phases[0].status = 'completed';
  plan.phases[0].progress = 100;

  return NextResponse.json({
    type: 'result',
    message: finalContent,
    plan,
    modelUsed: bestModel.name,
    latency: response.latency,
    toolsUsed: toolCalls.length > 0 ? toolCalls.map(t => t.toolName) : undefined,
  });
}

async function handlePlanExecution(plan: ExecutionPlan) {
  const results: Array<{ phase: string; result: unknown }> = [];
  const originalMessage = plan.originalMessage; // Get the original context!

  if (!originalMessage) {
    return NextResponse.json({
      type: 'error',
      message: 'План не содержит оригинального запроса. Пожалуйста, начните заново.',
    }, { status: 400 });
  }

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    plan.currentPhase = i;
    phase.status = 'running';

    try {
      let phaseResult;

      switch (phase.mode) {
        case 'council':
          // Use Advanced Council with proper context
          phaseResult = await executeAdvancedCouncil(
            `What is the best architectural approach for: ${originalMessage}`,
            `User request: ${originalMessage}`,
            phase.models
          );
          break;

        case 'deliberation':
          phaseResult = await executeDeliberation(
            originalMessage, // Pass actual task!
            phase.models[0],
            phase.models[1] || phase.models[0]
          );
          break;

        case 'debate':
          phaseResult = await executeDebate(
            `Should we implement this approach for: ${originalMessage}`,
            phase.models[0] || 'claude',
            phase.models[1] || 'openai',
            phase.models[2] || 'qwen',
            2
          );
          break;

        case 'swarm':
          phaseResult = await executeSwarmMode(originalMessage);
          break;

        case 'single':
        default:
          phaseResult = await executeSingleMode(originalMessage, phase.models[0]);
          break;
      }

      phase.status = 'completed';
      phase.progress = 100;
      phase.result = phaseResult as typeof phase.result;
      results.push({ phase: phase.name, result: phaseResult });
    } catch (error) {
      phase.status = 'failed';
      console.error(`Phase ${phase.name} failed:`, error);
      results.push({
        phase: phase.name,
        result: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
  }

  plan.status = 'completed';

  return NextResponse.json({
    type: 'execution_complete',
    plan,
    results,
  });
}

// Execute single model mode
async function executeSingleMode(task: string, provider: ModelProvider) {
  const model = getAvailableModels().find(m => m.provider === provider && m.available);

  if (!model) {
    // Fallback to any available model
    const fallbackModel = getAvailableModels().find(m => m.available);
    if (!fallbackModel) {
      throw new Error('No models available');
    }
    const response = await withRetry(() => generateWithModel(
      fallbackModel.provider,
      fallbackModel.apiModel,
      task,
      'You are a helpful coding assistant. Complete the task thoroughly.'
    ));
    return { output: response.content, model: fallbackModel.name };
  }

  const response = await withRetry(() => generateWithModel(
    model.provider,
    model.apiModel,
    task,
    'You are a helpful coding assistant. Complete the task thoroughly.'
  ));

  return { output: response.content, model: model.name };
}

// Execute swarm mode with parallel tasks and rate limiting
async function executeSwarmMode(originalMessage: string) {
  const teamManager = getTeamManager();

  // Alex analyzes and plans
  const taskPlan = await withRetry(() =>
    teamManager.analyzeAndPlanTask(originalMessage)
  );

  // Assemble team with availability check
  const availableModels = getAvailableModels().filter(m => m.available);
  const availableProviders = new Set(availableModels.map(m => m.provider));

  // Filter roles to only those with available models
  const viableRoles = taskPlan.requiredRoles.filter(role => {
    const roleProviderMap: Record<string, ModelProvider[]> = {
      'senior_developer': ['claude', 'openai'],
      'junior_developer': ['claude', 'openai'],
      'qa_engineer': ['gemini', 'openai'],
      'research_engineer': ['deepseek', 'qwen', 'openai'],
      'devops_engineer': ['claude'],
      'security_specialist': ['openai'],
      'performance_engineer': ['deepseek', 'claude'],
      'technical_writer': ['claude'],
      'ui_designer': ['gemini', 'claude'],
      'lead_architect': ['claude'],
    };

    const providers = roleProviderMap[role] || ['claude'];
    return providers.some(p => availableProviders.has(p));
  });

  const team = teamManager.assembleTeam(viableRoles);
  const tasks = taskPlan.taskBreakdown.map(t => teamManager.createTask(t));

  // Create task execution functions
  const taskExecutors = tasks.map(task => async () => {
    const member = teamManager.assignTask(task, team);
    if (!member) {
      return { taskId: task.id, member: 'unassigned', result: 'No available team member' };
    }

    // Check if member's model is available
    const memberModel = availableModels.find(
      m => m.provider === member.provider && m.available
    );

    if (!memberModel) {
      // Fallback to any available model
      const fallback = availableModels[0];
      if (fallback) {
        const result = await generateWithModel(
          fallback.provider,
          fallback.apiModel,
          task.description,
          `You are ${member.name} (${member.role}). ${task.title}: ${task.description}`
        );
        return { taskId: task.id, member: member.name, result: result.content };
      }
      return { taskId: task.id, member: member.name, result: 'Model unavailable' };
    }

    const result = await teamManager.executeTask(task, member);
    return { taskId: task.id, member: member.name, result };
  });

  // Execute with rate limiting (parallel but controlled)
  const swarmResults = await executeWithRateLimit(taskExecutors, MAX_CONCURRENT_REQUESTS);

  // Alex synthesizes results
  const synthesisModel = availableModels.find(m => m.provider === 'claude' && m.available);
  let synthesis = 'Results compiled from team.';

  if (synthesisModel && swarmResults.length > 0) {
    const synthesisPrompt = `As Lead Architect Alex, synthesize these team results into a coherent response:

${swarmResults.map(r => `**${r.member}:**\n${r.result}`).join('\n\n---\n\n')}

Original request: ${originalMessage}

Provide a unified, well-structured response that combines all findings.`;

    const synthesisResponse = await withRetry(() => generateWithModel(
      'claude',
      synthesisModel.apiModel,
      synthesisPrompt,
      'You are Alex, Lead Architect. Synthesize team results professionally.'
    ));

    synthesis = synthesisResponse.content;
  }

  return {
    tasks: swarmResults,
    teamSize: team.length,
    analysis: taskPlan.analysis,
    synthesis,
  };
}

// GET endpoint for health check and model status
export async function GET() {
  const models = getAvailableModels();

  return NextResponse.json({
    status: 'ok',
    models: models.map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      available: m.available,
    })),
    availableCount: models.filter(m => m.available).length,
  });
}
