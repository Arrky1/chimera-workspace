import { NextRequest, NextResponse } from 'next/server';
import { generateWithModel, getAvailableModels, getBestModelForTask } from '@/lib/models';
import { parseToolCalls, executeToolCalls, getToolDescriptions } from '@/lib/mcp';
import {
  getProject, getProjectContextSummary,
  getChatHistory, addChatMessage,
} from '@/lib/project-store';
import { buildConversationContext, getVisionContext } from '@/lib/chat-store';
import * as fs from 'fs/promises';
import * as path from 'path';

// Strip code blocks as safety net
function stripCodeBlocks(content: string): string {
  let cleaned = content.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`[^`]{50,}`/g, '');
  cleaned = cleaned.replace(/\n\s*\{[\s\S]{100,}?\}\s*$/g, '');
  cleaned = cleaned.replace(/\n\s*\[[\s\S]{100,}?\]\s*$/g, '');
  cleaned = cleaned.replace(/<tool_use[\s\S]*?<\/tool_use>/g, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, message } = body;

    if (!projectId || !message || typeof projectId !== 'string' || typeof message !== 'string') {
      return NextResponse.json({ error: 'projectId and message required (strings)' }, { status: 400 });
    }

    if (message.length > 10000) {
      return NextResponse.json({ error: 'Message too long (max 10000 chars)' }, { status: 400 });
    }

    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Add user message to history
    addChatMessage(projectId, { role: 'user', content: message, timestamp: Date.now() });

    // Get project context
    const projectContext = getProjectContextSummary(projectId);

    // Get main chat context (to preserve continuity between main chat and project chat)
    const mainChatContext = buildConversationContext('main', 5);

    // Try to get file listing from cloned repo
    let fileStructure = '';
    try {
      const safeOwner = path.basename(project.owner);
      const safeRepo = path.basename(project.repo);
      const reposDir = path.resolve(process.cwd(), '.chimera-repos');
      const repoPath = path.resolve(reposDir, safeOwner, safeRepo);
      if (!repoPath.startsWith(reposDir + path.sep)) {
        throw new Error('Invalid repo path');
      }
      const entries = await fs.readdir(repoPath);
      fileStructure = `\n\n## Файлы в корне репо:\n${entries.filter(e => !e.startsWith('.')).join(', ')}`;
    } catch {
      // Repo not available locally
    }

    // ── ЭТАП 1: РАБОЧИЙ (work) ──────────────────────────────────────────
    const toolsDescription = getToolDescriptions();
    const projVision = getVisionContext();
    const workSystemPrompt = `Ты — Chimera AI, рабочий агент для анализа кода.

${projVision}

## Контекст проекта:

${projectContext || 'Данные проекта ещё загружаются.'}${fileStructure}

${mainChatContext ? `## Контекст основного чата\n${mainChatContext}\n` : ''}

## Доступные инструменты
${toolsDescription}

Для использования инструмента:
<tool_use name="tool_name">{"param": "value"}</tool_use>

## Чтение файлов проекта
- ПРЕДПОЧТИТЕЛЬНО: github tool с action "get_file" или "list_files", owner="${project.owner}", repo="${project.repo}"
- Альтернатива: file_system с путём ${project.owner}/${project.repo}/path/to/file
- Если один способ не работает — сразу пробуй другой

## Инструкции
- Выполняй задачу полностью — используй инструменты для получения данных
- Код, JSON, технические детали — МОЖНО, это внутренний рабочий контекст
- Если инструмент вернул ошибку — попробуй другой подход
- Отвечай на том языке, на котором пишет пользователь
- Не задавай лишних вопросов — действуй`;

    // Build conversation from project chat history
    const history = getChatHistory(projectId);
    const recentHistory = history.slice(-10);
    const conversationPrompt = recentHistory
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    // Get best available model
    const availableModels = getAvailableModels().filter(m => m.available);
    const bestModel = getBestModelForTask('code', availableModels);

    if (!bestModel) {
      return NextResponse.json({
        error: 'Нет доступных моделей. Проверьте API ключи.',
      }, { status: 503 });
    }

    const MAX_TOOL_ITERATIONS = 3;
    let currentPrompt = conversationPrompt;
    let totalLatency = 0;
    const workContextParts: string[] = [];
    let usedTools = false;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const isFollowUp = iteration > 0;
      const iterationSystemPrompt = isFollowUp
        ? workSystemPrompt + '\n\nТы получил результаты инструментов. Если ошибка — попробуй другой подход. Если данные есть — дай полный ответ.'
        : workSystemPrompt;

      const response = await generateWithModel(
        bestModel.provider,
        bestModel.apiModel,
        currentPrompt,
        iterationSystemPrompt
      );
      totalLatency += response.latency || 0;

      const toolCalls = parseToolCalls(response.content);

      if (toolCalls.length === 0) {
        workContextParts.push(`Ответ модели:\n${response.content}`);
        break;
      }

      usedTools = true;
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
            return `[${r.toolName}]: ${dataStr.length > 2000 ? dataStr.slice(0, 2000) + '... [обрезано]' : dataStr}`;
          }
          return `[${r.toolName}] ОШИБКА: ${r.result.error}`;
        })
        .join('\n\n');

      workContextParts.push(`Результаты инструментов:\n${toolResultsText}`);

      if (iteration < MAX_TOOL_ITERATIONS - 1) {
        const errorNote = hasErrors
          ? `\nОшибки. Попробуй другой подход: github tool с owner="${project.owner}", repo="${project.repo}".`
          : '\nДанные получены. Если нужно ещё — используй инструменты. Если достаточно — дай ответ.';
        currentPrompt = `Исходный запрос: ${message}\n\nТвой ответ:\n${cleanContent}\n\nРезультаты:\n${toolResultsText}${errorNote}`;
        continue;
      }

      if (cleanContent) {
        workContextParts.push(`Финальный ответ:\n${cleanContent}`);
      }
    }

    // ── ЭТАП 2: ФИНАЛИЗАЦИЯ (finalize) ──────────────────────────────────
    const workContext = workContextParts.join('\n\n---\n\n');

    const finalVision = getVisionContext();
    const finalizeSystemPrompt = `Ты — Chimera AI. Сформулируй чистый, понятный ответ пользователю о проекте ${project.name} (${project.owner}/${project.repo}).

${finalVision}

## Правила
- Отвечай на том языке, на котором пишет пользователь
- МАКСИМУМ 200 слов. Кратко, по делу
- Называй конкретные файлы, функции, проблемы
- НЕ задавай вопросов, если можешь ответить сам

## СТРОГО ЗАПРЕЩЕНО
- Блоки кода (\`\`\`)
- Сырой JSON
- Показ ошибок инструментов
- Повторение содержимого файлов дословно

## Формат
Краткий ответ + 2-3 следующих шага:

**Что дальше:**
• [действие]
• [действие]`;

    const finalizePrompt = `Запрос пользователя: ${message}

Рабочий контекст (НЕ показывай напрямую):
---
${workContext.slice(0, 6000)}
---

Сформулируй чистый ответ.`;

    const finalizeResponse = await generateWithModel(
      bestModel.provider,
      bestModel.apiModel,
      finalizePrompt,
      finalizeSystemPrompt
    );
    totalLatency += finalizeResponse.latency || 0;

    let finalContent = stripCodeBlocks(finalizeResponse.content || '');
    if (!finalContent.trim()) {
      finalContent = 'Задача обработана, но не удалось сформулировать ответ. Попробуйте переформулировать запрос.';
    }

    console.log(`[ProjectChat] ${project.owner}/${project.repo}: tools=${usedTools}, finalized=${finalContent.length} chars`);

    // Add assistant message to history
    addChatMessage(projectId, { role: 'assistant', content: finalContent, timestamp: Date.now() });

    return NextResponse.json({
      message: finalContent,
      model: bestModel.name,
      latency: totalLatency,
    });

  } catch (error) {
    console.error('Project chat error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Chat failed' },
      { status: 500 }
    );
  }
}

// GET - retrieve chat history for a project
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const history = getChatHistory(projectId);
  return NextResponse.json({ messages: history });
}
