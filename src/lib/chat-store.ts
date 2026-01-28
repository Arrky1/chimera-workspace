/**
 * Chat history & task tree store for Chimera main orchestrator
 *
 * Separate from project-store.ts which handles per-project chat.
 * This handles the main orchestration chat with session-based history
 * and a hierarchical task tree.
 */

// =============================================================================
// Types
// =============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface TaskNode {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  children: TaskNode[];
  provider?: string;
  createdAt: number;
  completedAt?: number;
}

export interface TaskTree {
  rootTask: string;
  nodes: TaskNode[];
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// Vision Context (configurable project identity)
// =============================================================================

let currentVisionText: string = '';

export function getVisionContext(): string {
  if (!currentVisionText.trim()) return '';
  return `## О проекте\n${currentVisionText}`;
}

export function setVisionContext(text: string): void {
  currentVisionText = text.slice(0, 5000); // limit to 5000 chars
}

export function getRawVisionText(): string {
  return currentVisionText;
}

// =============================================================================
// Storage
// =============================================================================

const MAX_HISTORY = 100;
const MAX_TASK_TREES = 20;
const SUMMARY_THRESHOLD = 30; // Summarize when history exceeds this

// sessionId -> ChatMessage[]
const chatHistories = new Map<string, ChatMessage[]>();

// sessionId -> TaskTree[]
const taskTrees = new Map<string, TaskTree[]>();

// sessionId -> summary of older messages
const chatSummaries = new Map<string, string>();

// sessionId -> count of messages when summary was last generated
const summaryMessageCounts = new Map<string, number>();

// Default session for main chat (no project context)
const DEFAULT_SESSION = 'main';

// =============================================================================
// Chat History
// =============================================================================

export function getChatHistory(sessionId: string = DEFAULT_SESSION): ChatMessage[] {
  return chatHistories.get(sessionId) || [];
}

export function addChatMessage(
  message: ChatMessage,
  sessionId: string = DEFAULT_SESSION
): void {
  if (!chatHistories.has(sessionId)) {
    chatHistories.set(sessionId, []);
  }
  const history = chatHistories.get(sessionId)!;
  history.push(message);

  // Trim to keep last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) {
    chatHistories.set(sessionId, history.slice(-MAX_HISTORY));
  }
}

export function clearChatHistory(sessionId: string = DEFAULT_SESSION): void {
  chatHistories.delete(sessionId);
  chatSummaries.delete(sessionId);
  summaryMessageCounts.delete(sessionId);
}

// =============================================================================
// Chat Summary (for long conversations)
// =============================================================================

export function getChatSummary(sessionId: string = DEFAULT_SESSION): string | null {
  return chatSummaries.get(sessionId) || null;
}

export function setChatSummary(sessionId: string, summary: string): void {
  chatSummaries.set(sessionId, summary);
  const history = getChatHistory(sessionId);
  summaryMessageCounts.set(sessionId, history.length);
}

/**
 * Check if summarization is needed (history grew significantly since last summary)
 */
export function needsSummarization(sessionId: string = DEFAULT_SESSION): boolean {
  const history = getChatHistory(sessionId);
  if (history.length < SUMMARY_THRESHOLD) return false;

  const lastSummarizedAt = summaryMessageCounts.get(sessionId) || 0;
  // Re-summarize if 15+ new messages since last summary
  return history.length - lastSummarizedAt >= 15;
}

/**
 * Get messages that need to be summarized (older ones, excluding recent)
 */
export function getMessagesForSummary(
  sessionId: string = DEFAULT_SESSION,
  keepRecent: number = 15
): ChatMessage[] {
  const history = getChatHistory(sessionId);
  if (history.length <= keepRecent) return [];
  return history.slice(0, history.length - keepRecent);
}

/**
 * Build conversation context string from history (last N messages)
 * for injection into the model prompt.
 * If a summary exists, prepends it before recent messages.
 */
export function buildConversationContext(
  sessionId: string = DEFAULT_SESSION,
  maxMessages: number = 20
): string {
  const history = getChatHistory(sessionId);
  if (history.length === 0) return '';

  const summary = getChatSummary(sessionId);
  const recent = history.slice(-maxMessages);

  // Trim long assistant messages to avoid blowing up prompt
  const formatted = recent.map(m => {
    const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
    let content = m.content;
    if (m.role === 'assistant' && content.length > 500) {
      content = content.slice(0, 500) + '... [сокращено]';
    }
    return `${role}: ${content}`;
  }).join('\n\n');

  let result = '';

  if (summary) {
    result += `## Саммари предыдущего обсуждения\n${summary}\n\n`;
  }

  result += `## История диалога (последние ${recent.length} сообщений)\n\n${formatted}`;

  return result;
}

// =============================================================================
// Task Tree
// =============================================================================

export function getTaskTrees(sessionId: string = DEFAULT_SESSION): TaskTree[] {
  return taskTrees.get(sessionId) || [];
}

export function getLatestTaskTree(sessionId: string = DEFAULT_SESSION): TaskTree | null {
  const trees = taskTrees.get(sessionId);
  if (!trees || trees.length === 0) return null;
  return trees[trees.length - 1];
}

export function createTaskTree(
  rootTask: string,
  nodes: TaskNode[],
  sessionId: string = DEFAULT_SESSION
): TaskTree {
  const tree: TaskTree = {
    rootTask,
    nodes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (!taskTrees.has(sessionId)) {
    taskTrees.set(sessionId, []);
  }
  const trees = taskTrees.get(sessionId)!;
  trees.push(tree);

  // Keep only last N trees
  if (trees.length > MAX_TASK_TREES) {
    taskTrees.set(sessionId, trees.slice(-MAX_TASK_TREES));
  }

  return tree;
}

export function updateTaskNode(
  nodeId: string,
  updates: Partial<Pick<TaskNode, 'status' | 'result' | 'provider' | 'completedAt'>>,
  sessionId: string = DEFAULT_SESSION
): boolean {
  const tree = getLatestTaskTree(sessionId);
  if (!tree) return false;

  const node = findNode(tree.nodes, nodeId);
  if (!node) return false;

  Object.assign(node, updates);
  tree.updatedAt = Date.now();
  return true;
}

function findNode(nodes: TaskNode[], id: string): TaskNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Build task tree context string for injection into prompts
 */
export function buildTaskTreeContext(sessionId: string = DEFAULT_SESSION): string {
  const tree = getLatestTaskTree(sessionId);
  if (!tree) return '';

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
    failed: '❌',
  };

  function renderNode(node: TaskNode, indent: number = 0): string {
    const prefix = '  '.repeat(indent);
    const emoji = statusEmoji[node.status] || '•';
    let line = `${prefix}${emoji} ${node.title}`;
    if (node.provider) line += ` (${node.provider})`;
    if (node.result && node.result.length < 100) line += ` → ${node.result}`;
    const childLines = node.children.map(c => renderNode(c, indent + 1)).join('\n');
    return childLines ? `${line}\n${childLines}` : line;
  }

  const rendered = tree.nodes.map(n => renderNode(n)).join('\n');
  return `## Дерево задач: ${tree.rootTask}\n${rendered}`;
}
