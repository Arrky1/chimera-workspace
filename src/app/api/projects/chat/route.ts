import { NextRequest, NextResponse } from 'next/server';
import { generateWithModel, getAvailableModels, getBestModelForTask } from '@/lib/models';
import { parseToolCalls, executeToolCalls, getToolDescriptions } from '@/lib/mcp';
import {
  getProject, getProjectContextSummary,
  getChatHistory, addChatMessage,
} from '@/lib/project-store';
import * as fs from 'fs/promises';
import * as path from 'path';

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

    // Try to get file listing from cloned repo
    let fileStructure = '';
    try {
      // Sanitize owner/repo to prevent path traversal
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

    // Build system prompt with full project context
    const toolsDescription = getToolDescriptions();
    const systemPrompt = `Ты — Chimera AI, мультимодельный ассистент для анализа кода. Ты работаешь в контексте конкретного проекта и знаешь его код, проблемы и метрики.

${projectContext || 'Данные проекта ещё загружаются.'}${fileStructure}

## Доступные инструменты
${toolsDescription}

Для использования инструмента:
<tool_use name="tool_name">{"param": "value"}</tool_use>

## Чтение файлов проекта
- ПРЕДПОЧТИТЕЛЬНО: github tool с action "get_file" или "list_files", owner="${project.owner}", repo="${project.repo}"
- Альтернатива: file_system с путём ${project.owner}/${project.repo}/path/to/file
- Если один способ не работает — сразу пробуй другой

## Инструкции
- Отвечай КРАТКО и по делу. Не выдавай огромные блоки кода если не просят
- Если нужен код — показывай только ключевые фрагменты (до 20 строк), не весь файл
- Отвечай на вопросы о проекте используя контекст выше
- Будь конкретным — называй файлы, строки, проблемы
- Предлагай исправления с примерами кода
- НИКОГДА не показывай пользователю сырые ошибки инструментов — если инструмент не сработал, попробуй другой подход
- Отвечай на том языке, на котором пишет пользователь
- Не задавай лишних вопросов — сразу действуй`;

    // Build conversation from history (last 10 messages)
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

    // Agentic loop: model calls tools, gets results back, can retry on errors
    const MAX_TOOL_ITERATIONS = 3;
    let currentPrompt = conversationPrompt;
    let finalContent = '';
    let totalLatency = 0;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const isFollowUp = iteration > 0;
      const iterationSystemPrompt = isFollowUp
        ? systemPrompt + '\n\n## ВАЖНО: Ты получил результаты инструментов. Если была ошибка — попробуй другой подход (github tool вместо file_system). НЕ показывай пользователю сырые ошибки.'
        : systemPrompt;

      const response = await generateWithModel(
        bestModel.provider,
        bestModel.apiModel,
        currentPrompt,
        iterationSystemPrompt
      );
      totalLatency += response.latency || 0;

      const toolCalls = parseToolCalls(response.content);

      if (toolCalls.length === 0) {
        finalContent = response.content;
        break;
      }

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
        currentPrompt = `${conversationPrompt}\n\nТвой ответ:\n${cleanContent}\n\nРезультаты инструментов:\n${toolResultsText}\n\nОшибки в инструментах. Попробуй другой подход:\n- file_system не работает → используй github tool с action "get_file" или "list_files", owner="${project.owner}", repo="${project.repo}"\nДай полезный результат без ошибок.`;
        continue;
      }

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
        finalContent = cleanContent || 'Не удалось прочитать файлы проекта. Попробуйте переформулировать запрос.';
      }
      break;
    }

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
