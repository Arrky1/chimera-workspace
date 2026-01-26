import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Unified Orchestrator',
  description: 'Multi-model AI orchestrator with Council, Debate, and Deliberation modes',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-orchestrator-bg text-white antialiased">
        {children}
      </body>
    </html>
  );
}
