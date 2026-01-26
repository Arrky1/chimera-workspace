import { NextRequest, NextResponse } from 'next/server';
import { cloneRepo, getRepoInfo, parseGitHubUrl, createBranch, commitChanges, pushChanges, createPullRequest } from '@/lib/github';
import { scanProject, runAnalysis } from '@/lib/analysis';
import { generateSummary } from '@/lib/analysis/report';
import { Project, ProjectAnalysis, ProjectIssue, FixRequest, FixResult } from '@/types/project';
import * as fs from 'fs/promises';
import * as path from 'path';

// In-memory storage (use DB in production)
const projects = new Map<string, Project>();
const analyses = new Map<string, ProjectAnalysis>();

function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('id');

  if (projectId) {
    const project = projects.get(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const analysis = analyses.get(projectId);
    return NextResponse.json({ project, analysis });
  }

  // Return all projects
  const projectList = Array.from(projects.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return NextResponse.json({ projects: projectList });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'add':
        return addProject(body.githubUrl);

      case 'analyze':
        return analyzeProject(body.projectId);

      case 'fix':
        return fixIssues(body as FixRequest);

      case 'remove':
        return removeProject(body.projectId);

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Projects API error:', error);
    return NextResponse.json(
      { error: 'Internal error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

async function addProject(githubUrl: string) {
  const token = getGitHubToken();
  const parsed = parseGitHubUrl(githubUrl);

  if (!parsed) {
    return NextResponse.json({ error: 'Invalid GitHub URL' }, { status: 400 });
  }

  // Check if already added
  const existing = Array.from(projects.values()).find(
    p => p.githubUrl === parsed.url
  );
  if (existing) {
    return NextResponse.json({ error: 'Project already added', projectId: existing.id }, { status: 400 });
  }

  // Get repo info from GitHub API
  const repoInfo = await getRepoInfo(githubUrl, token);

  if (!repoInfo) {
    return NextResponse.json(
      { error: 'Cannot access repository. Make sure it exists and GITHUB_TOKEN is set for private repos.' },
      { status: 400 }
    );
  }

  // Create project
  const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const project: Project = {
    id: projectId,
    name: repoInfo.name,
    description: repoInfo.description,
    githubUrl: parsed.url,
    owner: parsed.owner,
    repo: parsed.name,
    isPrivate: repoInfo.isPrivate,
    language: repoInfo.language,
    defaultBranch: repoInfo.defaultBranch,
    status: 'cloning',
    addedAt: new Date(),
    updatedAt: new Date(),
  };

  projects.set(projectId, project);

  // Clone in background
  cloneAndAnalyze(project);

  return NextResponse.json({
    success: true,
    project,
    message: 'Project added. Cloning and analyzing...',
  });
}

async function cloneAndAnalyze(project: Project) {
  const token = getGitHubToken();

  try {
    // Clone
    project.status = 'cloning';
    project.updatedAt = new Date();

    const cloneResult = await cloneRepo(project.githubUrl, token);

    if (!cloneResult.success) {
      project.status = 'error';
      project.error = cloneResult.error;
      project.updatedAt = new Date();
      return;
    }

    // Analyze
    project.status = 'analyzing';
    project.updatedAt = new Date();

    const projectInfo = await scanProject(cloneResult.localPath);
    const issues = await runAnalysis(projectInfo, ['security', 'performance', 'code_quality', 'architecture']);
    const summary = generateSummary(issues);

    // Convert to ProjectIssue format
    // Map AnalysisIssue.type to ProjectIssue.category
    const typeToCategory = (type: string): ProjectIssue['category'] => {
      const mapping: Record<string, ProjectIssue['category']> = {
        'security': 'security',
        'performance': 'performance',
        'code_quality': 'code_quality',
        'architecture': 'architecture',
        'accessibility': 'accessibility',
        'dependencies': 'code_quality',
        'tests': 'code_quality',
        'documentation': 'code_quality',
      };
      return mapping[type] || 'code_quality';
    };

    const projectIssues: ProjectIssue[] = issues.map(issue => ({
      id: issue.id,
      projectId: project.id,
      title: issue.title,
      description: issue.description,
      severity: issue.severity,
      category: typeToCategory(issue.type),
      file: issue.file,
      line: issue.line,
      canAutoFix: issue.autoFixable || false,
      fix: issue.fix ? {
        description: issue.fix.description,
        newContent: issue.fix.changes?.[0]?.newContent,
      } : undefined,
      status: 'open',
    }));

    // Calculate scores
    const categoryScores = {
      security: 100,
      performance: 100,
      codeQuality: 100,
      architecture: 100,
    };

    for (const issue of projectIssues) {
      const penalty = issue.severity === 'critical' ? 25 : issue.severity === 'high' ? 15 : issue.severity === 'medium' ? 8 : 3;
      const cat = issue.category === 'code_quality' ? 'codeQuality' : issue.category;
      if (cat in categoryScores) {
        categoryScores[cat as keyof typeof categoryScores] = Math.max(0, categoryScores[cat as keyof typeof categoryScores] - penalty);
      }
    }

    const analysis: ProjectAnalysis = {
      projectId: project.id,
      timestamp: new Date(),
      duration: 0,
      healthScore: summary.healthScore,
      scores: categoryScores,
      issues: projectIssues,
      summary: {
        totalFiles: projectInfo.totalFiles,
        totalLines: projectInfo.totalLines,
        framework: projectInfo.framework,
        language: projectInfo.language,
      },
    };

    analyses.set(project.id, analysis);

    // Update project
    project.status = 'ready';
    project.healthScore = summary.healthScore;
    project.issuesCount = projectIssues.length;
    project.lastAnalysis = new Date();
    project.updatedAt = new Date();

  } catch (error) {
    project.status = 'error';
    project.error = error instanceof Error ? error.message : 'Analysis failed';
    project.updatedAt = new Date();
  }
}

async function analyzeProject(projectId: string) {
  const project = projects.get(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (project.status === 'cloning' || project.status === 'analyzing') {
    return NextResponse.json({ error: 'Analysis already in progress' }, { status: 400 });
  }

  // Re-analyze
  project.status = 'analyzing';
  project.updatedAt = new Date();
  cloneAndAnalyze(project);

  return NextResponse.json({
    success: true,
    message: 'Re-analysis started',
  });
}

async function fixIssues(request: FixRequest) {
  const project = projects.get(request.projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const analysis = analyses.get(request.projectId);
  if (!analysis) {
    return NextResponse.json({ error: 'No analysis found. Run analysis first.' }, { status: 400 });
  }

  const token = getGitHubToken();
  if (!token) {
    return NextResponse.json({ error: 'GITHUB_TOKEN required for fixes' }, { status: 400 });
  }

  const reposDir = path.join(process.cwd(), '.chimera-repos');
  const localPath = path.join(reposDir, project.owner, project.repo);

  // Get issues to fix
  const issuesToFix = analysis.issues.filter(
    i => request.issueIds.includes(i.id) && i.canAutoFix && i.fix
  );

  if (issuesToFix.length === 0) {
    return NextResponse.json({ error: 'No fixable issues selected' }, { status: 400 });
  }

  const result: FixResult = {
    success: false,
    projectId: request.projectId,
    fixedCount: 0,
    failedCount: 0,
    details: [],
  };

  try {
    // Create branch for fixes
    const branchName = `chimera-fixes-${Date.now()}`;
    await createBranch(localPath, branchName);

    // Apply fixes
    for (const issue of issuesToFix) {
      try {
        if (issue.fix?.newContent && issue.file) {
          const filePath = path.join(localPath, issue.file);
          await fs.writeFile(filePath, issue.fix.newContent, 'utf-8');
          issue.status = 'fixed';
          issue.fixedAt = new Date();
          result.fixedCount++;
          result.details.push({ issueId: issue.id, success: true });
        } else {
          result.failedCount++;
          result.details.push({ issueId: issue.id, success: false, error: 'No fix content' });
        }
      } catch (error) {
        result.failedCount++;
        result.details.push({
          issueId: issue.id,
          success: false,
          error: error instanceof Error ? error.message : 'Fix failed'
        });
      }
    }

    if (result.fixedCount === 0) {
      result.error = 'No fixes were applied';
      return NextResponse.json(result);
    }

    // Commit changes
    const commitMessage = `fix: Chimera auto-fixes (${result.fixedCount} issues)\n\nFixed issues:\n${
      issuesToFix.filter(i => i.status === 'fixed').map(i => `- ${i.title}`).join('\n')
    }`;

    await commitChanges(localPath, commitMessage);

    // Push
    await pushChanges(localPath, branchName, token);

    // Create PR if requested
    if (request.createPR) {
      const prResult = await createPullRequest(
        { owner: project.owner, name: project.repo, fullName: `${project.owner}/${project.repo}`, url: project.githubUrl, isPrivate: project.isPrivate },
        token,
        {
          title: request.prTitle || `Chimera: Fix ${result.fixedCount} issues`,
          body: request.prDescription || `## Automated Fixes by Chimera\n\nThis PR contains ${result.fixedCount} automated fixes:\n\n${
            issuesToFix.filter(i => i.status === 'fixed').map(i => `- **${i.title}** (${i.severity})\n  ${i.description}`).join('\n\n')
          }\n\n---\n*Generated by [Chimera](https://github.com/Arrky1/chimera)*`,
          head: branchName,
          base: project.defaultBranch,
        }
      );

      if (prResult.success) {
        result.prUrl = prResult.prUrl;
        // Update issues with PR URL
        for (const issue of issuesToFix.filter(i => i.status === 'fixed')) {
          issue.prUrl = prResult.prUrl;
        }
      } else {
        result.error = `Fixes applied but PR creation failed: ${prResult.error}`;
      }
    }

    result.success = true;

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Fix process failed';
  }

  return NextResponse.json(result);
}

async function removeProject(projectId: string) {
  const project = projects.get(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Remove from storage
  projects.delete(projectId);
  analyses.delete(projectId);

  // Optionally clean up cloned files
  try {
    const reposDir = path.join(process.cwd(), '.chimera-repos');
    const localPath = path.join(reposDir, project.owner, project.repo);
    await fs.rm(localPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  return NextResponse.json({ success: true, message: 'Project removed' });
}
