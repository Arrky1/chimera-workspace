export interface Project {
  id: string;
  name: string;
  description: string;
  githubUrl: string;
  owner: string;
  repo: string;
  isPrivate: boolean;
  language: string;
  defaultBranch: string;

  // Status
  status: 'pending' | 'cloning' | 'analyzing' | 'ready' | 'error';
  error?: string;

  // Health metrics
  healthScore?: number;
  issuesCount?: number;
  lastAnalysis?: Date;

  // Timestamps
  addedAt: Date;
  updatedAt: Date;
}

export interface ProjectIssue {
  id: string;
  projectId: string;

  // Issue details
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'security' | 'performance' | 'code_quality' | 'architecture' | 'accessibility';

  // Location
  file?: string;
  line?: number;

  // Fix
  canAutoFix: boolean;
  fix?: {
    description: string;
    diff?: string;
    newContent?: string;
  };

  // Status
  status: 'open' | 'fixing' | 'fixed' | 'ignored';
  fixedAt?: Date;
  prUrl?: string;
}

export interface ProjectAnalysis {
  projectId: string;
  timestamp: Date;
  duration: number;

  // Scores
  healthScore: number;
  scores: {
    security: number;
    performance: number;
    codeQuality: number;
    architecture: number;
  };

  // Issues
  issues: ProjectIssue[];

  // Summary
  summary: {
    totalFiles: number;
    totalLines: number;
    framework?: string;
    language: string;
  };

  // AI insights
  insights?: {
    model: string;
    summary: string;
    recommendations: string[];
  }[];
}

export interface FixRequest {
  projectId: string;
  issueIds: string[];
  createPR: boolean;
  prTitle?: string;
  prDescription?: string;
}

export interface FixResult {
  success: boolean;
  projectId: string;
  fixedCount: number;
  failedCount: number;
  prUrl?: string;
  error?: string;
  details: {
    issueId: string;
    success: boolean;
    error?: string;
  }[];
}
