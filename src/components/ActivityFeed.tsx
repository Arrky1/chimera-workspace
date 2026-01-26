'use client';

import { useState, useEffect } from 'react';
import {
  Brain,
  Sparkles,
  Zap,
  MessageSquare,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Eye
} from 'lucide-react';
import { ModelProvider } from '@/types';

export interface ModelActivity {
  id: string;
  model: ModelProvider;
  modelName: string;
  status: 'idle' | 'thinking' | 'generating' | 'reviewing' | 'complete' | 'error';
  task: string;
  thinking?: string;
  output?: string;
  startTime?: number;
  endTime?: number;
}

interface ActivityFeedProps {
  activities: ModelActivity[];
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const modelIcons: Record<ModelProvider, typeof Brain> = {
  claude: Brain,
  openai: Sparkles,
  gemini: Zap,
  qwen: MessageSquare,
  grok: Zap,
  deepseek: Brain,
};

const modelColors: Record<ModelProvider, { bg: string; text: string; border: string }> = {
  claude: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30' },
  openai: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30' },
  gemini: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' },
  qwen: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30' },
  grok: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  deepseek: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30' },
};

const statusLabels: Record<ModelActivity['status'], string> = {
  idle: 'Ожидание',
  thinking: 'Думает...',
  generating: 'Генерирует...',
  reviewing: 'Проверяет...',
  complete: 'Готово',
  error: 'Ошибка',
};

export function ActivityFeed({ activities, isExpanded = true, onToggleExpand }: ActivityFeedProps) {
  const activeCount = activities.filter(a =>
    a.status === 'thinking' || a.status === 'generating' || a.status === 'reviewing'
  ).length;

  return (
    <div className="rounded-xl border border-orchestrator-border bg-orchestrator-bg overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center justify-between p-4 hover:bg-orchestrator-card/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <Eye size={18} className="text-orchestrator-accent" />
            {activeCount > 0 && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            )}
          </div>
          <span className="text-sm font-medium text-white">AI Activity</span>
          {activeCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
              {activeCount} active
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp size={16} className="text-gray-400" />
        ) : (
          <ChevronDown size={16} className="text-gray-400" />
        )}
      </button>

      {/* Activity List */}
      {isExpanded && (
        <div className="border-t border-orchestrator-border">
          {activities.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              Нет активности
            </div>
          ) : (
            <div className="divide-y divide-orchestrator-border">
              {activities.map((activity) => (
                <ActivityItem key={activity.id} activity={activity} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ActivityItemProps {
  activity: ModelActivity;
}

function ActivityItem({ activity }: ActivityItemProps) {
  const [showThinking, setShowThinking] = useState(false);
  const Icon = modelIcons[activity.model] || Brain;
  const colors = modelColors[activity.model] || modelColors.claude;

  const isActive = activity.status === 'thinking' ||
                   activity.status === 'generating' ||
                   activity.status === 'reviewing';

  const duration = activity.startTime
    ? ((activity.endTime || Date.now()) - activity.startTime) / 1000
    : 0;

  return (
    <div className={`p-4 transition-colors ${isActive ? 'bg-orchestrator-card/50' : ''}`}>
      <div className="flex items-start gap-3">
        {/* Model Icon */}
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colors.bg} ${colors.text} border ${colors.border}`}>
          {isActive ? (
            <Loader2 size={18} className="animate-spin" />
          ) : activity.status === 'complete' ? (
            <CheckCircle size={18} />
          ) : (
            <Icon size={18} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${colors.text}`}>
              {activity.modelName}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              isActive
                ? 'bg-yellow-500/20 text-yellow-400'
                : activity.status === 'complete'
                ? 'bg-green-500/20 text-green-400'
                : activity.status === 'error'
                ? 'bg-red-500/20 text-red-400'
                : 'bg-gray-500/20 text-gray-400'
            }`}>
              {statusLabels[activity.status]}
            </span>
            {duration > 0 && (
              <span className="text-xs text-gray-500">
                {duration.toFixed(1)}s
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-gray-300 truncate">
            {activity.task}
          </p>

          {/* Thinking/Reasoning Section */}
          {activity.thinking && (
            <div className="mt-2">
              <button
                onClick={() => setShowThinking(!showThinking)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300 transition-colors"
              >
                <Brain size={12} />
                <span>Reasoning</span>
                {showThinking ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showThinking && (
                <div className="mt-2 p-3 rounded-lg bg-orchestrator-border/50 border border-orchestrator-border">
                  <p className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">
                    {activity.thinking}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Output Preview */}
          {activity.output && activity.status === 'complete' && (
            <div className="mt-2 p-3 rounded-lg bg-orchestrator-card border border-orchestrator-border">
              <p className="text-xs text-gray-300 line-clamp-3">
                {activity.output}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Hook for managing activity state
export function useActivityFeed() {
  const [activities, setActivities] = useState<ModelActivity[]>([]);

  const addActivity = (activity: Omit<ModelActivity, 'id'>) => {
    const id = `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setActivities(prev => [...prev, { ...activity, id }]);
    return id;
  };

  const updateActivity = (id: string, updates: Partial<ModelActivity>) => {
    setActivities(prev =>
      prev.map(a => a.id === id ? { ...a, ...updates } : a)
    );
  };

  const clearActivities = () => {
    setActivities([]);
  };

  return {
    activities,
    addActivity,
    updateActivity,
    clearActivities,
  };
}
