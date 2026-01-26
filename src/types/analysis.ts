// Project Analysis Types

export interface ProjectInfo {
  path: string;
  name: string;
  framework?: string;
  language?: string;
  packageManager?: string;
  totalFiles: number;
  totalLines: number;
  structure: DirectoryNode;
}

export interface DirectoryNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: DirectoryNode[];
  size?: number;
  extension?: string;
}

export interface AnalysisConfig {
  checks: AnalysisCheck[];
  depth: 'quick' | 'standard' | 'deep';
  autoFix: boolean;
  generateReport: boolean;
  targetAreas?: string[];
}

export type AnalysisCheck =
  | 'architecture'
  | 'security'
  | 'performance'
  | 'code_quality'
  | 'dependencies'
  | 'tests'
  | 'documentation'
  | 'accessibility';

export interface AnalysisIssue {
  id: string;
  type: AnalysisCheck;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  suggestion?: string;
  autoFixable: boolean;
  fix?: CodeFix;
  references?: string[];
}

export interface CodeFix {
  description: string;
  changes: FileChange[];
}

export interface FileChange {
  file: string;
  type: 'modify' | 'create' | 'delete' | 'rename';
  oldContent?: string;
  newContent?: string;
  diff?: string;
}

export interface AnalysisResult {
  projectInfo: ProjectInfo;
  issues: AnalysisIssue[];
  summary: AnalysisSummary;
  modelInsights: ModelInsight[];
  recommendations: Recommendation[];
  timestamp: Date;
}

export interface AnalysisSummary {
  totalIssues: number;
  bySeverity: Record<AnalysisIssue['severity'], number>;
  byType: Record<AnalysisCheck, number>;
  healthScore: number; // 0-100
  autoFixableCount: number;
}

export interface ModelInsight {
  model: string;
  area: AnalysisCheck;
  insight: string;
  confidence: number;
}

export interface Recommendation {
  priority: number;
  title: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  relatedIssues: string[];
}

export interface RevisionSession {
  id: string;
  projectPath: string;
  projectInfo: ProjectInfo;
  config: AnalysisConfig;
  status: 'scanning' | 'analyzing' | 'generating_fixes' | 'reviewing' | 'completed' | 'failed';
  progress: number;
  currentPhase: string;
  result?: AnalysisResult;
  appliedFixes: string[];
  startTime: Date;
  endTime?: Date;
}

// Report types
export interface RevisionReport {
  session: RevisionSession;
  sections: ReportSection[];
  generatedAt: Date;
  format: 'markdown' | 'html' | 'json';
}

export interface ReportSection {
  title: string;
  type: 'summary' | 'issues' | 'recommendations' | 'model_insights' | 'changes';
  content: string;
  data?: unknown;
}
