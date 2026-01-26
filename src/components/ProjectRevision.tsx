'use client';

import { useState, useEffect } from 'react';
import {
  FolderOpen,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  FileText,
  Shield,
  Zap,
  Code,
  Box,
  ChevronDown,
  ChevronRight,
  Download,
} from 'lucide-react';

interface RevisionStatus {
  id: string;
  status: string;
  progress: number;
  currentPhase: string;
  projectInfo?: {
    name: string;
    framework?: string;
    language?: string;
    totalFiles: number;
    totalLines: number;
  };
  summary?: {
    totalIssues: number;
    healthScore: number;
    bySeverity: Record<string, number>;
    autoFixableCount: number;
  };
}

interface Issue {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;
  autoFixable: boolean;
}

interface Recommendation {
  priority: number;
  title: string;
  description: string;
  effort: string;
  impact: string;
}

export function ProjectRevision() {
  const [projectPath, setProjectPath] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<RevisionStatus | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [report, setReport] = useState<string>('');
  const [isStarting, setIsStarting] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [selectedChecks, setSelectedChecks] = useState<string[]>([
    'security', 'performance', 'code_quality', 'architecture'
  ]);

  // Poll status when revision is running
  useEffect(() => {
    if (!sessionId || status?.status === 'completed' || status?.status === 'failed') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/revision?sessionId=${sessionId}`);
        const data = await response.json();
        setStatus(data);

        if (data.status === 'completed') {
          // Fetch full report
          const reportResponse = await fetch('/api/revision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'report', sessionId, format: 'markdown' }),
          });
          const reportData = await reportResponse.json();
          setIssues(reportData.issues || []);
          setRecommendations(reportData.recommendations || []);
          setReport(reportData.report || '');
        }
      } catch (error) {
        console.error('Failed to fetch status:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [sessionId, status?.status]);

  const startRevision = async () => {
    if (!projectPath.trim()) return;

    setIsStarting(true);
    setIssues([]);
    setRecommendations([]);
    setReport('');

    try {
      const response = await fetch('/api/revision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          projectPath: projectPath.trim(),
          config: {
            checks: selectedChecks,
            depth: 'standard',
            autoFix: false,
            generateReport: true,
          },
        }),
      });

      const data = await response.json();

      if (data.sessionId) {
        setSessionId(data.sessionId);
        setStatus({
          id: data.sessionId,
          status: 'scanning',
          progress: 0,
          currentPhase: 'Starting...',
        });
      }
    } catch (error) {
      console.error('Failed to start revision:', error);
    } finally {
      setIsStarting(false);
    }
  };

  const toggleCheck = (check: string) => {
    setSelectedChecks(prev =>
      prev.includes(check)
        ? prev.filter(c => c !== check)
        : [...prev, check]
    );
  };

  const toggleType = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-500';
      case 'high': return 'text-orange-500';
      case 'medium': return 'text-yellow-500';
      case 'low': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
      case 'high':
        return <AlertTriangle size={16} />;
      default:
        return <FileText size={16} />;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'security': return <Shield size={16} />;
      case 'performance': return <Zap size={16} />;
      case 'code_quality': return <Code size={16} />;
      case 'architecture': return <Box size={16} />;
      default: return <FileText size={16} />;
    }
  };

  // Group issues by type
  const issuesByType = issues.reduce((acc, issue) => {
    if (!acc[issue.type]) acc[issue.type] = [];
    acc[issue.type].push(issue);
    return acc;
  }, {} as Record<string, Issue[]>);

  return (
    <div className="flex flex-col h-full">
      {/* Input Section */}
      <div className="p-6 border-b border-orchestrator-border">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <FolderOpen size={24} className="text-orchestrator-accent" />
          Project Revision
        </h2>

        <div className="space-y-4">
          {/* Project path input */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Project Path</label>
            <div className="flex gap-3">
              <input
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="/path/to/your/project"
                className="flex-1 rounded-lg border border-orchestrator-border bg-orchestrator-bg px-4 py-3 text-white placeholder-gray-500 focus:border-orchestrator-accent focus:outline-none"
                disabled={!!sessionId && status?.status !== 'completed' && status?.status !== 'failed'}
              />
              <button
                onClick={startRevision}
                disabled={isStarting || !projectPath.trim() || (!!sessionId && status?.status !== 'completed' && status?.status !== 'failed')}
                className="flex items-center gap-2 rounded-lg bg-orchestrator-accent px-6 py-3 font-medium text-white transition-all hover:bg-orchestrator-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStarting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Play size={18} />
                )}
                Start Revision
              </button>
            </div>
          </div>

          {/* Check options */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Analysis Checks</label>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'security', label: 'Security', icon: Shield },
                { id: 'performance', label: 'Performance', icon: Zap },
                { id: 'code_quality', label: 'Code Quality', icon: Code },
                { id: 'architecture', label: 'Architecture', icon: Box },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => toggleCheck(id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
                    selectedChecks.includes(id)
                      ? 'border-orchestrator-accent bg-orchestrator-accent/20 text-white'
                      : 'border-orchestrator-border text-gray-400 hover:border-orchestrator-accent/50'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Section */}
      {status && status.status !== 'completed' && status.status !== 'failed' && (
        <div className="p-6 border-b border-orchestrator-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium">{status.currentPhase}</span>
            <span className="text-gray-400">{status.progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-orchestrator-border overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orchestrator-accent to-purple-500 transition-all duration-500"
              style={{ width: `${status.progress}%` }}
            />
          </div>
          {status.projectInfo && (
            <div className="mt-3 text-sm text-gray-400">
              {status.projectInfo.name} • {status.projectInfo.framework || status.projectInfo.language} • {status.projectInfo.totalFiles} files • {status.projectInfo.totalLines.toLocaleString()} lines
            </div>
          )}
        </div>
      )}

      {/* Results Section */}
      {status?.status === 'completed' && status.summary && (
        <div className="flex-1 overflow-y-auto">
          {/* Summary Cards */}
          <div className="p-6 grid grid-cols-4 gap-4">
            <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
              <div className="text-3xl font-bold text-white">{status.summary.healthScore}</div>
              <div className="text-sm text-gray-400">Health Score</div>
              <div className="mt-2 h-2 rounded-full bg-orchestrator-border overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    status.summary.healthScore >= 80 ? 'bg-green-500' :
                    status.summary.healthScore >= 60 ? 'bg-yellow-500' :
                    status.summary.healthScore >= 40 ? 'bg-orange-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${status.summary.healthScore}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
              <div className="text-3xl font-bold text-white">{status.summary.totalIssues}</div>
              <div className="text-sm text-gray-400">Total Issues</div>
              <div className="mt-2 flex gap-1">
                {status.summary.bySeverity.critical > 0 && (
                  <span className="text-xs text-red-500">{status.summary.bySeverity.critical} critical</span>
                )}
                {status.summary.bySeverity.high > 0 && (
                  <span className="text-xs text-orange-500">{status.summary.bySeverity.high} high</span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
              <div className="text-3xl font-bold text-white">{status.summary.autoFixableCount}</div>
              <div className="text-sm text-gray-400">Auto-fixable</div>
            </div>

            <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
              <div className="text-3xl font-bold text-white">{recommendations.length}</div>
              <div className="text-sm text-gray-400">Recommendations</div>
            </div>
          </div>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="px-6 pb-4">
              <h3 className="text-lg font-semibold text-white mb-3">Top Recommendations</h3>
              <div className="space-y-2">
                {recommendations.slice(0, 3).map((rec, idx) => (
                  <div key={idx} className="rounded-lg border border-orchestrator-border bg-orchestrator-card p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orchestrator-accent text-xs font-bold">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="font-medium text-white">{rec.title}</div>
                        <div className="text-sm text-gray-400 mt-1">{rec.description}</div>
                        <div className="flex gap-3 mt-2 text-xs">
                          <span className={`${rec.impact === 'high' ? 'text-green-400' : 'text-gray-500'}`}>
                            Impact: {rec.impact}
                          </span>
                          <span className={`${rec.effort === 'low' ? 'text-green-400' : 'text-gray-500'}`}>
                            Effort: {rec.effort}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Issues by Type */}
          <div className="px-6 pb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Issues</h3>
              <button className="flex items-center gap-2 text-sm text-orchestrator-accent hover:text-orchestrator-accent-hover">
                <Download size={14} />
                Download Report
              </button>
            </div>

            <div className="space-y-2">
              {Object.entries(issuesByType).map(([type, typeIssues]) => (
                <div key={type} className="rounded-lg border border-orchestrator-border bg-orchestrator-card">
                  <button
                    onClick={() => toggleType(type)}
                    className="w-full flex items-center justify-between p-4"
                  >
                    <div className="flex items-center gap-3">
                      {getTypeIcon(type)}
                      <span className="font-medium text-white capitalize">
                        {type.replace('_', ' ')}
                      </span>
                      <span className="text-sm text-gray-400">({typeIssues.length})</span>
                    </div>
                    {expandedTypes.has(type) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>

                  {expandedTypes.has(type) && (
                    <div className="border-t border-orchestrator-border">
                      {typeIssues.map((issue) => (
                        <div key={issue.id} className="p-4 border-b border-orchestrator-border last:border-b-0">
                          <div className="flex items-start gap-3">
                            <div className={getSeverityColor(issue.severity)}>
                              {getSeverityIcon(issue.severity)}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">{issue.title}</span>
                                <span className={`text-xs px-2 py-0.5 rounded ${getSeverityColor(issue.severity)} bg-current/10`}>
                                  {issue.severity}
                                </span>
                                {issue.autoFixable && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                                    auto-fixable
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-400 mt-1">{issue.description}</p>
                              {issue.file && (
                                <p className="text-xs text-gray-500 mt-1">
                                  📄 {issue.file}{issue.line ? `:${issue.line}` : ''}
                                </p>
                              )}
                              {issue.suggestion && (
                                <p className="text-sm text-orchestrator-accent mt-2">
                                  💡 {issue.suggestion}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {status?.status === 'failed' && (
        <div className="p-6">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
            <XCircle size={48} className="mx-auto text-red-500 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Revision Failed</h3>
            <p className="text-gray-400">{status.currentPhase}</p>
            <button
              onClick={() => {
                setSessionId(null);
                setStatus(null);
              }}
              className="mt-4 px-4 py-2 rounded-lg border border-orchestrator-border text-white hover:bg-orchestrator-border"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!status && !isStarting && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center text-gray-400">
            <FolderOpen size={64} className="mx-auto mb-4 text-orchestrator-border" />
            <h3 className="text-lg font-medium text-white mb-2">No Project Selected</h3>
            <p className="max-w-md">
              Enter the path to your project above to start a comprehensive revision.
              The analysis will check for security issues, performance problems,
              code quality, and architectural concerns.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
