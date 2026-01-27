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
// Storage
// =============================================================================

const MAX_HISTORY = 50;
const MAX_TASK_TREES = 20;

// sessionId -> ChatMessage[]
const chatHistories = new Map<string, ChatMessage[]>();

// sessionId -> TaskTree[]
const taskTrees = new Map<string, TaskTree[]>();

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
}

/**
 * Build conversation context string from history (last N messages)
 * for injection into the model prompt
 */
export function buildConversationContext(
  sessionId: string = DEFAULT_SESSION,
  maxMessages: number = 10
): string {
  const history = getChatHistory(sessionId);
  if (history.length === 0) return '';

  const recent = history.slice(-maxMessages);

  // Trim long assistant messages to avoid blowing up prompt
  const formatted = recent.map(m => {
    const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
    let content = m.content;
    // Trim assistant messages over 500 chars — just keep summary
    if (m.role === 'assistant' && content.length > 500) {
      content = content.slice(0, 500) + '... [сокращено]';
    }
    return `${role}: ${content}`;
  }).join('\n\n');

  return `## История диалога (последние ${recent.length} сообщений)\n\n${formatted}`;
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
