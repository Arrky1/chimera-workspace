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

    if (!projectId || !message) {
      return NextResponse.json({ error: 'projectId and message required' }, { status: 400 });
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
      const reposDir = path.join(process.cwd(), '.chimera-repos');
      const repoPath = path.join(reposDir, project.owner, project.repo);
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

## Для file_system используй путь: ${project.owner}/${project.repo}/...
## Для github: owner="${project.owner}", repo="${project.repo}"

## Инструкции
- Отвечай на вопросы о проекте используя контекст выше
- Используй file_system для чтения конкретных файлов
- Будь конкретным — называй файлы, строки, проблемы
- Предлагай исправления с примерами кода
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

    // Generate response
    const response = await generateWithModel(
      bestModel.provider,
      bestModel.apiModel,
      conversationPrompt,
      systemPrompt
    );

    let finalContent = response.content;

    // Process tool calls
    const toolCalls = parseToolCalls(finalContent);
    if (toolCalls.length > 0) {
      const toolResults = await executeToolCalls(toolCalls);

      // Strip tool_use XML from visible response
      let cleanContent = finalContent.replace(/<tool_use name="\w+">[\s\S]*?<\/tool_use>/g, '').trim();

      // Format tool results
      const toolResultsText = toolResults
        .map(r => {
          if (r.result.success) {
            const data = r.result.data;
            return typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
          }
          return `Ошибка: ${r.result.error}`;
        })
        .join('\n\n');

      finalContent = cleanContent + (toolResultsText ? `\n\n${toolResultsText}` : '');
    }

    // Add assistant message to history
    addChatMessage(projectId, { role: 'assistant', content: finalContent, timestamp: Date.now() });

    return NextResponse.json({
      message: finalContent,
      model: bestModel.name,
      latency: response.latency,
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
