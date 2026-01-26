'use client';

import { Settings, HelpCircle, Cpu } from 'lucide-react';
import { ModelConfig } from '@/types';

interface HeaderProps {
  models: ModelConfig[];
}

export function Header({ models }: HeaderProps) {
  const availableCount = models.filter((m) => m.available).length;

  return (
    <header className="flex items-center justify-between border-b border-orchestrator-border bg-orchestrator-card px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orchestrator-accent to-purple-600">
          <Cpu size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-white">Unified Orchestrator</h1>
          <p className="text-xs text-gray-400">
            Multi-model AI with Council, Debate & Deliberation
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Model status */}
        <div className="flex items-center gap-2 rounded-lg bg-orchestrator-bg px-3 py-2">
          <div className="flex -space-x-1">
            {models.slice(0, 4).map((model, idx) => (
              <div
                key={model.id}
                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 border-orchestrator-card text-xs font-medium ${
                  model.available
                    ? 'bg-orchestrator-success text-white'
                    : 'bg-gray-600 text-gray-400'
                }`}
                style={{ zIndex: 4 - idx }}
                title={model.name}
              >
                {model.provider.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
          <span className="text-sm text-gray-400">
            {availableCount}/{models.length} моделей
          </span>
        </div>

        {/* Actions */}
        <button
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-orchestrator-border hover:text-white"
          title="Настройки"
        >
          <Settings size={20} />
        </button>

        <button
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-orchestrator-border hover:text-white"
          title="Справка"
        >
          <HelpCircle size={20} />
        </button>
      </div>
    </header>
  );
}
