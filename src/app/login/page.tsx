'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cpu, Lock, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        router.push('/');
        router.refresh();
      } else {
        setError('Неверный пароль');
      }
    } catch {
      setError('Ошибка подключения');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-orchestrator-bg p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orchestrator-accent to-purple-600">
              <Cpu size={32} className="text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white">Chimera</h1>
          <p className="text-gray-400 mt-1">Multi-model AI Orchestrator</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль"
              className="w-full rounded-xl border border-orchestrator-border bg-orchestrator-card pl-10 pr-4 py-3 text-white placeholder-gray-500 focus:border-orchestrator-accent focus:outline-none"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading || !password}
            className="w-full rounded-xl bg-orchestrator-accent py-3 font-medium text-white transition-all hover:bg-orchestrator-accent-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              'Войти'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
