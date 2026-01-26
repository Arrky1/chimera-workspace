'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
  Shield,
  Zap,
  Code,
  Layers,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Github,
  Lock,
  Unlock,
  Loader2,
  Wrench,
} from 'lucide-react';
import { Project, ProjectAnalysis, ProjectIssue } from '@/types/project';

export function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [isFixing, setIsFixing] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 5000); // Poll for updates
    return () => clearInterval(interval);
  }, []);

  // Fetch analysis when project selected
  useEffect(() => {
    if (selectedProject) {
      fetchAnalysis(selectedProject.id);
    }
  }, [selectedProject?.id]);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data.projects || []);
      setIsLoading(false);

      // Update selected project if it changed
      if (selectedProject) {
        const updated = data.projects?.find((p: Project) => p.id === selectedProject.id);
        if (updated) setSelectedProject(updated);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      setIsLoading(false);
    }
  };

  const fetchAnalysis = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects?id=${projectId}`);
      const data = await res.json();
      setAnalysis(data.analysis || null);
    } catch (error) {
      console.error('Failed to fetch analysis:', error);
    }
  };

  const addProject = async () => {
    if (!newRepoUrl.trim()) return;

    setIsAdding(true);
    setAddError('');

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', githubUrl: newRepoUrl }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAddError(data.error || 'Failed to add project');
      } else {
        setNewRepoUrl('');
        fetchProjects();
      }
    } catch (error) {
      setAddError('Connection error');
    } finally {
      setIsAdding(false);
    }
  };

  const removeProject = async (projectId: string) => {
    if (!confirm('Remove this project?')) return;

    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', projectId }),
      });

      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
        setAnalysis(null);
      }
      fetchProjects();
    } catch (error) {
      console.error('Failed to remove project:', error);
    }
  };

  const reanalyze = async (projectId: string) => {
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', projectId }),
      });
      fetchProjects();
    } catch (error) {
      console.error('Failed to reanalyze:', error);
    }
  };

  const fixSelectedIssues = async (createPR: boolean) => {
    if (!selectedProject || selectedIssues.size === 0) return;

    setIsFixing(true);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fix',
          projectId: selectedProject.id,
          issueIds: Array.from(selectedIssues),
          createPR,
        }),
      });

      const data = await res.json();

      if (data.success) {
        alert(
          data.prUrl
            ? `Fixed ${data.fixedCount} issues! PR created: ${data.prUrl}`
            : `Fixed ${data.fixedCount} issues!`
        );
        setSelectedIssues(new Set());
        fetchAnalysis(selectedProject.id);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      alert('Fix failed');
    } finally {
      setIsFixing(false);
    }
  };

  const getHealthColor = (score?: number) => {
    if (!score) return 'text-gray-400';
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getHealthBg = (score?: number) => {
    if (!score) return 'bg-gray-700';
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-500 bg-red-500/10';
      case 'high': return 'text-orange-500 bg-orange-500/10';
      case 'medium': return 'text-yellow-500 bg-yellow-500/10';
      case 'low': return 'text-blue-400 bg-blue-500/10';
      default: return 'text-gray-400 bg-gray-500/10';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'security': return Shield;
      case 'performance': return Zap;
      case 'code_quality': return Code;
      case 'architecture': return Layers;
      default: return AlertTriangle;
    }
  };

  const getStatusIcon = (status: Project['status']) => {
    switch (status) {
      case 'ready': return CheckCircle;
      case 'error': return XCircle;
      case 'cloning':
      case 'analyzing': return Clock;
      default: return Clock;
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-orchestrator-accent" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Projects List */}
      <div className="w-80 border-r border-orchestrator-border flex flex-col">
        <div className="p-4 border-b border-orchestrator-border">
          <h2 className="text-lg font-semibold text-white mb-3">My Projects</h2>

          {/* Add Project */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newRepoUrl}
                onChange={(e) => setNewRepoUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addProject()}
                placeholder="github.com/user/repo"
                className="flex-1 rounded-lg border border-orchestrator-border bg-orchestrator-bg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-orchestrator-accent focus:outline-none"
              />
              <button
                onClick={addProject}
                disabled={isAdding || !newRepoUrl.trim()}
                className="rounded-lg bg-orchestrator-accent p-2 text-white hover:bg-orchestrator-accent-hover disabled:opacity-50"
              >
                {isAdding ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              </button>
            </div>
            {addError && <p className="text-xs text-red-400">{addError}</p>}
          </div>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {projects.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <Github size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No projects yet</p>
              <p className="text-xs mt-1">Add a GitHub repo to start</p>
            </div>
          ) : (
            projects.map((project) => {
              const StatusIcon = getStatusIcon(project.status);
              return (
                <button
                  key={project.id}
                  onClick={() => setSelectedProject(project)}
                  className={`w-full text-left rounded-xl border p-3 transition-all ${
                    selectedProject?.id === project.id
                      ? 'border-orchestrator-accent bg-orchestrator-accent/10'
                      : 'border-orchestrator-border bg-orchestrator-card hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">{project.name}</span>
                        {project.isPrivate ? (
                          <Lock size={12} className="text-gray-500 flex-shrink-0" />
                        ) : (
                          <Unlock size={12} className="text-gray-500 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{project.owner}/{project.repo}</p>
                    </div>
                    <StatusIcon
                      size={16}
                      className={
                        project.status === 'ready'
                          ? 'text-green-400'
                          : project.status === 'error'
                          ? 'text-red-400'
                          : 'text-yellow-400 animate-pulse'
                      }
                    />
                  </div>

                  {project.status === 'ready' && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className={getHealthColor(project.healthScore)}>
                          {project.healthScore}% Health
                        </span>
                        <span className="text-gray-500">
                          {project.issuesCount} issues
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                        <div
                          className={`h-full transition-all ${getHealthBg(project.healthScore)}`}
                          style={{ width: `${project.healthScore || 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {project.status === 'error' && (
                    <p className="mt-2 text-xs text-red-400 truncate">{project.error}</p>
                  )}

                  {(project.status === 'cloning' || project.status === 'analyzing') && (
                    <p className="mt-2 text-xs text-yellow-400">
                      {project.status === 'cloning' ? 'Cloning...' : 'Analyzing...'}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Project Details */}
      <div className="flex-1 overflow-y-auto">
        {selectedProject ? (
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-white">{selectedProject.name}</h2>
                  {selectedProject.isPrivate ? (
                    <span className="flex items-center gap-1 rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                      <Lock size={10} /> Private
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                      <Unlock size={10} /> Public
                    </span>
                  )}
                </div>
                <p className="text-gray-400 mt-1">{selectedProject.description || 'No description'}</p>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                  <span>{selectedProject.language}</span>
                  <a
                    href={selectedProject.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-white"
                  >
                    <Github size={14} />
                    View on GitHub
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => reanalyze(selectedProject.id)}
                  disabled={selectedProject.status === 'analyzing'}
                  className="flex items-center gap-2 rounded-lg border border-orchestrator-border px-3 py-2 text-sm text-white hover:bg-orchestrator-card disabled:opacity-50"
                >
                  <RefreshCw size={14} className={selectedProject.status === 'analyzing' ? 'animate-spin' : ''} />
                  Re-analyze
                </button>
                <button
                  onClick={() => removeProject(selectedProject.id)}
                  className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              </div>
            </div>

            {selectedProject.status === 'ready' && analysis ? (
              <>
                {/* Health Scores */}
                <div className="grid grid-cols-5 gap-4 mb-6">
                  <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
                    <div className="text-sm text-gray-400 mb-1">Overall Health</div>
                    <div className={`text-3xl font-bold ${getHealthColor(analysis.healthScore)}`}>
                      {analysis.healthScore}%
                    </div>
                  </div>
                  {Object.entries(analysis.scores).map(([key, value]) => {
                    const Icon = getCategoryIcon(key);
                    return (
                      <div key={key} className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-4">
                        <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
                          <Icon size={14} />
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </div>
                        <div className={`text-2xl font-bold ${getHealthColor(value)}`}>
                          {value}%
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Issues */}
                <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card">
                  <div className="flex items-center justify-between p-4 border-b border-orchestrator-border">
                    <h3 className="font-semibold text-white">
                      Issues ({analysis.issues.length})
                    </h3>
                    {selectedIssues.size > 0 && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => fixSelectedIssues(true)}
                          disabled={isFixing}
                          className="flex items-center gap-2 rounded-lg bg-orchestrator-accent px-3 py-1.5 text-sm text-white hover:bg-orchestrator-accent-hover disabled:opacity-50"
                        >
                          {isFixing ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                          Fix & Create PR ({selectedIssues.size})
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="divide-y divide-orchestrator-border">
                    {analysis.issues.length === 0 ? (
                      <div className="p-8 text-center text-gray-500">
                        <CheckCircle size={32} className="mx-auto mb-2 text-green-400" />
                        <p>No issues found!</p>
                      </div>
                    ) : (
                      analysis.issues.map((issue) => {
                        const Icon = getCategoryIcon(issue.category);
                        const isSelected = selectedIssues.has(issue.id);
                        return (
                          <div
                            key={issue.id}
                            className={`p-4 ${issue.status === 'fixed' ? 'opacity-50' : ''}`}
                          >
                            <div className="flex items-start gap-3">
                              {issue.canAutoFix && issue.status !== 'fixed' && (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const newSelected = new Set(selectedIssues);
                                    if (e.target.checked) {
                                      newSelected.add(issue.id);
                                    } else {
                                      newSelected.delete(issue.id);
                                    }
                                    setSelectedIssues(newSelected);
                                  }}
                                  className="mt-1 accent-orchestrator-accent"
                                />
                              )}
                              <Icon size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-white">{issue.title}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs ${getSeverityColor(issue.severity)}`}>
                                    {issue.severity}
                                  </span>
                                  {issue.canAutoFix && (
                                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                                      Auto-fixable
                                    </span>
                                  )}
                                  {issue.status === 'fixed' && (
                                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">
                                      Fixed
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-400 mt-1">{issue.description}</p>
                                {issue.file && (
                                  <p className="text-xs text-gray-500 mt-1 font-mono">
                                    {issue.file}{issue.line ? `:${issue.line}` : ''}
                                  </p>
                                )}
                                {issue.prUrl && (
                                  <a
                                    href={issue.prUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-orchestrator-accent mt-1 hover:underline"
                                  >
                                    View PR <ExternalLink size={10} />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            ) : selectedProject.status === 'error' ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
                <XCircle size={48} className="mx-auto mb-4 text-red-400" />
                <h3 className="text-lg font-semibold text-white mb-2">Analysis Failed</h3>
                <p className="text-red-400">{selectedProject.error}</p>
                <button
                  onClick={() => reanalyze(selectedProject.id)}
                  className="mt-4 rounded-lg bg-orchestrator-accent px-4 py-2 text-white hover:bg-orchestrator-accent-hover"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-orchestrator-border bg-orchestrator-card p-12 text-center">
                <Loader2 size={48} className="mx-auto mb-4 text-orchestrator-accent animate-spin" />
                <h3 className="text-lg font-semibold text-white mb-2">
                  {selectedProject.status === 'cloning' ? 'Cloning Repository...' : 'Analyzing Code...'}
                </h3>
                <p className="text-gray-400">This may take a moment</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Layers size={48} className="mx-auto mb-4 opacity-30" />
              <p>Select a project to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
