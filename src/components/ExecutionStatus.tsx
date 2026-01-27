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

const modeBgColors: Record<string, string> = {
  council: 'bg-purple-400/10',
  swarm: 'bg-yellow-400/10',
  deliberation: 'bg-blue-400/10',
  debate: 'bg-orange-400/10',
  single: 'bg-green-400/10',
};

// Маппинг провайдеров на членов команды
const PROVIDER_TEAM_MEMBERS: Record<string, { name: string; emoji: string; role: string }> = {
  claude: { name: 'Alex', emoji: '🧠', role: 'Architect' },
  openai: { name: 'Max', emoji: '💻', role: 'Senior Dev' },
  gemini: { name: 'Lena', emoji: '🔍', role: 'QA' },
  deepseek: { name: 'Ivan', emoji: '🔬', role: 'Research' },
  qwen: { name: 'Sergey', emoji: '📚', role: 'Research' },
  grok: { name: 'Nick', emoji: '🛠️', role: 'DevOps' },
};

function getTeamMembersForPhase(phase: ExecutionPhase): { name: string; emoji: string; role: string; provider: string }[] {
  return phase.models.map((provider) => {
    const member = PROVIDER_TEAM_MEMBERS[provider];
    return member
      ? { ...member, provider }
      : { name: provider, emoji: '🤖', role: 'AI', provider };
  });
}

export function ExecutionStatus({ plan }: ExecutionStatusProps) {
  const totalProgress =
    plan.phases.reduce((sum, p) => sum + p.progress, 0) / plan.phases.length;

  const totalModels = plan.phases.reduce((sum, p) => sum + p.models.length, 0);

  return (
    <div className="rounded-xl border border-orchestrator-border bg-orchestrator-bg p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-white">План выполнения</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {totalModels} моделей
          </span>
          <span className="text-xs text-gray-400">
            {Math.round(totalProgress)}% завершено
          </span>
        </div>
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
            totalModels={totalModels}
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
  totalModels: number;
}

function PhaseItem({ phase, isActive, index, totalModels }: PhaseItemProps) {
  const Icon = modeIcons[phase.mode] || User;
  const colorClass = modeColors[phase.mode] || 'text-gray-400';
  const bgColorClass = modeBgColors[phase.mode] || 'bg-gray-400/10';
  const teamMembers = getTeamMembersForPhase(phase);
  const phaseContribution = totalModels > 0
    ? Math.round((phase.models.length / totalModels) * 100)
    : 0;

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
      className={`rounded-lg p-3 transition-all ${
        isActive
          ? 'bg-orchestrator-accent/10 border border-orchestrator-accent/30'
          : 'bg-orchestrator-card'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-orchestrator-border ${colorClass}`}>
          <Icon size={16} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{phase.name}</span>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${bgColorClass} ${colorClass}`}>
              {phase.mode.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {phase.status === 'running' && phase.progress > 0 && (
            <span className="text-xs text-orchestrator-accent font-medium">{phase.progress}%</span>
          )}
          {statusIcon()}
        </div>
      </div>

      {/* Team Members */}
      <div className="mt-2 ml-11 flex flex-wrap items-center gap-1.5">
        {teamMembers.map((member) => (
          <div
            key={member.name}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
              phase.status === 'running'
                ? 'bg-orchestrator-accent/10 text-orchestrator-accent'
                : phase.status === 'completed'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-orchestrator-border text-gray-400'
            }`}
            title={`${member.name} (${member.role}) — ${member.provider}`}
          >
            <span>{member.emoji}</span>
            <span>{member.name}</span>
          </div>
        ))}
        <span className="text-xs text-gray-500 ml-1">
          {phaseContribution}% нагрузки
        </span>
      </div>

      {/* Phase progress bar (when running) */}
      {phase.status === 'running' && phase.progress > 0 && (
        <div className="mt-2 ml-11 h-1 overflow-hidden rounded-full bg-orchestrator-border">
          <div
            className={`h-full transition-all duration-500 ${
              phase.mode === 'swarm'
                ? 'bg-yellow-400'
                : phase.mode === 'deliberation'
                ? 'bg-blue-400'
                : 'bg-orchestrator-accent'
            }`}
            style={{ width: `${phase.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
