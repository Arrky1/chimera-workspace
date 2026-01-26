import { NextRequest, NextResponse } from 'next/server';
import { scanProject, runAnalysis } from '@/lib/analysis';
import { generateSummary, generateRecommendations, generateMarkdownReport } from '@/lib/analysis/report';
import { executeCouncil, executeDeliberation } from '@/lib/orchestrator';
import {
  RevisionSession,
  AnalysisConfig,
  AnalysisResult,
  AnalysisCheck,
} from '@/types/analysis';

// Store sessions in memory (in production, use Redis or DB)
const sessions = new Map<string, RevisionSession>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, projectPath, sessionId, config } = body;

    switch (action) {
      case 'start':
        return startRevision(projectPath, config);

      case 'status':
        return getStatus(sessionId);

      case 'report':
        return getReport(sessionId, body.format);

      case 'apply_fix':
        return applyFix(sessionId, body.issueId);

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Revision error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

async function startRevision(projectPath: string, config?: Partial<AnalysisConfig>) {
  // Create session
  const sessionId = `rev-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const analysisConfig: AnalysisConfig = {
    checks: config?.checks || ['security', 'performance', 'code_quality', 'architecture'],
    depth: config?.depth || 'standard',
    autoFix: config?.autoFix ?? false,
    generateReport: config?.generateReport ?? true,
  };

  // Initialize session
  const session: RevisionSession = {
    id: sessionId,
    projectPath,
    projectInfo: null as any, // Will be set after scan
    config: analysisConfig,
    status: 'scanning',
    progress: 0,
    currentPhase: 'Scanning project structure...',
    appliedFixes: [],
    startTime: new Date(),
  };

  sessions.set(sessionId, session);

  // Start async analysis
  runRevisionAsync(session);

  return NextResponse.json({
    sessionId,
    status: 'started',
    message: 'Revision started. Use /api/revision with action=status to check progress.',
  });
}

async function runRevisionAsync(session: RevisionSession) {
  try {
    // Phase 1: Scan project
    session.status = 'scanning';
    session.currentPhase = 'Scanning project structure...';
    session.progress = 10;

    const projectInfo = await scanProject(session.projectPath);
    session.projectInfo = projectInfo;
    session.progress = 20;

    // Phase 2: Run static analysis
    session.status = 'analyzing';
    session.currentPhase = 'Running static analysis...';
    session.progress = 30;

    const staticIssues = await runAnalysis(projectInfo, session.config.checks);
    session.progress = 50;

    // Phase 3: AI-powered council review (if architecture check enabled)
    let modelInsights: AnalysisResult['modelInsights'] = [];

    if (session.config.checks.includes('architecture') && session.config.depth !== 'quick') {
      session.currentPhase = 'Council reviewing architecture...';
      session.progress = 60;

      try {
        const councilResult = await executeCouncil(
          `Review the architecture of this ${projectInfo.framework || projectInfo.language} project with ${projectInfo.totalFiles} files. Identify main architectural concerns and improvements.`,
          ['claude', 'openai']
        );

        for (const [model, insight] of Object.entries(councilResult.votes)) {
          modelInsights.push({
            model,
            area: 'architecture',
            insight,
            confidence: 0.8,
          });
        }
      } catch (error) {
        console.error('Council review failed:', error);
      }
    }

    session.progress = 70;

    // Phase 4: Generate fixes with deliberation (if autoFix enabled)
    if (session.config.autoFix) {
      session.status = 'generating_fixes';
      session.currentPhase = 'Generating fixes with deliberation...';
      session.progress = 80;

      // Only auto-fix safe issues
      const autoFixableIssues = staticIssues.filter(i => i.autoFixable);

      for (const issue of autoFixableIssues.slice(0, 10)) { // Limit to 10 auto-fixes
        try {
          const fixResult = await executeDeliberation(
            `Fix this issue: ${issue.title}\n\nDescription: ${issue.description}\nFile: ${issue.file}\n\nProvide the corrected code.`,
            'claude',
            'openai',
            2
          );

          if (fixResult.approved) {
            issue.fix = {
              description: 'Auto-generated fix',
              changes: [{
                file: issue.file || '',
                type: 'modify',
                newContent: fixResult.code,
              }]
            };
          }
        } catch (error) {
          console.error(`Failed to generate fix for ${issue.id}:`, error);
        }
      }
    }

    session.progress = 90;

    // Phase 5: Generate summary and recommendations
    session.status = 'reviewing';
    session.currentPhase = 'Generating report...';

    const summary = generateSummary(staticIssues);
    const recommendations = generateRecommendations(staticIssues);

    // Finalize result
    session.result = {
      projectInfo,
      issues: staticIssues,
      summary,
      modelInsights,
      recommendations,
      timestamp: new Date(),
    };

    session.status = 'completed';
    session.progress = 100;
    session.currentPhase = 'Revision complete!';
    session.endTime = new Date();

  } catch (error) {
    console.error('Revision failed:', error);
    session.status = 'failed';
    session.currentPhase = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

async function getStatus(sessionId: string) {
  const session = sessions.get(sessionId);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: session.id,
    status: session.status,
    progress: session.progress,
    currentPhase: session.currentPhase,
    projectInfo: session.projectInfo ? {
      name: session.projectInfo.name,
      framework: session.projectInfo.framework,
      language: session.projectInfo.language,
      totalFiles: session.projectInfo.totalFiles,
      totalLines: session.projectInfo.totalLines,
    } : null,
    summary: session.result?.summary,
    startTime: session.startTime,
    endTime: session.endTime,
  });
}

async function getReport(sessionId: string, format: 'markdown' | 'json' | 'html' = 'markdown') {
  const session = sessions.get(sessionId);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.status !== 'completed') {
    return NextResponse.json({ error: 'Revision not completed yet' }, { status: 400 });
  }

  const report = generateMarkdownReport(session);

  if (format === 'json') {
    return NextResponse.json(session.result);
  }

  return NextResponse.json({
    format,
    report,
    issues: session.result?.issues,
    recommendations: session.result?.recommendations,
  });
}

async function applyFix(sessionId: string, issueId: string) {
  const session = sessions.get(sessionId);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const issue = session.result?.issues.find(i => i.id === issueId);

  if (!issue) {
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  }

  if (!issue.fix) {
    return NextResponse.json({ error: 'No fix available for this issue' }, { status: 400 });
  }

  // In a real implementation, this would apply the fix to the file system
  // For now, we'll just mark it as applied
  session.appliedFixes.push(issueId);

  return NextResponse.json({
    success: true,
    message: `Fix for "${issue.title}" would be applied.`,
    fix: issue.fix,
    note: 'File system modifications are disabled in this demo. The fix details are provided for manual application.',
  });
}

// GET endpoint for listing sessions
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');

  if (sessionId) {
    return getStatus(sessionId);
  }

  // List all sessions
  const sessionList = Array.from(sessions.values()).map(s => ({
    id: s.id,
    projectPath: s.projectPath,
    status: s.status,
    progress: s.progress,
    healthScore: s.result?.summary.healthScore,
    issueCount: s.result?.summary.totalIssues,
    startTime: s.startTime,
  }));

  return NextResponse.json({ sessions: sessionList });
}
