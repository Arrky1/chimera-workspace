'use client';

import { Settings, HelpCircle } from 'lucide-react';
import { ModelConfig } from '@/types';

interface HeaderProps {
  models: ModelConfig[];
}

export function Header({ models }: HeaderProps) {
  const availableCount = models.filter((m) => m.available).length;

  return (
    <header className="flex items-center justify-between border-b border-orchestrator-border bg-orchestrator-card px-6 py-4">
      <div className="flex items-center gap-3">
        {/* Chimera Logo */}
        <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-purple-500 to-fuchsia-500 shadow-lg shadow-purple-500/25">
          {/* Three-headed dragon symbol */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L8 6L4 4L6 9L2 12L6 15L4 20L8 18L12 22L16 18L20 20L18 15L22 12L18 9L20 4L16 6L12 2Z" fill="white" fillOpacity="0.9"/>
            <circle cx="12" cy="12" r="3" fill="rgba(139,92,246,0.8)"/>
            <circle cx="12" cy="12" r="1.5" fill="white"/>
          </svg>
          {/* Glow effect */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-600 via-purple-500 to-fuchsia-500 opacity-50 blur-md -z-10" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white tracking-wide">
            Chimera
            <span className="ml-1.5 text-[10px] font-medium text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded-full uppercase tracking-widest">
              AI
            </span>
          </h1>
          <p className="text-xs text-gray-400">
            Multi-model Orchestrator
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
