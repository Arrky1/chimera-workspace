'use client';

import { useEffect, useRef } from 'react';
import { Message } from '@/types';
import { User, Bot, Image as ImageIcon, FileText, Clock, Loader2 } from 'lucide-react';
import { ClarificationDialog } from './ClarificationDialog';
import { ExecutionStatus } from './ExecutionStatus';

interface MessageListProps {
  messages: Message[];
  onClarificationAnswer?: (answers: Record<string, string>) => void;
}

export function MessageList({ messages, onClarificationAnswer }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
          <Bot size={48} className="mb-4 text-orchestrator-accent" />
          <h2 className="text-xl font-semibold text-white mb-2">
            Unified Orchestrator
          </h2>
          <p className="max-w-md">
            Опишите задачу, и я определю лучший способ её выполнения:
            одиночный агент, Council (голосование), Swarm (параллельно),
            или Deliberation (итеративный review).
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-orchestrator-border p-3 text-left">
              <span className="font-medium text-white">Council</span>
              <p className="text-gray-500">Модели голосуют за решение</p>
            </div>
            <div className="rounded-lg border border-orchestrator-border p-3 text-left">
              <span className="font-medium text-white">Deliberation</span>
              <p className="text-gray-500">Генерация + Review итерациями</p>
            </div>
            <div className="rounded-lg border border-orchestrator-border p-3 text-left">
              <span className="font-medium text-white">Swarm</span>
              <p className="text-gray-500">Параллельные агенты</p>
            </div>
            <div className="rounded-lg border border-orchestrator-border p-3 text-left">
              <span className="font-medium text-white">Debate</span>
              <p className="text-gray-500">Pro vs Con + Judge</p>
            </div>
          </div>
        </div>
      )}

      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex gap-3 animate-slide-up ${
            message.role === 'user' ? 'justify-end' : 'justify-start'
          }`}
        >
          {message.role === 'assistant' && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orchestrator-accent">
              <Bot size={16} />
            </div>
          )}

          <div
            className={`max-w-[80%] rounded-2xl px-4 py-3 ${
              message.role === 'user'
                ? 'message-user'
                : 'message-assistant'
            }`}
          >
            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.attachments.map((attachment, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1 text-sm"
                  >
                    {attachment.type === 'image' ? (
                      <ImageIcon size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
                    <span>{attachment.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Queue status placeholder */}
            {message.queueStatus ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-1">
                {message.queueStatus === 'queued' ? (
                  <>
                    <Clock size={14} className="text-yellow-500" />
                    <span>В очереди...</span>
                  </>
                ) : (
                  <>
                    <Loader2 size={14} className="animate-spin text-orchestrator-accent" />
                    <span>Обрабатываю...</span>
                  </>
                )}
              </div>
            ) : message.content ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : null}

            {/* Clarification dialog */}
            {message.clarification && onClarificationAnswer && (
              <div className="mt-3">
                <ClarificationDialog
                  request={message.clarification}
                  onSubmit={onClarificationAnswer}
                />
              </div>
            )}

            {/* Execution plan status */}
            {message.executionPlan && (
              <div className={message.content ? 'mt-3' : ''}>
                <ExecutionStatus plan={message.executionPlan} />
              </div>
            )}

            {/* Model responses (for council) */}
            {message.modelResponses && message.modelResponses.length > 0 && (
              <div className="mt-3 space-y-2">
                {message.modelResponses.map((response, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-orchestrator-border bg-orchestrator-bg p-3"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-orchestrator-accent">
                        {response.model.toUpperCase()}
                      </span>
                      {response.status === 'generating' && (
                        <span className="text-xs text-gray-400 animate-pulse-subtle">
                          думает...
                        </span>
                      )}
                      {response.latency && (
                        <span className="text-xs text-gray-500">
                          {(response.latency / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-300">
                      {response.content || '...'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {message.role === 'user' && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orchestrator-border">
              <User size={16} />
            </div>
          )}
        </div>
      ))}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
