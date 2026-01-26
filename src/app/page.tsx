'use client';

import { useState, useEffect } from 'react';
import { Header, ChatInput, MessageList, ProjectsDashboard, ActivityFeed, useActivityFeed } from '@/components';
import type { ModelActivity } from '@/components';
import { Message, ModelConfig, ClarificationRequest, ExecutionPlan, ModelProvider } from '@/types';
import { MessageSquare, FolderGit2, Settings } from 'lucide-react';

type TabType = 'chat' | 'projects' | 'settings';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingClarification, setPendingClarification] = useState<{
    messageId: string;
    request: ClarificationRequest;
    originalMessage: string;
  } | null>(null);
  const [activityExpanded, setActivityExpanded] = useState(true);
  const { activities, addActivity, updateActivity, clearActivities } = useActivityFeed();

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

  const handleSubmit = async (input: string, attachments?: File[]) => {
    if (!input.trim()) return;

    // Check if user wants to analyze a project
    const revisionMatch = input.match(/(?:ревизи[яю]|проверь|анализ|review|analyze)\s+(?:проект[а]?\s+)?(.+)/i);
    if (revisionMatch) {
      setActiveTab('projects');
      return;
    }

    // Add user message
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

    setIsProcessing(true);
    clearActivities();

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

      // Simulate status updates
      setTimeout(() => updateActivity(activityId, { status: 'generating', task: 'Генерирую ответ...' }), 1500);
    }

    try {
      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input }),
      });

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
      } else if (data.type === 'result') {
        addMessage({
          role: 'assistant',
          content: data.message,
          executionPlan: data.plan,
        });
      } else if (data.type === 'error') {
        addMessage({
          role: 'assistant',
          content: `❌ Ошибка: ${data.message}`,
        });
      }
    } catch (error) {
      console.error('Submit error:', error);
      addMessage({
        role: 'assistant',
        content: '❌ Произошла ошибка при обработке запроса. Попробуйте снова.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

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
      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: pendingClarification.originalMessage,
          clarificationAnswers: answers,
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
        content: '❌ Ошибка при обработке уточнений.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const executePlan = async (plan: ExecutionPlan, messageId: string) => {
    try {
      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedPlan: plan }),
      });

      const data = await response.json();

      if (data.type === 'execution_complete') {
        updateMessage(messageId, { executionPlan: data.plan });

        const resultContent = data.results
          .map((r: { phase: string; result: { output?: string; code?: string; synthesis?: string } }) => {
            const output = r.result?.output || r.result?.code || r.result?.synthesis || 'Completed';
            return `**${r.phase}:**\n${output}`;
          })
          .join('\n\n');

        addMessage({
          role: 'assistant',
          content: `✅ Выполнение завершено!\n\n${resultContent}`,
        });
      }
    } catch (error) {
      console.error('Execution error:', error);
      addMessage({
        role: 'assistant',
        content: '❌ Ошибка при выполнении плана.',
      });
    }
  };

  const tabs = [
    { id: 'chat' as TabType, label: 'Chat', icon: MessageSquare },
    { id: 'projects' as TabType, label: 'Projects', icon: FolderGit2 },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen flex-col">
      <Header models={models} />

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
                onSubmit={handleSubmit}
                isProcessing={isProcessing}
                placeholder="Опишите задачу... (Shift+Enter для новой строки)"
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
