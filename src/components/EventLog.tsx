'use client';

import { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle,
  Clock,
  GitPullRequest,
  GitMerge,
  MessageSquare,
  Zap,
  RefreshCw,
  Filter,
  Trash2,
  Download,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ModelProvider } from '@/types';

export type EventType =
  | 'system'
  | 'api_call'
  | 'api_error'
  | 'rate_limit'
  | 'github_webhook'
  | 'task_start'
  | 'task_complete'
  | 'model_response'
  | 'phase_change'
  | 'scheduled';

export type EventSeverity = 'info' | 'warning' | 'error' | 'success';

export interface LogEvent {
  id: string;
  type: EventType;
  severity: EventSeverity;
  message: string;
  details?: string;
  timestamp: Date;
  source?: string;
  model?: ModelProvider;
  metadata?: Record<string, unknown>;
}

const eventIcons: Record<EventType, typeof Info> = {
  system: Info,
  api_call: Zap,
  api_error: AlertCircle,
  rate_limit: AlertTriangle,
  github_webhook: GitPullRequest,
  task_start: Clock,
  task_complete: CheckCircle,
  model_response: MessageSquare,
  phase_change: RefreshCw,
  scheduled: Clock,
};

const severityColors: Record<EventSeverity, { bg: string; text: string; border: string }> = {
  info: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' },
  warning: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  error: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  success: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30' },
};

interface EventLogProps {
  events: LogEvent[];
  maxHeight?: string;
  showFilters?: boolean;
  onClear?: () => void;
  onExport?: () => void;
  autoScroll?: boolean;
}

export function EventLog({
  events,
  maxHeight = '400px',
  showFilters = true,
  onClear,
  onExport,
  autoScroll = true,
}: EventLogProps) {
  const [filter, setFilter] = useState<EventSeverity | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all');
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const filteredEvents = events.filter((event) => {
    if (filter !== 'all' && event.severity !== filter) return false;
    if (typeFilter !== 'all' && event.type !== typeFilter) return false;
    return true;
  });

  const toggleEventExpand = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-orchestrator-border">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm font-medium text-white hover:text-orchestrator-accent transition-colors"
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Event Log
          <span className="px-2 py-0.5 rounded-full bg-orchestrator-border text-xs text-gray-400">
            {filteredEvents.length}
          </span>
        </button>

        <div className="flex items-center gap-2">
          {showFilters && (
            <>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as EventSeverity | 'all')}
                className="text-xs bg-orchestrator-bg border border-orchestrator-border rounded px-2 py-1 text-gray-300"
              >
                <option value="all">All Levels</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
                <option value="success">Success</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as EventType | 'all')}
                className="text-xs bg-orchestrator-bg border border-orchestrator-border rounded px-2 py-1 text-gray-300"
              >
                <option value="all">All Types</option>
                <option value="system">System</option>
                <option value="api_call">API Call</option>
                <option value="api_error">API Error</option>
                <option value="rate_limit">Rate Limit</option>
                <option value="github_webhook">GitHub</option>
                <option value="task_start">Task Start</option>
                <option value="task_complete">Task Complete</option>
                <option value="model_response">Model Response</option>
              </select>
            </>
          )}

          {onExport && (
            <button
              onClick={onExport}
              className="p-1 text-gray-400 hover:text-white transition-colors"
              title="Export logs"
            >
              <Download size={14} />
            </button>
          )}

          {onClear && (
            <button
              onClick={onClear}
              className="p-1 text-gray-400 hover:text-red-400 transition-colors"
              title="Clear logs"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Event List */}
      {isExpanded && (
        <div
          ref={scrollRef}
          className="overflow-y-auto"
          style={{ maxHeight }}
        >
          {filteredEvents.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              No events to display
            </div>
          ) : (
            <div className="divide-y divide-orchestrator-border">
              {filteredEvents.map((event) => (
                <EventItem
                  key={event.id}
                  event={event}
                  isExpanded={expandedEvents.has(event.id)}
                  onToggle={() => toggleEventExpand(event.id)}
                  formatTime={formatTime}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface EventItemProps {
  event: LogEvent;
  isExpanded: boolean;
  onToggle: () => void;
  formatTime: (date: Date) => string;
}

function EventItem({ event, isExpanded, onToggle, formatTime }: EventItemProps) {
  const Icon = eventIcons[event.type] || Info;
  const colors = severityColors[event.severity];

  return (
    <div className={`p-3 transition-colors hover:bg-orchestrator-bg/50`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`p-1.5 rounded ${colors.bg}`}>
          <Icon size={14} className={colors.text} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-white">{event.message}</span>
            {event.source && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-orchestrator-border text-gray-400">
                {event.source}
              </span>
            )}
          </div>

          {event.details && (
            <button
              onClick={onToggle}
              className="mt-1 text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1"
            >
              {isExpanded ? 'Hide details' : 'Show details'}
              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}

          {isExpanded && event.details && (
            <pre className="mt-2 p-2 rounded bg-orchestrator-bg text-xs text-gray-400 overflow-x-auto font-mono">
              {event.details}
            </pre>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {formatTime(event.timestamp)}
        </span>
      </div>
    </div>
  );
}

// Hook for managing event log state
export function useEventLog(maxEvents = 100) {
  const [events, setEvents] = useState<LogEvent[]>([]);

  const addEvent = (event: Omit<LogEvent, 'id' | 'timestamp'>) => {
    const newEvent: LogEvent = {
      ...event,
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date(),
    };

    setEvents((prev) => {
      const updated = [...prev, newEvent];
      // Keep only last maxEvents
      if (updated.length > maxEvents) {
        return updated.slice(-maxEvents);
      }
      return updated;
    });

    return newEvent.id;
  };

  const clearEvents = () => setEvents([]);

  const exportEvents = () => {
    const data = JSON.stringify(events, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chimera-events-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return {
    events,
    addEvent,
    clearEvents,
    exportEvents,
  };
}
