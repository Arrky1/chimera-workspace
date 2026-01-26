'use client';

import { ExecutionPlan, ExecutionPhase } from '@/types';
import {
  Users,
  Zap,
  GitCompare,
  MessageSquare,
  User,
  CheckCircle,
  Circle,
  Loader2,
  XCircle,
} from 'lucide-react';

interface ExecutionStatusProps {
  plan: ExecutionPlan;
}

const modeIcons: Record<string, typeof Users> = {
  council: Users,
  swarm: Zap,
  deliberation: GitCompare,
  debate: MessageSquare,
  single: User,
};

const modeColors: Record<string, string> = {
  council: 'text-purple-400',
  swarm: 'text-yellow-400',
  deliberation: 'text-blue-400',
  debate: 'text-orange-400',
  single: 'text-green-400',
};

export function ExecutionStatus({ plan }: ExecutionStatusProps) {
  const totalProgress =
    plan.phases.reduce((sum, p) => sum + p.progress, 0) / plan.phases.length;

  return (
    <div className="rounded-xl border border-orchestrator-border bg-orchestrator-bg p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-white">План выполнения</span>
        <span className="text-xs text-gray-400">
          {Math.round(totalProgress)}% завершено
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-orchestrator-border">
        <div
          className="h-full bg-gradient-to-r from-orchestrator-accent to-purple-500 transition-all duration-500"
          style={{ width: `${totalProgress}%` }}
        />
      </div>

      {/* Phases */}
      <div className="space-y-2">
        {plan.phases.map((phase, index) => (
          <PhaseItem
            key={phase.id}
            phase={phase}
            isActive={index === plan.currentPhase}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

interface PhaseItemProps {
  phase: ExecutionPhase;
  isActive: boolean;
  index: number;
}

function PhaseItem({ phase, isActive, index }: PhaseItemProps) {
  const Icon = modeIcons[phase.mode] || User;
  const colorClass = modeColors[phase.mode] || 'text-gray-400';

  const statusIcon = () => {
    switch (phase.status) {
      case 'completed':
        return <CheckCircle size={16} className="text-orchestrator-success" />;
      case 'running':
        return <Loader2 size={16} className="animate-spin text-orchestrator-accent" />;
      case 'failed':
        return <XCircle size={16} className="text-orchestrator-error" />;
      default:
        return <Circle size={16} className="text-gray-600" />;
    }
  };

  return (
    <div
      className={`flex items-center gap-3 rounded-lg p-3 transition-all ${
        isActive
          ? 'bg-orchestrator-accent/10 border border-orchestrator-accent/30'
          : 'bg-orchestrator-card'
      }`}
    >
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-orchestrator-border ${colorClass}`}>
        <Icon size={16} />
      </div>

      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{phase.name}</span>
          <span className={`text-xs ${colorClass}`}>
            {phase.mode.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>
            {phase.models.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(' + ')}
          </span>
          {phase.status === 'running' && phase.progress > 0 && (
            <span>• {phase.progress}%</span>
          )}
        </div>
      </div>

      {statusIcon()}
    </div>
  );
}
