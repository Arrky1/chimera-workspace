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
import {
  OrchestrateRequestSchema,
  validateOrThrow,
} from '@/lib/schemas';
import {
  getChatHistory,
  addChatMessage,
  buildConversationContext,
  buildTaskTreeContext,
  createTaskTree,
  updateTaskNode,
} from '@/lib/chat-store';
import type { TaskNode } from '@/lib/chat-store';
import { getAllProjects, getProjectContextSummary } from '@/lib/project-store';
import {
  createExecution,
  getExecution,
  updateExecution,
  startPhase,
  completePhase,
  failPhase,
  recordModelCall,
  checkIdempotency,
  setIdempotency,
  generateExecutionId,
} from '@/lib/execution-store';

// Build context from all added projects
function getProjectsContext(): string {
  const projects = getAllProjects();
  if (projects.length === 0) return '';

  const projectSummaries = projects.map(p => {
    const summary = getProjectContextSummary(p.id);
    return summary || `- ${p.owner}/${p.repo} (${p.status})`;
  }).join('\n\n');

  return `\n\n## Проекты пользователя\nВ системе добавлены следующие проекты. Используй эту информацию при ответах:\n\n${projectSummaries}`;
}

// Strip code blocks from model output — user sees only conclusions
function stripCodeBlocks(content: string): string {
  // Удаляем блоки ``` ... ```
  let cleaned = content.replace(/```[\s\S]*?```/g, '[см. код в результатах анализа]');
  // Удаляем inline code только если длиннее 50 символов (короткие оставляем — имена файлов и т.д.)
  cleaned = cleaned.replace(/`[^`]{50,}`/g, '[фрагмент кода]');
  return cleaned.trim();
}

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

    // Лог доступных моделей (для диагностики)
    const allModels = getAvailableModels();
    const availProviders = allModels.filter(m => m.available).map(m => `${m.provider}/${m.apiModel}`);
    console.log(`[Orchestrator] Доступные модели (${availProviders.length}): ${availProviders.join(', ')}`);

    // Validate request with Zod schema
    console.log(`[Orchestrator] Request keys: ${Object.keys(body).join(', ')}`);
    if (body.confirmedPlan) {
      console.log(`[Orchestrator] confirmedPlan.id=${body.confirmedPlan.id}, status=${body.confirmedPlan.status}, phases=${body.confirmedPlan.phases?.length}`);
    }
    const validatedRequest = validateOrThrow(OrchestrateRequestSchema, body);
    const { message, history, sessionId, clarificationAnswers, confirmedPlan, idempotencyKey, executionId } = validatedRequest;

    // Session management
    const session = sessionId || 'main';

    // Sync: если серверная история пуста (сервер перезагрузился), восстанавливаем из клиента
    const serverHistory = getChatHistory(session);
    if (serverHistory.length === 0 && history && history.length > 0) {
      for (const msg of history) {
        addChatMessage(
          { role: msg.role, content: msg.content, timestamp: msg.timestamp || Date.now() },
          session
        );
      }
    }

    // Сохраняем текущее сообщение пользователя
    if (message) {
      addChatMessage({ role: 'user', content: message, timestamp: Date.now() }, session);
    }

    // Idempotency check - return existing execution if duplicate request
    if (idempotencyKey) {
      const existingExecutionId = await checkIdempotency(idempotencyKey);
      if (existingExecutionId) {
        const existingState = await getExecution(existingExecutionId);
        if (existingState) {
          console.log(`[Orchestrator] Returning cached execution: ${existingExecutionId}`);
          return NextResponse.json({
            type: 'result',
            message: 'Запрос уже был обработан (идемпотентность)',
            plan: existingState.plan,
            executionId: existingExecutionId,
            cached: true,
          });
        }
      }
    }

    // Resume existing execution if executionId provided
    if (executionId) {
      const existingState = await getExecution(executionId);
      if (existingState) {
        if (existingState.status === 'running') {
          return NextResponse.json({
            type: 'error',
            message: 'Выполнение уже в процессе',
            executionId,
          });
        }
        if (existingState.status === 'completed') {
          return NextResponse.json({
            type: 'execution_complete',
            plan: existingState.plan,
            results: Object.values(existingState.phaseResults).map(r => ({
              phase: r.phaseId,
              result: r.result,
            })),
            executionId,
          });
        }
      }
    }

    // If we have clarification answers, process them and continue
    if (clarificationAnswers && message) {
      return handleClarificationResponse(message, clarificationAnswers, idempotencyKey, session);
    }

    // If plan is confirmed, execute it
    if (confirmedPlan) {
      // Cast to ExecutionPlan from @/types (validated by schema)
      return handlePlanExecution(confirmedPlan as ExecutionPlan, idempotencyKey, session);
    }

    // Initial message processing (message is guaranteed by refine validation)
    if (!message) {
      return NextResponse.json(
        { type: 'error', message: 'Сообщение обязательно для нового запроса' },
        { status: 400 }
      );
    }
    return handleInitialMessage(message, idempotencyKey, session);
  } catch (error) {
    console.error('Orchestrator error:', error);

    // Check if it's a validation error
    const isValidationError = error instanceof Error && error.message.startsWith('Validation failed');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (isValidationError) {
      console.error(`[Orchestrator] Validation details: ${errorMessage}`);
    }

    return NextResponse.json(
      {
        type: 'error',
        message: isValidationError ? `Ошибка валидации: ${errorMessage}` : 'Внутренняя ошибка сервера',
        details: errorMessage,
      },
      { status: isValidationError ? 400 : 500 }
    );
  }
}

async function handleInitialMessage(message: string, idempotencyKey?: string, session: string = 'main') {
  // Generate execution ID early for tracking
  const executionId = generateExecutionId();

  // 1. Parse intent
  const intent = await parseIntent(message);

  // 2. Detect ambiguities
  const ambiguities = await detectAmbiguities(message, intent);

  // 3. If no critical ambiguities, proceed directly (only ask for truly unclear tasks)
  if (ambiguities.filter(a => a.severity === 'high').length === 0) {
    return proceedWithExecution(message, intent, idempotencyKey, executionId, session);
  }

  // 4. Generate clarification questions
  const clarificationRequest = generateClarificationQuestions(ambiguities);

  if (clarificationRequest) {
    return NextResponse.json({
      type: 'clarification',
      message: 'Для корректного выполнения задачи, пожалуйста, уточните детали:',
      clarification: clarificationRequest,
      intent,
      executionId, // Include for potential resume
    });
  }

  // 5. No ambiguities found, proceed
  return proceedWithExecution(message, intent, idempotencyKey, executionId, session);
}

async function handleClarificationResponse(
  originalMessage: string,
  answers: Record<string, string>,
  idempotencyKey?: string,
  session: string = 'main'
) {
  // Re-parse with clarified context
  const clarifiedContext = Object.values(answers).join('. ');
  const enrichedMessage = `${originalMessage}\n\nУточнения: ${clarifiedContext}`;

  const intent = await parseIntent(enrichedMessage);
  intent.confidence = 0.95; // Bump confidence since we have clarifications

  return proceedWithExecution(enrichedMessage, intent, idempotencyKey, undefined, session);
}

async function proceedWithExecution(
  message: string,
  intent: Awaited<ReturnType<typeof parseIntent>>,
  idempotencyKey?: string,
  existingExecutionId?: string,
  session: string = 'main'
) {
  // 1. Classify task
  const classification = classifyTask(intent, message);

  // 2. Create execution plan WITH original message
  const plan = createExecutionPlan(intent, classification, message);

  // 3. Create execution state for persistence
  const executionState = await createExecution(plan, {
    idempotencyKey,
    source: 'api',
  });

  // Use existing execution ID if provided, otherwise use newly created one
  const executionId = existingExecutionId || executionState.id;

  // Set idempotency mapping if key provided
  if (idempotencyKey) {
    await setIdempotency(idempotencyKey, executionId);
  }

  // 4. For simple tasks, execute immediately (single model)
  if (classification.complexity === 'simple') {
    return executeSimpleTask(message, intent, plan, executionId, session);
  }

  // 5. For medium and complex tasks — auto-execute plan (swarm/team)
  // Не отправляем план обратно на клиент для подтверждения — выполняем сразу на сервере
  console.log(`[Orchestrator] Auto-executing ${classification.complexity} task with mode: ${classification.recommendedMode}`);
  return handlePlanExecution(plan, idempotencyKey, session);
}

async function executeSimpleTask(
  message: string,
  intent: Awaited<ReturnType<typeof parseIntent>>,
  plan: ExecutionPlan,
  executionId: string,
  session: string = 'main'
) {
  const availableModels = getAvailableModels();
  const bestModel = getBestModelForTask('code', availableModels.filter(m => m.available));

  if (!bestModel) {
    await failPhase(executionId, plan.phases[0].id, 'No models available');
    return NextResponse.json({
      type: 'error',
      message: 'Нет доступных моделей. Проверьте API ключи.',
      executionId,
    });
  }

  // Start phase tracking
  await startPhase(executionId, plan.phases[0].id);

  // Include available tools, project context, and conversation history in system prompt
  const toolsDescription = getToolDescriptions();
  const projectsContext = getProjectsContext();
  const conversationContext = buildConversationContext(session, 10);
  const taskTreeContext = buildTaskTreeContext(session);

  const systemPrompt = `Ты — Chimera AI, мультимодельный ассистент для разработки и анализа кода. Отвечай на том языке, на котором пишет пользователь.${projectsContext}

${conversationContext}

${taskTreeContext}

## Доступные инструменты
${toolsDescription}

Для использования инструмента:
<tool_use name="tool_name">{"param": "value"}</tool_use>

## Чтение файлов проекта
- ПРЕДПОЧТИТЕЛЬНО: github tool с action "get_file" или "list_files" (надёжнее)
- Альтернатива: file_system с путём owner/repo/path
- Если один способ не работает — сразу пробуй другой

## Стиль общения
Ты общаешься как живой коллега-разработчик, а не робот. Твои ответы должны быть:

1. **Информативными** — чётко объясни что ты сделал / нашёл / проанализировал
2. **Со статусом** — если задача выполнена, скажи об этом. Если что-то не удалось — объясни почему
3. **С предложением следующих шагов** — в конце ВСЕГДА предложи 2-3 конкретных действия, которые можно сделать дальше. Формат:

   **Что можно сделать дальше:**
   • [конкретное действие 1]
   • [конкретное действие 2]
   • [конкретное действие 3]

4. **Проактивными** — если видишь проблему — сообщи. Если есть лучший подход — предложи
5. **Конкретными** — называй файлы, строки, функции, ошибки. Без воды

## Инструкции
- У тебя ЕСТЬ контекст диалога выше. Когда пользователь ссылается на "тот текст", "предыдущий ответ", "результат" — ищи в истории диалога
- Отвечай КРАТКО и по делу. Максимум 400 слов
- ЗАПРЕЩЕНО выдавать блоки кода. НИКАКОГО кода. Без тройных бэктиков
- Отвечай ТОЛЬКО текстом: заключения, выводы, рекомендации простыми словами
- Если нужно описать код — объясни словами что он делает, не показывай сам код
- Называй файлы, строки, проблемы конкретно
- НИКОГДА не показывай сырые ошибки инструментов — попробуй другой подход
- Не задавай лишних вопросов — сразу действуй
- НИКОГДА не спрашивай "о каком тексте идёт речь" — проверь историю диалога`;

  const startTime = Date.now();
  let totalLatency = 0;

  // Agentic loop: model calls tools, gets results back, can retry on errors
  const MAX_TOOL_ITERATIONS = 3;
  let currentPrompt = message;
  let finalContent = '';
  const allToolsUsed: string[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const isFollowUp = iteration > 0;
    const iterationSystemPrompt = isFollowUp
      ? systemPrompt + '\n\n## ВАЖНО: Ты получил результаты инструментов. Если инструмент вернул ошибку — попробуй другой подход (github tool вместо file_system). НЕ показывай пользователю сырые ошибки — исправь ситуацию сам и дай полезный результат.'
      : systemPrompt;

    const response = await withRetry(() => generateWithModel(
      bestModel.provider,
      bestModel.apiModel,
      currentPrompt,
      iterationSystemPrompt
    ));
    totalLatency += response.latency || 0;

    await recordModelCall(executionId, plan.phases[0].id, {
      provider: bestModel.provider,
      modelId: bestModel.apiModel,
      prompt: currentPrompt,
      systemPrompt: iterationSystemPrompt,
      response: response.content,
      startedAt: startTime,
      completedAt: Date.now(),
      latency: response.latency,
    });

    const toolCalls = parseToolCalls(response.content);

    if (toolCalls.length === 0) {
      finalContent = response.content;
      break;
    }

    allToolsUsed.push(...toolCalls.map(t => t.toolName));
    const toolResults = await executeToolCalls(toolCalls);
    const hasErrors = toolResults.some(r => !r.result.success);
    const cleanContent = response.content.replace(/<tool_use name="\w+">[\s\S]*?<\/tool_use>/g, '').trim();

    const toolResultsText = toolResults
      .map(r => {
        if (r.result.success) {
          const data = r.result.data;
          return `[${r.toolName}]: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data)}`;
        }
        return `[${r.toolName}] ОШИБКА: ${r.result.error}`;
      })
      .join('\n\n');

    if (hasErrors && iteration < MAX_TOOL_ITERATIONS - 1) {
      // Errors — feed back to model for recovery
      currentPrompt = `Исходный запрос пользователя: ${message}\n\nТвой ответ:\n${cleanContent}\n\nРезультаты инструментов:\n${toolResultsText}\n\nНекоторые инструменты вернули ошибки. Попробуй другой подход:\n- Если file_system не нашёл файл — используй github tool с action "get_file" или "list_files"\n- Если github не работает — дай ответ на основе имеющихся данных\nНЕ показывай ошибки пользователю — дай полезный результат.`;
      continue;
    }

    // Format successful results into response (don't show raw JSON to user)
    const successResults = toolResults.filter(r => r.result.success);
    if (successResults.length > 0) {
      const formattedResults = successResults
        .map(r => {
          const data = r.result.data;
          return typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
        })
        .join('\n\n');
      finalContent = cleanContent + (formattedResults ? `\n\n${formattedResults}` : '');
    } else {
      finalContent = cleanContent || 'Не удалось выполнить запрос. Попробуйте переформулировать задачу.';
    }
    break;
  }

  // Update plan status
  plan.status = 'completed';
  plan.phases[0].status = 'completed';
  plan.phases[0].progress = 100;

  await completePhase(executionId, plan.phases[0].id, { content: finalContent });

  // Strip code blocks — пользователь видит только заключения
  finalContent = stripCodeBlocks(finalContent);

  // Save assistant response to chat history
  addChatMessage({ role: 'assistant', content: finalContent, timestamp: Date.now() }, session);

  return NextResponse.json({
    type: 'result',
    message: finalContent,
    plan,
    modelUsed: bestModel.name,
    latency: totalLatency,
    toolsUsed: allToolsUsed.length > 0 ? allToolsUsed : undefined,
    executionId,
  });
}

async function handlePlanExecution(plan: ExecutionPlan, idempotencyKey?: string, session: string = 'main') {
  const results: Array<{ phase: string; result: unknown }> = [];
  const originalMessage = plan.originalMessage; // Get the original context!

  if (!originalMessage) {
    return NextResponse.json({
      type: 'error',
      message: 'План не содержит оригинального запроса. Пожалуйста, начните заново.',
    }, { status: 400 });
  }

  // Create execution state for the confirmed plan
  const executionState = await createExecution(plan, {
    idempotencyKey,
    source: 'api',
  });
  const executionId = executionState.id;

  // Set idempotency if provided
  if (idempotencyKey) {
    await setIdempotency(idempotencyKey, executionId);
  }

  // Update to running status
  await updateExecution(executionId, { status: 'running' });

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    plan.currentPhase = i;
    phase.status = 'running';

    // Start phase tracking
    await startPhase(executionId, phase.id);

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
          phaseResult = await executeSwarmMode(originalMessage, session);
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

      // Complete phase in execution store
      await completePhase(executionId, phase.id, phaseResult);
    } catch (error) {
      phase.status = 'failed';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Phase ${phase.name} failed:`, error);
      results.push({
        phase: phase.name,
        result: { error: errorMessage }
      });

      // Fail phase in execution store
      await failPhase(executionId, phase.id, errorMessage);

      // Stop execution on failure
      break;
    }
  }

  plan.status = 'completed';

  // Build a human-readable summary message for the user
  const resultParts = results.map(r => {
    const res = r.result as { synthesis?: string; output?: string; tasks?: unknown[]; error?: string } | null;
    if (!res) return '';
    if (res.error) return `**${r.phase}:** Ошибка — ${res.error}`;
    const text = res.synthesis || res.output || '';
    return text ? `**${r.phase}:**\n${stripCodeBlocks(typeof text === 'string' ? text : JSON.stringify(text)).slice(0, 500)}` : '';
  }).filter(Boolean).join('\n\n');

  const summaryMessage = resultParts
    ? `Готово! Вот результаты:\n\n${resultParts}`
    : 'Выполнение завершено.';

  // Save to chat history
  addChatMessage({ role: 'assistant', content: summaryMessage, timestamp: Date.now() }, session);

  return NextResponse.json({
    type: 'execution_complete',
    message: summaryMessage,
    plan,
    results,
    executionId,
  });
}

// Execute single model mode
async function executeSingleMode(task: string, provider: ModelProvider) {
  const model = getAvailableModels().find(m => m.provider === provider && m.available);
  const projectsContext = getProjectsContext();
  const singleSystemPrompt = `Ты — Chimera AI, эксперт по разработке. Выполни задачу полностью и конкретно.${projectsContext}

Отвечай на том языке, на котором написана задача.
Будь КРАТКИМ — максимум 400 слов.
ЗАПРЕЩЕНО выдавать блоки кода. Отвечай ТОЛЬКО текстом — заключения, выводы, рекомендации простыми словами.
Если нужно описать код — объясни словами, не показывай код.

## Стиль общения
Общайся как живой коллега. В конце ответа ВСЕГДА предложи 2-3 следующих шага:

**Что можно сделать дальше:**
• [действие 1]
• [действие 2]`;

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
      singleSystemPrompt
    ));
    return { output: response.content, model: fallbackModel.name };
  }

  const response = await withRetry(() => generateWithModel(
    model.provider,
    model.apiModel,
    task,
    singleSystemPrompt
  ));

  return { output: response.content, model: model.name };
}

// Execute swarm mode with parallel tasks and rate limiting
async function executeSwarmMode(originalMessage: string, session: string = 'main') {
  const teamManager = getTeamManager();

  // Алекс анализирует и планирует
  const taskPlan = await withRetry(() =>
    teamManager.analyzeAndPlanTask(originalMessage)
  );

  // Собираем команду — resolveModelForRole() внутри team.ts
  // автоматически подберёт доступные модели для каждой роли
  const team = teamManager.assembleTeam(taskPlan.requiredRoles);
  const tasks = taskPlan.taskBreakdown.map(t => teamManager.createTask(t));

  // Создаём дерево задач для отслеживания
  const taskNodes: TaskNode[] = tasks.map(task => ({
    id: task.id,
    title: task.description,
    status: 'pending' as const,
    children: [],
    createdAt: Date.now(),
  }));
  createTaskTree(originalMessage.slice(0, 100), taskNodes, session);

  // Создаём функции выполнения задач
  const taskExecutors = tasks.map((task, idx) => async () => {
    const member = teamManager.assignTask(task, team);
    if (!member) {
      updateTaskNode(task.id, { status: 'failed', result: 'Нет свободных членов команды' }, session);
      return { taskId: task.id, member: 'не назначен', result: 'Нет свободных членов команды' };
    }

    // Обновляем статус в дереве задач
    updateTaskNode(task.id, { status: 'in_progress', provider: `${member.name} (${member.provider})` }, session);

    // executeTask() внутри team.ts сам делает fallback при ошибке
    const result = await teamManager.executeTask(task, member);

    updateTaskNode(task.id, {
      status: 'completed',
      result: result.slice(0, 200),
      completedAt: Date.now(),
    }, session);

    return {
      taskId: task.id,
      member: `${member.name} ${member.emoji}`,
      provider: member.provider,
      result,
    };
  });

  // Параллельное выполнение с rate limiting
  const swarmResults = await executeWithRateLimit(taskExecutors, MAX_CONCURRENT_REQUESTS);

  // Алекс синтезирует результаты
  const teamState = teamManager.getTeamState();
  const lead = teamState.lead;
  let synthesis = 'Результаты команды скомпилированы.';

  if (swarmResults.length > 0) {
    // Включаем контекст разговора в синтез
    const historyContext = buildConversationContext(session, 5);

    // Обрезаем результаты команды для синтеза — не более 800 символов на каждого
    const trimmedResults = swarmResults.map(r => {
      const trimmed = r.result.length > 800 ? r.result.slice(0, 800) + '... [сокращено]' : r.result;
      return `**${r.member} (${r.provider}):**\n${trimmed}`;
    }).join('\n\n---\n\n');

    const synthesisPrompt = `${historyContext ? historyContext + '\n\n' : ''}Результаты работы команды:

${trimmedResults}

Исходный запрос: ${originalMessage}

ЗАДАЧА: Дай КРАТКИЙ структурированный ИТОГ как живой коллега.
- Максимум 400 слов
- НЕ повторяй код из результатов — только выводы и рекомендации
- Если есть проблемы — таблица: приоритет | проблема | решение
- План действий — нумерованный список
- НЕ генерируй новый код — только ссылайся на результаты команды
- В конце ОБЯЗАТЕЛЬНО предложи 2-3 следующих шага:

**Что можно сделать дальше:**
• [действие 1]
• [действие 2]
• [действие 3]`;

    const synthesisResponse = await withRetry(() => generateWithModel(
      lead.provider,
      lead.modelId,
      synthesisPrompt,
      'Ты — Алекс, ведущий архитектор команды Chimera. Дай КРАТКОЕ заключение по результатам команды. МАКСИМУМ 300 слов. ЗАПРЕЩЕНО выдавать блоки кода (```). Только текстовые выводы, проблемы, план действий простыми словами. Отвечай на русском.',
      { maxTokens: 2000 }
    ));

    synthesis = stripCodeBlocks(synthesisResponse.content || synthesis);
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
