/**
 * Shared in-memory project storage
 * Used by both /api/projects and /api/projects/chat
 */

import { Project, ProjectAnalysis } from '@/types/project';

// In-memory storage (use DB in production)
const projects = new Map<string, Project>();
const analyses = new Map<string, ProjectAnalysis>();

// Chat history per project
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

const projectChats = new Map<string, ChatMessage[]>();

// Project CRUD
export function getProject(id: string): Project | undefined {
  return projects.get(id);
}

export function getAllProjects(): Project[] {
  return Array.from(projects.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function setProject(id: string, project: Project): void {
  projects.set(id, project);
}

export function deleteProject(id: string): boolean {
  analyses.delete(id);
  projectChats.delete(id);
  return projects.delete(id);
}

export function hasProject(githubUrl: string): Project | undefined {
  return Array.from(projects.values()).find(p => p.githubUrl === githubUrl);
}

// Analysis CRUD
export function getAnalysis(projectId: string): ProjectAnalysis | undefined {
  return analyses.get(projectId);
}

export function setAnalysis(projectId: string, analysis: ProjectAnalysis): void {
  analyses.set(projectId, analysis);
}

// Chat history
export function getChatHistory(projectId: string): ChatMessage[] {
  return projectChats.get(projectId) || [];
}

export function addChatMessage(projectId: string, message: ChatMessage): void {
  if (!projectChats.has(projectId)) {
    projectChats.set(projectId, []);
  }
  const history = projectChats.get(projectId)!;
  history.push(message);

  // Keep last 50 messages
  if (history.length > 50) {
    projectChats.set(projectId, history.slice(-50));
  }
}

// Get project context summary for chat
export function getProjectContextSummary(projectId: string): string | null {
  const project = projects.get(projectId);
  if (!project) return null;

  const analysis = analyses.get(projectId);

  let context = `## Проект: ${project.name}
- GitHub: ${project.githubUrl}
- Owner: ${project.owner}
- Repo: ${project.repo}
- Язык: ${project.language}
- Ветка: ${project.defaultBranch}
- Статус: ${project.status}`;

  if (analysis) {
    context += `\n\n## Здоровье: ${analysis.healthScore}%
- Безопасность: ${analysis.scores.security}%
- Производительность: ${analysis.scores.performance}%
- Качество кода: ${analysis.scores.codeQuality}%
- Архитектура: ${analysis.scores.architecture}%

## Статистика
- Файлов: ${analysis.summary.totalFiles}
- Строк: ${analysis.summary.totalLines}
- Фреймворк: ${analysis.summary.framework || 'N/A'}

## Проблемы (${analysis.issues.length} всего)`;

    const critical = analysis.issues.filter(i => i.severity === 'critical');
    const high = analysis.issues.filter(i => i.severity === 'high');
    const medium = analysis.issues.filter(i => i.severity === 'medium');

    if (critical.length > 0) {
      context += `\n\n### Критические (${critical.length}):`;
      for (const issue of critical.slice(0, 5)) {
        context += `\n- [${issue.category}] ${issue.title}: ${issue.description}${issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : ''}`;
      }
    }
    if (high.length > 0) {
      context += `\n\n### Высокие (${high.length}):`;
      for (const issue of high.slice(0, 5)) {
        context += `\n- [${issue.category}] ${issue.title}: ${issue.description}${issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : ''}`;
      }
    }
    if (medium.length > 0) {
      context += `\n\n### Средние (${medium.length}):`;
      for (const issue of medium.slice(0, 5)) {
        context += `\n- [${issue.category}] ${issue.title}: ${issue.description}${issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : ''}`;
      }
    }
  }

  return context;
}
