'use client';

import { useState, useEffect } from 'react';
import { Header, ChatInput, MessageList } from '@/components';
import { Message, ModelConfig, ClarificationRequest, ExecutionPlan } from '@/types';

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingClarification, setPendingClarification] = useState<{
    messageId: string;
    request: ClarificationRequest;
    originalMessage: string;
  } | null>(null);

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

    try {
      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input }),
      });

      const data = await response.json();

      if (data.type === 'clarification') {
        // Show clarification questions
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
        // Show execution plan
        const assistantMessage = addMessage({
          role: 'assistant',
          content: data.message,
          executionPlan: data.plan,
        });

        // Auto-execute for now (could add confirmation UI)
        if (data.requiresConfirmation) {
          await executePlan(data.plan, assistantMessage.id);
        }
      } else if (data.type === 'result') {
        // Show result
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

    // Remove clarification from message
    updateMessage(pendingClarification.messageId, { clarification: undefined });
    setPendingClarification(null);

    // Add user's clarification response
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
        // Update plan in message
        updateMessage(messageId, { executionPlan: data.plan });

        // Add result message
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

  return (
    <div className="flex h-screen flex-col">
      <Header models={models} />

      <main className="flex flex-1 flex-col overflow-hidden">
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
      </main>
    </div>
  );
}
