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
import { getToolDescriptions } from '@/lib/mcp';
import { generateWithModel, getAvailableModels, getBestModelForTask } from '@/lib/models';

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

  // 2. Create execution plan
  const plan = createExecutionPlan(intent, classification);

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
  plan: Awaited<ReturnType<typeof createExecutionPlan>>
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

  const response = await generateWithModel(
    bestModel.provider,
    bestModel.apiModel,
    message,
    systemPrompt
  );

  // Update plan status
  plan.status = 'completed';
  plan.phases[0].status = 'completed';
  plan.phases[0].progress = 100;

  return NextResponse.json({
    type: 'result',
    message: response.content,
    plan,
    modelUsed: bestModel.name,
    latency: response.latency,
  });
}

async function handlePlanExecution(plan: Awaited<ReturnType<typeof createExecutionPlan>>) {
  const results: Array<{ phase: string; result: unknown }> = [];

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    plan.currentPhase = i;
    phase.status = 'running';

    try {
      let phaseResult;

      switch (phase.mode) {
        case 'council':
          phaseResult = await executeCouncil(
            'What is the best approach for this task?',
            phase.models
          );
          break;

        case 'deliberation':
          phaseResult = await executeDeliberation(
            'Implement the requested feature',
            phase.models[0],
            phase.models[1] || phase.models[0]
          );
          break;

        case 'debate':
          phaseResult = await executeDebate(
            'Debate the best approach for this task',
            phase.models[0] || 'claude',
            phase.models[1] || 'openai',
            phase.models[2] || 'qwen',
            2 // rounds
          );
          break;

        case 'swarm':
          // Use team manager for swarm mode
          const teamManager = getTeamManager();
          const plan = await teamManager.analyzeAndPlanTask('Execute task with team');
          const team = teamManager.assembleTeam(plan.requiredRoles);
          const tasks = plan.taskBreakdown.map(t => teamManager.createTask(t));

          const swarmResults: { taskId: string; member: string; result: string }[] = [];
          for (const task of tasks) {
            const member = teamManager.assignTask(task, team);
            if (member) {
              const result = await teamManager.executeTask(task, member);
              swarmResults.push({ taskId: task.id, member: member.name, result });
            }
          }
          phaseResult = { tasks: swarmResults, teamSize: team.length };
          break;

        case 'single':
        default:
          const model = getAvailableModels().find(m => m.provider === phase.models[0] && m.available);
          if (model) {
            const response = await generateWithModel(
              model.provider,
              model.apiModel,
              'Complete the task as requested.',
              'You are a helpful coding assistant.'
            );
            phaseResult = { output: response.content };
          }
          break;
      }

      phase.status = 'completed';
      phase.progress = 100;
      phase.result = phaseResult as typeof phase.result;
      results.push({ phase: phase.name, result: phaseResult });
    } catch (error) {
      phase.status = 'failed';
      console.error(`Phase ${phase.name} failed:`, error);
    }
  }

  plan.status = 'completed';

  return NextResponse.json({
    type: 'execution_complete',
    plan,
    results,
  });
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
