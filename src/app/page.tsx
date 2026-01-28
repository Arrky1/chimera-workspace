'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Header,
  ChatInput,
  MessageList,
  ProjectsDashboard,
  ActivityFeed,
  useActivityFeed,
  OrchestrationGraph,
  ModelContributionStats,
  EventLog,
  useEventLog,
} from '@/components';
import type { ModelActivity } from '@/components';
import { Message, ModelConfig, ClarificationRequest, ExecutionPlan, ModelProvider, ExecutionMode } from '@/types';
import { MessageSquare, FolderGit2, Settings, Activity } from 'lucide-react';

type TabType = 'chat' | 'projects' | 'monitor' | 'settings';

interface QueuedMessage {
  id: string;
  input: string;
  attachments?: File[];
  status: 'queued' | 'processing';
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('chimera-chat-messages');
        if (stored) {
          const parsed = JSON.parse(stored) as Message[];
          return parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
        }
      } catch (e) {
        console.error('Failed to load chat history:', e);
      }
    }
    return [];
  });
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingClarification, setPendingClarification] = useState<{
    messageId: string;
    request: ClarificationRequest;
    originalMessage: string;
  } | null>(null);
  const [activityExpanded, setActivityExpanded] = useState(true);
  const { activities, addActivity, updateActivity, clearActivities } = useActivityFeed();
  const { events, addEvent, clearEvents, exportEvents } = useEventLog();
  const [sessionId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('chimera-session-id');
      if (stored) return stored;
      const newId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('chimera-session-id', newId);
      return newId;
    }
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });
  const [chatInputValue, setChatInputValue] = useState('');
  const [currentMode, setCurrentMode] = useState<ExecutionMode>('single');
  const [modelStats, setModelStats] = useState<{
    provider: ModelProvider;
    name: string;
    tokens: number;
    tasks: number;
    avgTime: number;
    contribution: number;
  }[]>([]);

  // Message queue
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const processingRef = useRef(false);

  // Persist messages to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // Keep only real messages (no queue placeholders), limit to 500
      const toSave = messages
        .filter(m => !m.queueStatus)
        .slice(-500);
      localStorage.setItem('chimera-chat-messages', JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save chat history:', e);
    }
  }, [messages]);

  // Fetch available models on mount
  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      const response = await fetch('/api/orchestrate');
      const data = await response.json();
      setModels(data.models || []);
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  };

  const addMessage = (message: Omit<Message, 'id' | 'timestamp'>): Message => {
    const newMessage: Message = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  };

  const updateMessage = (id: string, updates: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  };

  // Enqueue message — user can always send, messages queue up
  const enqueueMessage = useCallback((input: string, attachments?: File[]) => {
    if (!input.trim()) return;

    // Check if user wants to work with a project — instant, no queue
    const revisionMatch = input.match(/(?:ревизи[яю]|проверь|анализ|review|analyze)\s+(?:проект[а]?\s+)?(.+)/i);
    if (revisionMatch) {
      addMessage({ role: 'user', content: input });
      addMessage({ role: 'assistant', content: 'Переключаюсь на вкладку Projects. Используйте чат проекта для работы с конкретным репозиторием.' });
      setActiveTab('projects');
      return;
    }

    const queueId = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Add user message immediately (always visible)
    addMessage({
      role: 'user',
      content: input,
      attachments: attachments?.map((f) => ({
        type: f.type.startsWith('image/') ? 'image' : 'file',
        name: f.name,
        url: URL.createObjectURL(f),
        mimeType: f.type,
      })),
    });

    // If already processing, add a placeholder showing queue status
    if (processingRef.current) {
      addMessage({
        role: 'assistant',
        content: '',
        queueStatus: 'queued',
        queueId,
      });
    }

    // Add to queue
    setMessageQueue(prev => [...prev, {
      id: queueId,
      input,
      attachments,
      status: 'queued',
    }]);
  }, []);

  // Process a single message (extracted from old handleSubmit)
  const processMessage = useCallback(async (input: string, queueId: string) => {
    clearActivities();

    // Update placeholder from "queued" to "processing"
    setMessages(prev => prev.map(msg =>
      msg.queueId === queueId ? { ...msg, queueStatus: 'processing' as const } : msg
    ));

    // Simulate AI activity
    const availableModels = models.filter(m => m.available);
    const primaryModel = availableModels[0];

    if (primaryModel) {
      const activityId = addActivity({
        model: primaryModel.provider as ModelProvider,
        modelName: primaryModel.name,
        status: 'thinking',
        task: `Анализирую запрос: "${input.slice(0, 50)}${input.length > 50 ? '...' : ''}"`,
        startTime: Date.now(),
      });
      setTimeout(() => updateActivity(activityId, { status: 'generating', task: 'Генерирую ответ...' }), 1500);
    }

    // Remove placeholder helper
    const removePlaceholder = () => {
      setMessages(prev => prev.filter(msg => msg.queueId !== queueId));
    };

    try {
      const recentHistory = messages.slice(-30).map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      }));

      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          history: recentHistory,
          sessionId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`API error ${response.status}:`, errorText);
        let errorData;
        try { errorData = JSON.parse(errorText); } catch { errorData = null; }
        const errorMsg = errorData?.message || errorData?.details || `Сервер вернул ошибку ${response.status}`;
        removePlaceholder();
        addMessage({ role: 'assistant', content: `Ошибка: ${errorMsg}` });
        return;
      }

      const data = await response.json();

      // Mark activity complete
      if (activities.length > 0) {
        const lastActivity = activities[activities.length - 1];
        updateActivity(lastActivity.id, {
          status: 'complete',
          endTime: Date.now(),
          output: data.message?.slice(0, 200),
        });
      }

      removePlaceholder();

      if (data.type === 'clarification') {
        const assistantMessage = addMessage({
          role: 'assistant',
          content: data.message,
          clarification: data.clarification,
        });

        setPendingClarification({
          messageId: assistantMessage.id,
          request: data.clarification,
          originalMessage: input,
        });
      } else if (data.type === 'plan') {
        const assistantMessage = addMessage({
          role: 'assistant',
          content: data.message,
          executionPlan: data.plan,
        });

        if (data.requiresConfirmation) {
          await executePlan(data.plan, assistantMessage.id);
        }
      } else if (data.type === 'execution_complete') {
        addMessage({
          role: 'assistant',
          content: data.message || 'Выполнение завершено.',
          executionPlan: data.plan,
        });
      } else if (data.type === 'result') {
        addMessage({
          role: 'assistant',
          content: data.message,
          executionPlan: data.plan,
        });
      } else if (data.type === 'error') {
        addMessage({
          role: 'assistant',
          content: `Ошибка: ${data.message}`,
        });
      }
    } catch (error) {
      console.error('Submit error:', error);
      removePlaceholder();
      addMessage({
        role: 'assistant',
        content: 'Произошла ошибка при обработке запроса. Попробуйте снова.',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, messages, sessionId, activities]);

  // Queue processor — picks next queued message when ready
  useEffect(() => {
    if (processingRef.current) return;
    if (pendingClarification) return;

    const nextItem = messageQueue.find(m => m.status === 'queued');
    if (!nextItem) {
      if (messageQueue.length === 0) setIsProcessing(false);
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);

    // Mark as processing in queue
    setMessageQueue(prev =>
      prev.map(m => m.id === nextItem.id ? { ...m, status: 'processing' as const } : m)
    );

    processMessage(nextItem.input, nextItem.id).finally(() => {
      // Remove from queue, release lock
      setMessageQueue(prev => prev.filter(m => m.id !== nextItem.id));
      processingRef.current = false;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageQueue, pendingClarification]);

  const handleClarificationAnswer = async (answers: Record<string, string>) => {
    if (!pendingClarification) return;

    updateMessage(pendingClarification.messageId, { clarification: undefined });
    setPendingClarification(null);

    const answerText = Object.entries(answers)
      .map(([_, value]) => value)
      .join(', ');
    addMessage({
      role: 'user',
      content: `Уточнение: ${answerText}`,
    });

    setIsProcessing(true);

    try {
      const recentHistory = messages.slice(-30).map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      }));

      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: pendingClarification.originalMessage,
          clarificationAnswers: answers,
          history: recentHistory,
          sessionId,
        }),
      });

      const data = await response.json();

      if (data.type === 'plan') {
        const assistantMessage = addMessage({
          role: 'assistant',
          content: 'Отлично! Вот план выполнения:',
          executionPlan: data.plan,
        });

        await executePlan(data.plan, assistantMessage.id);
      } else if (data.type === 'execution_complete') {
        addMessage({
          role: 'assistant',
          content: data.message || 'Выполнение завершено.',
          executionPlan: data.plan,
        });
      } else if (data.type === 'result') {
        addMessage({
          role: 'assistant',
          content: data.message,
          executionPlan: data.plan,
        });
      }
    } catch (error) {
      console.error('Clarification error:', error);
      addMessage({
        role: 'assistant',
        content: 'Ошибка при обработке уточнений.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const executePlan = async (plan: ExecutionPlan, messageId: string) => {
    try {
      // Immediately mark plan as executing with first phase running
      const runningPlan = {
        ...plan,
        status: 'executing' as const,
        phases: plan.phases.map((p, i) => ({
          ...p,
          status: i === 0 ? ('running' as const) : p.status,
          progress: i === 0 ? 10 : p.progress,
        })),
      };
      updateMessage(messageId, { executionPlan: runningPlan });

      // Simulate progress updates while waiting
      let progressInterval: NodeJS.Timeout | null = null;
      let currentProgress = 10;
      progressInterval = setInterval(() => {
        currentProgress = Math.min(currentProgress + 5, 90);
        const updatedPlan = {
          ...runningPlan,
          phases: runningPlan.phases.map((p, i) => ({
            ...p,
            progress: i === 0 ? currentProgress : p.progress,
          })),
        };
        updateMessage(messageId, { executionPlan: updatedPlan });
      }, 2000);

      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedPlan: plan, sessionId }),
      });

      // Stop progress simulation
      if (progressInterval) clearInterval(progressInterval);

      const data = await response.json();

      if (data.type === 'execution_complete') {
        updateMessage(messageId, {
          executionPlan: data.plan,
          content: data.message || 'Выполнение завершено.',
        });
      } else if (data.type === 'error') {
        updateMessage(messageId, {
          executionPlan: { ...plan, status: 'failed' as const },
        });
        addMessage({
          role: 'assistant',
          content: `Ошибка: ${data.message}`,
        });
      }
    } catch (error) {
      console.error('Execution error:', error);
      addMessage({
        role: 'assistant',
        content: 'Ошибка при выполнении плана.',
      });
    }
  };

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setMessageQueue([]);
    setPendingClarification(null);
    setIsProcessing(false);
    processingRef.current = false;
    setChatInputValue('');
    clearActivities();
    clearEvents();
    // Generate new session
    const newId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('chimera-session-id', newId);
    localStorage.removeItem('chimera-chat-messages');
    // Force reload to pick up new sessionId
    window.location.reload();
  }, [clearActivities, clearEvents]);

  const tabs = [
    { id: 'chat' as TabType, label: 'Chat', icon: MessageSquare },
    { id: 'projects' as TabType, label: 'Projects', icon: FolderGit2 },
    { id: 'monitor' as TabType, label: 'Monitor', icon: Activity },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen flex-col">
      <Header models={models} onNewChat={handleNewChat} />

      {/* Tabs */}
      <div className="border-b border-orchestrator-border bg-orchestrator-card">
        <div className="flex px-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-orchestrator-accent text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'chat' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Main Chat Area */}
            <div className="flex flex-1 flex-col">
              <MessageList
                messages={messages}
                onClarificationAnswer={
                  pendingClarification ? handleClarificationAnswer : undefined
                }
              />
              <ChatInput
                onSubmit={enqueueMessage}
                isProcessing={isProcessing}
                placeholder="Опишите задачу... (Shift+Enter для новой строки)"
                value={chatInputValue}
                onChange={setChatInputValue}
                queueLength={messageQueue.filter(m => m.status === 'queued').length}
              />
            </div>

            {/* Activity Sidebar */}
            {(isProcessing || activities.length > 0) && (
              <div className="w-80 border-l border-orchestrator-border bg-orchestrator-card p-4 overflow-y-auto">
                <ActivityFeed
                  activities={activities}
                  isExpanded={activityExpanded}
                  onToggleExpand={() => setActivityExpanded(!activityExpanded)}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'projects' && <ProjectsDashboard />}

        {activeTab === 'monitor' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-7xl mx-auto space-y-6">
              <h2 className="text-xl font-semibold text-white">Orchestration Monitor</h2>

              {/* Orchestration Graph */}
              <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
                <h3 className="text-sm font-medium text-white mb-4">AI Team Workflow</h3>
                <OrchestrationGraph
                  mode={currentMode}
                  activeModels={models.filter(m => m.available).map(m => ({
                    provider: m.provider,
                    name: m.name,
                    status: activities.find(a => a.model === m.provider)?.status === 'thinking' ||
                            activities.find(a => a.model === m.provider)?.status === 'generating'
                      ? 'active' as const
                      : 'idle' as const,
                    task: activities.find(a => a.model === m.provider)?.task,
                    tokens: modelStats.find(s => s.provider === m.provider)?.tokens,
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Model Statistics */}
                <ModelContributionStats
                  stats={modelStats.length > 0 ? modelStats : models.filter(m => m.available).map(m => ({
                    provider: m.provider,
                    name: m.name,
                    tokens: Math.floor(Math.random() * 10000),
                    tasks: Math.floor(Math.random() * 20),
                    avgTime: Math.random() * 5 + 1,
                    contribution: 100 / models.filter(m => m.available).length,
                  }))}
                  totalTokens={modelStats.reduce((sum, s) => sum + s.tokens, 0) || 25000}
                  totalTasks={modelStats.reduce((sum, s) => sum + s.tasks, 0) || 42}
                />

                {/* Event Log */}
                <EventLog
                  events={events}
                  onClear={clearEvents}
                  onExport={exportEvents}
                  maxHeight="300px"
                />
              </div>

              {/* AI Team Members */}
              <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
                <h3 className="text-sm font-medium text-white mb-4">AI Development Team</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {[
                    { name: 'Alex', role: 'Lead Architect', model: 'Claude Opus', provider: 'claude' as ModelProvider, emoji: '🧠', specialty: 'Architecture & Complex Tasks' },
                    { name: 'Max', role: 'Senior Developer', model: 'GPT-5.2', provider: 'openai' as ModelProvider, emoji: '💻', specialty: 'Code & Mathematics' },
                    { name: 'Lena', role: 'QA Engineer', model: 'Gemini Pro', provider: 'gemini' as ModelProvider, emoji: '🔍', specialty: 'Testing & Multimodal' },
                    { name: 'Ivan', role: 'Research Engineer', model: 'DeepSeek R1', provider: 'deepseek' as ModelProvider, emoji: '🔬', specialty: 'Deep Reasoning' },
                    { name: 'Dasha', role: 'Fast Coder', model: 'Claude Sonnet', provider: 'claude' as ModelProvider, emoji: '⚡', specialty: 'Quick Tasks' },
                  ].map((member) => {
                    const isAvailable = models.some(m => m.provider === member.provider && m.available);
                    const isActive = activities.some(a => a.model === member.provider && (a.status === 'thinking' || a.status === 'generating'));

                    return (
                      <div
                        key={member.name}
                        className={`p-4 rounded-lg border transition-all ${
                          isActive
                            ? 'border-orchestrator-accent bg-orchestrator-accent/10'
                            : isAvailable
                            ? 'border-orchestrator-border bg-orchestrator-bg'
                            : 'border-orchestrator-border/50 bg-orchestrator-bg/50 opacity-50'
                        }`}
                      >
                        <div className="text-2xl mb-2">{member.emoji}</div>
                        <div className="text-sm font-medium text-white">{member.name}</div>
                        <div className="text-xs text-orchestrator-accent">{member.role}</div>
                        <div className="text-xs text-gray-500 mt-1">{member.model}</div>
                        <div className="text-xs text-gray-400 mt-2">{member.specialty}</div>
                        {isActive && (
                          <div className="mt-2 flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs text-green-400">Working...</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <h2 className="text-xl font-semibold text-white mb-6">Settings</h2>

            {/* API Keys */}
            <div className="space-y-6">
              <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-6">
                <h3 className="text-lg font-medium text-white mb-4">API Keys</h3>
                <div className="space-y-4">
                  {models.map((model) => (
                    <div key={model.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-3 w-3 rounded-full ${
                            model.available ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                        <span className="text-white">{model.name}</span>
                        <span className="text-xs text-gray-500">({model.provider})</span>
                      </div>
                      <span className={model.available ? 'text-green-400' : 'text-red-400'}>
                        {model.available ? 'Connected' : 'Not configured'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-gray-400">
                  Configure API keys in your environment variables (.env.local)
                </p>
              </div>

              {/* Model Preferences */}
              <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-6">
                <h3 className="text-lg font-medium text-white mb-4">Model Preferences</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Default for Code Tasks</label>
                    <select className="w-full rounded-lg border border-orchestrator-border bg-orchestrator-bg px-4 py-2 text-white">
                      <option value="claude">Claude Opus 4.5</option>
                      <option value="gpt4">GPT-4</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Default for Review</label>
                    <select className="w-full rounded-lg border border-orchestrator-border bg-orchestrator-bg px-4 py-2 text-white">
                      <option value="openai">GPT-4 Turbo</option>
                      <option value="claude">Claude Sonnet</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Execution Settings */}
              <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-6">
                <h3 className="text-lg font-medium text-white mb-4">Execution</h3>
                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <input type="checkbox" className="accent-orchestrator-accent" defaultChecked />
                    <span className="text-white">Auto-execute simple tasks</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" className="accent-orchestrator-accent" defaultChecked />
                    <span className="text-white">Show clarification questions</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" className="accent-orchestrator-accent" />
                    <span className="text-white">Use Council mode for architecture decisions</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
