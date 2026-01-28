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
  getVisionContext,
  needsSummarization,
  getMessagesForSummary,
  setChatSummary,
} from '@/lib/chat-store';
import type { TaskNode } from '@/lib/chat-store';
import { getAllProjects, getProjectContextSummary, hasProject, setProject } from '@/lib/project-store';
import { parseGitHubUrl, getRepoInfo } from '@/lib/github';
import type { Project } from '@/types/project';
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

// Strip code blocks and raw JSON from model output — user sees only conclusions
function stripCodeBlocks(content: string): string {
  // Удаляем блоки ``` ... ```
  let cleaned = content.replace(/```[\s\S]*?```/g, '');
  // Удаляем inline code только если длиннее 50 символов (короткие оставляем — имена файлов и т.д.)
  cleaned = cleaned.replace(/`[^`]{50,}`/g, '');
  // Удаляем сырой JSON (объекты/массивы длиннее 100 символов, не внутри текста)
  cleaned = cleaned.replace(/\n\s*\{[\s\S]{100,}?\}\s*$/g, '');
  cleaned = cleaned.replace(/\n\s*\[[\s\S]{100,}?\]\s*$/g, '');
  // Удаляем tool_use теги если остались
  cleaned = cleaned.replace(/<tool_use[\s\S]*?<\/tool_use>/g, '');
  // Чистим множественные пустые строки
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
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

// Summarize older messages if conversation is long
async function summarizeIfNeeded(session: string): Promise<void> {
  if (!needsSummarization(session)) return;

  const oldMessages = getMessagesForSummary(session, 15);
  if (oldMessages.length === 0) return;

  // Format old messages for summarization
  const messagesText = oldMessages.map(m => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const content = m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content;
    return `${role}: ${content}`;
  }).join('\n');

  // Use fastest available model for summarization
  const fastModel = getAvailableModels().find(m =>
    m.available && (m.apiModel.includes('flash') || m.apiModel.includes('mini') || m.apiModel.includes('haiku'))
  ) || getAvailableModels().find(m => m.available);

  if (!fastModel) return;

  try {
    const response = await generateWithModel(
      fastModel.provider,
      fastModel.apiModel,
      `Summarize this conversation into key points (decisions, agreements, topics discussed). Max 300 words. Write in the same language as the conversation:\n\n${messagesText.slice(0, 4000)}`,
      'You are a conversation summarizer. Extract key decisions, topics, and agreements. Be concise and factual.'
    );

    if (response.content) {
      setChatSummary(session, response.content);
    }
  } catch (error) {
    console.error('[Summarize] Failed to summarize:', error);
    // Non-critical — continue without summary
  }
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

    // Summarize old messages if conversation is long (non-blocking, best-effort)
    await summarizeIfNeeded(session);

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

// Auto-detect GitHub links in message and add projects if not already added
async function autoDetectGitHubLinks(message: string): Promise<string[]> {
  const githubRegex = /(?:https?:\/\/)?github\.com\/[\w.-]+\/[\w.-]+/gi;
  const matches = message.match(githubRegex);
  if (!matches) return [];

  const added: string[] = [];
  const token = process.env.GITHUB_TOKEN;

  for (const rawUrl of [...new Set(matches)]) {
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const parsed = parseGitHubUrl(url);
    if (!parsed) continue;

    // Skip if already added
    if (hasProject(parsed.url)) {
      console.log(`[AutoDetect] Project ${parsed.fullName} already added, skipping`);
      continue;
    }

    // Validate repo exists via GitHub API
    try {
      const repoInfo = await getRepoInfo(url, token);
      if (!repoInfo) {
        console.log(`[AutoDetect] Cannot access ${parsed.fullName}`);
        continue;
      }

      // Add project directly to store
      const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const project: Project = {
        id: projectId,
        name: repoInfo.name,
        description: repoInfo.description,
        githubUrl: parsed.url,
        owner: parsed.owner,
        repo: parsed.name,
        isPrivate: repoInfo.isPrivate,
        language: repoInfo.language,
        defaultBranch: repoInfo.defaultBranch,
        status: 'ready',  // Skip cloning — model uses GitHub API tools directly
        addedAt: new Date(),
        updatedAt: new Date(),
      };

      setProject(projectId, project);
      added.push(`${parsed.owner}/${parsed.name}`);
      console.log(`[AutoDetect] Auto-added project: ${parsed.fullName} (id: ${projectId})`);
    } catch (e) {
      console.log(`[AutoDetect] Error adding ${parsed.fullName}: ${e}`);
    }
  }

  return added;
}

async function handleInitialMessage(message: string, idempotencyKey?: string, session: string = 'main') {
  // Generate execution ID early for tracking
  const executionId = generateExecutionId();

  // 0. Auto-detect GitHub links and add projects
  const autoAdded = await autoDetectGitHubLinks(message);
  if (autoAdded.length > 0) {
    console.log(`[Orchestrator] Auto-added projects: ${autoAdded.join(', ')}`);
    // Enrich message with context about auto-added projects
    message = `${message}\n\n[Система: автоматически добавлены проекты: ${autoAdded.join(', ')}. Клонирование и анализ запущены в фоне.]`;
  }

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

// ─── Двухэтапная обработка ───────────────────────────────────────────────
// Этап 1 (work): модель свободно использует инструменты, получает данные,
//   генерирует код — всё это ВНУТРЕННИЙ рабочий контекст, пользователь не видит
// Этап 2 (finalize): ОТДЕЛЬНЫЙ вызов модели БЕЗ инструментов — формулирует
//   чистый человеческий ответ на основе собранного контекста
// ──────────────────────────────────────────────────────────────────────────

async function finalizeResponse(
  workContext: string,
  originalMessage: string,
  model: { provider: ModelProvider; apiModel: string },
  session: string = 'main'
): Promise<string> {
  const visionContext = getVisionContext();
  const conversationContext = buildConversationContext(session, 5);
  const projectsContext = getProjectsContext();

  const finalizeSystemPrompt = `Ты — Chimera AI. Твоя задача — сформулировать чистый, понятный ответ пользователю.

${visionContext}
${projectsContext}

${conversationContext}

## Правила ответа
- Отвечай на том языке, на котором пишет пользователь
- МАКСИМУМ 200 слов. Будь МАКСИМАЛЬНО лаконичен
- Общайся как живой коллега — кратко, по делу, без воды
- Называй конкретные файлы, функции, проблемы — но КРАТКО
- НЕ задавай вопросов, если можешь решить сам
- Задавай ТОЛЬКО один ключевой вопрос, если без ответа НЕВОЗМОЖНО продолжить
- Сразу действуй и сообщай результат

## СТРОГО ЗАПРЕЩЕНО
- Блоки кода (\`\`\`)
- Сырой JSON
- Показ ошибок инструментов
- Повторение содержимого файлов дословно
- Длинные списки (максимум 3-5 пунктов)
- Многословные объяснения — только суть

## Формат
Краткий ответ + (если уместно) 2-3 следующих шага:

**Что дальше:**
• [действие]
• [действие]`;

  const finalizePrompt = `Запрос пользователя: ${originalMessage}

Собранные данные (внутренний рабочий контекст, НЕ показывай его напрямую):
---
${workContext.slice(0, 6000)}
---

Сформулируй чистый человеческий ответ на основе этих данных.`;

  const response = await withRetry(() => generateWithModel(
    model.provider,
    model.apiModel,
    finalizePrompt,
    finalizeSystemPrompt
  ));

  let result = response.content || '';

  // Safety net: strip any remaining code blocks (shouldn't happen with good finalization)
  result = stripCodeBlocks(result);

  if (!result.trim()) {
    result = 'Задача обработана, но не удалось сформулировать ответ. Попробуйте переформулировать запрос.';
  }

  return result;
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

  // ── ЭТАП 1: РАБОЧИЙ (work) ──────────────────────────────────────────
  // Модель свободно работает с инструментами, код/JSON допустимы
  // Всё это — внутренний контекст, пользователь его не увидит

  const toolsDescription = getToolDescriptions();
  const visionCtx = getVisionContext();
  const projectsContext = getProjectsContext();
  const conversationContext = buildConversationContext(session, 10);
  const taskTreeContext = buildTaskTreeContext(session);

  const workSystemPrompt = `Ты — Chimera AI, рабочий агент. Выполни задачу пользователя, используя доступные инструменты.

${visionCtx}
${projectsContext}

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

## Инструкции
- Выполняй задачу полностью — используй инструменты для получения данных
- Если инструмент вернул ошибку — попробуй другой подход
- Собери ВСЮ нужную информацию и дай ПОЛНЫЙ ответ с деталями
- Код, JSON, технические детали — МОЖНО, это внутренний контекст
- У тебя ЕСТЬ контекст диалога. Когда пользователь ссылается на предыдущие ответы — ищи в истории
- НЕ задавай лишних вопросов — действуй
- Если данных достаточно — просто дай ответ БЕЗ вызова инструментов`;

  const startTime = Date.now();
  let totalLatency = 0;
  const MAX_TOOL_ITERATIONS = 3;
  let currentPrompt = message;
  const workContextParts: string[] = [];
  const allToolsUsed: string[] = [];
  let usedTools = false;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const isFollowUp = iteration > 0;
    const iterationSystemPrompt = isFollowUp
      ? workSystemPrompt + '\n\nТы получил результаты инструментов. Если ошибка — попробуй другой подход. Если данные есть — дай полный ответ с анализом.'
      : workSystemPrompt;

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
      // Модель ответила без инструментов — сохраняем как рабочий контекст
      workContextParts.push(`Ответ модели:\n${response.content}`);
      break;
    }

    usedTools = true;
    allToolsUsed.push(...toolCalls.map(t => t.toolName));
    const toolResults = await executeToolCalls(toolCalls);
    const hasErrors = toolResults.some(r => !r.result.success);
    const cleanContent = response.content.replace(/<tool_use name="\w+">[\s\S]*?<\/tool_use>/g, '').trim();

    if (cleanContent) {
      workContextParts.push(`Размышления модели:\n${cleanContent}`);
    }

    const toolResultsText = toolResults
      .map(r => {
        if (r.result.success) {
          const data = r.result.data;
          const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
          // Обрезаем слишком длинные результаты инструментов
          return `[${r.toolName}]: ${dataStr.length > 2000 ? dataStr.slice(0, 2000) + '... [обрезано]' : dataStr}`;
        }
        return `[${r.toolName}] ОШИБКА: ${r.result.error}`;
      })
      .join('\n\n');

    workContextParts.push(`Результаты инструментов:\n${toolResultsText}`);

    if (iteration < MAX_TOOL_ITERATIONS - 1) {
      const errorNote = hasErrors
        ? '\nНекоторые инструменты вернули ошибки. Попробуй другой подход.'
        : '\nДанные получены. Если нужно ещё — используй инструменты. Если достаточно — дай ответ.';
      currentPrompt = `Исходный запрос: ${message}\n\nТвой предыдущий ответ:\n${cleanContent}\n\nРезультаты инструментов:\n${toolResultsText}${errorNote}`;
      continue;
    }

    // Последняя итерация — сохраняем что есть
    if (cleanContent) {
      workContextParts.push(`Финальный ответ модели:\n${cleanContent}`);
    }
  }

  const workContext = workContextParts.join('\n\n---\n\n');

  console.log(`[SimpleTask] Work phase done. Tools used: ${usedTools}. Context parts: ${workContextParts.length}. Context length: ${workContext.length}`);

  // ── ЭТАП 2: ФИНАЛИЗАЦИЯ (finalize) ──────────────────────────────────
  // Отдельный вызов модели БЕЗ инструментов — чистый человеческий ответ

  let finalContent: string;

  if (!usedTools && workContextParts.length === 1) {
    // Модель ответила напрямую без инструментов — всё равно финализируем,
    // чтобы гарантировать чистый формат без кода/JSON
    finalContent = await finalizeResponse(workContext, message, bestModel, session);
    console.log(`[SimpleTask] Direct response finalized. Length: ${finalContent.length}`);
  } else {
    // Был рабочий этап с инструментами — обязательно финализируем
    finalContent = await finalizeResponse(workContext, message, bestModel, session);
    console.log(`[SimpleTask] Tool-based response finalized. Length: ${finalContent.length}`);
  }

  // Update plan status
  plan.status = 'completed';
  plan.phases[0].status = 'completed';
  plan.phases[0].progress = 100;

  await completePhase(executionId, plan.phases[0].id, { content: finalContent });

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

  // Log results for debugging
  console.log(`[PlanExec] ${results.length} phases completed`);
  results.forEach((r, i) => {
    const res = r.result as Record<string, unknown> | null;
    const keys = res ? Object.keys(res) : [];
    console.log(`[PlanExec] Phase ${i} "${r.phase}": keys=[${keys.join(',')}]`);
    if (res?.synthesis) console.log(`[PlanExec]   synthesis: ${String(res.synthesis).slice(0, 100)}`);
    if (res?.output) console.log(`[PlanExec]   output: ${String(res.output).slice(0, 100)}`);
    if (res?.code) console.log(`[PlanExec]   code: ${String(res.code).slice(0, 100)}`);
    if (res?.error) console.log(`[PlanExec]   error: ${String(res.error)}`);
  });

  // ── Финализация: модель формулирует чистый ответ ──────────────────
  // Собираем рабочий контекст из всех фаз
  const workContextParts = results.map(r => {
    const res = r.result as Record<string, unknown> | null;
    if (!res) return '';
    if (res.error) return `Фаза "${r.phase}": ОШИБКА — ${res.error}`;
    const text = res.synthesis || res.output || res.code || '';
    const textStr = typeof text === 'string' ? text : JSON.stringify(text);
    return textStr ? `Фаза "${r.phase}":\n${textStr.slice(0, 2000)}` : '';
  }).filter(Boolean).join('\n\n---\n\n');

  let summaryMessage: string;

  if (workContextParts) {
    // Финализируем через модель — чистый человеческий ответ
    const bestModel = getAvailableModels().find(m => m.available);
    if (bestModel) {
      summaryMessage = await finalizeResponse(workContextParts, originalMessage, bestModel, session);
    } else {
      summaryMessage = 'Выполнение завершено, но нет доступных моделей для формирования ответа.';
    }
  } else {
    summaryMessage = 'Выполнение завершено.';
  }

  console.log(`[PlanExec] Summary message length: ${summaryMessage.length}`);

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
  const singleVision = getVisionContext();
  const projectsContext = getProjectsContext();
  // Single mode — рабочий промпт, разрешаем свободный формат
  // Финализация произойдёт в handlePlanExecution через finalizeResponse
  const singleSystemPrompt = `Ты — Chimera AI, эксперт по разработке. Выполни задачу полностью и конкретно.

${singleVision}
${projectsContext}

Отвечай на том языке, на котором написана задача.
Дай подробный технический ответ с конкретикой — файлы, функции, архитектура.
Код и технические детали допустимы — это рабочий контекст для дальнейшей обработки.`;

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
    const swarmVision = getVisionContext();
    const historyContext = buildConversationContext(session, 5);

    // Обрезаем результаты команды для синтеза — не более 800 символов на каждого
    const trimmedResults = swarmResults.map(r => {
      const trimmed = r.result.length > 800 ? r.result.slice(0, 800) + '... [сокращено]' : r.result;
      return `**${r.member} (${r.provider}):**\n${trimmed}`;
    }).join('\n\n---\n\n');

    const synthesisPrompt = `${swarmVision}\n\n${historyContext ? historyContext + '\n\n' : ''}Результаты работы команды:

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

    // Синтез через двухэтапную обработку: Алекс анализирует, потом финализация
    const synthesisResponse = await withRetry(() => generateWithModel(
      lead.provider,
      lead.modelId,
      synthesisPrompt,
      'Ты — Алекс, ведущий архитектор команды Chimera. Проанализируй результаты команды и дай подробный технический разбор. Код и JSON допустимы — это рабочий контекст.',
      { maxTokens: 2000 }
    ));

    // Финализируем через отдельный вызов — чистый человеческий ответ
    synthesis = await finalizeResponse(
      synthesisResponse.content || '',
      originalMessage,
      { provider: lead.provider, apiModel: lead.modelId },
      session
    );
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
