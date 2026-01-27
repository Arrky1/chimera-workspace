'use client';

import { ModelProvider, ExecutionMode } from '@/types';
import { Brain, Zap, MessageSquare, Users, GitCompare } from 'lucide-react';

const modelColors: Record<ModelProvider, string> = {
  claude: '#f97316',
  openai: '#22c55e',
  gemini: '#3b82f6',
  qwen: '#a855f7',
  grok: '#ef4444',
  deepseek: '#06b6d4',
};

interface OrchestrationGraphProps {
  mode: ExecutionMode;
  activeModels: {
    provider: ModelProvider;
    name: string;
    status: 'idle' | 'active' | 'complete' | 'error';
    task?: string;
    progress?: number;
    tokens?: number;
  }[];
}

export function OrchestrationGraph({ mode, activeModels }: OrchestrationGraphProps) {
  const modeIcons: Record<ExecutionMode, typeof Users> = {
    council: Users,
    swarm: Zap,
    deliberation: GitCompare,
    debate: MessageSquare,
    single: Brain,
  };
  const Icon = modeIcons[mode] || Brain;

  const centerX = 300;
  const centerY = 200;
  const radius = 150;

  // Calculate positions for models in a circle
  const modelPositions = activeModels.map((model, index) => {
    const angle = (2 * Math.PI * index) / activeModels.length - Math.PI / 2;
    return {
      ...model,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });

  return (
    <div className="h-[400px] w-full rounded-xl border border-orchestrator-border bg-orchestrator-bg overflow-hidden relative">
      <svg width="100%" height="100%" viewBox="0 400" className="absolute inset-0">
        {/* Connection lines from center to each model */}
        {modelPositions.map((model) => {
          const color = modelColors[model.provider] || '#6b7280';
          const isActive = model.status === 'active';
          return (
            <g key={`line-${model.provider}`}>
              <line
                x1={centerX}
                y1={centerY}
                x2={model.x}
                y2={model.y}
                stroke={isActive ? color : `${color}40`}
                strokeWidth={isActive ? 2 : 1}
                strokeDasharray={isActive ? '' : '6 4'}
              />
              {isActive && (
                <circle r="3" fill={color}>
                  <animateMotion
                    dur="2s"
                    repeatCount="indefinite"
                    path={`M${centerX},${centerY} L${model.x},${model.y}`}
                  />
                </circle>
              )}
            </g>
          );
        })}
      </svg>

      {/* Center orchestrator node */}
      <div
        className="absolute transform -translate-x-1/2 -translate-y-1/2"
        style={{ left: centerX, top: centerY }}
      >
        <div className="px-5 py-3 rounded-2xl border-2 border-purple-500 bg-purple-500/20 shadow-lg shadow-purple-500/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-purple-500/30">
              <Icon size={18} className="text-purple-400" />
            </div>
            <div>
              <span className="text-sm font-bold text-white block">Chimera</span>
              <span className="text-[10px] text-purple-400 uppercase">{mode}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Model nodes */}
      {modelPositions.map((model) => {
        const color = modelColors[model.provider] || '#6b7280';
        const isActive = model.status === 'active';

        return (
          <div
            key={model.provider}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
            style={{
              left: model.x,
              top: model.y,
            }}
          >
            <div
              className={`px-3 py-2 rounded-xl border-2 min-w-[120px] transition-all ${
                isActive ? 'shadow-lg scale-105' : ''
              }`}
              style={{
                borderColor: isActive ? color : `${color}50`,
                backgroundColor: `${color}15`,
              }}
            >
              {isActive && (
                <div
                  className="absolute inset-0 rounded-xl animate-pulse opacity-20"
                  style={{ backgroundColor: color }}
                />
              )}
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-0.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs font-semibold text-white">{model.name}</span>
                </div>
                {model.task && (
                  <p className="text-[10px] text-gray-400 truncate max-w-[100px]">
                    {model.task}
                  </p>
                )}
                {model.tokens !== undefined && (
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {model.tokens.toLocaleString()} tok
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Empty state */}
      {activeModels.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          No active models
        </div>
      )}
    </div>
  );
}

// Stats component
interface ModelStats {
  provider: ModelProvider;
  name: string;
  tokens: number;
  tasks: number;
  avgTime: number;
  contribution: number;
}

interface StatsProps {
  stats: ModelStats[];
  totalTokens: number;
  totalTasks: number;
}

export function ModelContributionStats({ stats, totalTokens, totalTasks }: StatsProps) {
  return (
    <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
      <h3 className="text-sm font-semibold text-white mb-4">Model Contributions</h3>

      <div className="space-y-3">
        {stats.sort((a, b) => b.contribution - a.contribution).map((stat) => (
          <div key={stat.provider} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: modelColors[stat.provider] }}
                />
                <span className="text-white">{stat.name}</span>
              </div>
              <span className="text-gray-400">{stat.contribution.toFixed(1)}%</span>
            </div>

            <div className="h-2 bg-orchestrator-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${stat.contribution}%`,
                  backgroundColor: modelColors[stat.provider],
                }}
              />
            </div>

            <div className="flex justify-between text-xs text-gray-500">
              <span>{stat.tokens.toLocaleString()} tokens</span>
              <span>{stat.tasks} tasks</span>
              <span>~{stat.avgTime.toFixed(1)}s avg</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-orchestrator-border">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Total</span>
          <span className="text-white font-medium">
            {totalTokens.toLocaleString()} tokens / {totalTasks} tasks
          </span>
        </div>
      </div>
    </div>
  );
}
