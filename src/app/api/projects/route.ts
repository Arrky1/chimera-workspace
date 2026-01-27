import { NextRequest, NextResponse } from 'next/server';
import { cloneRepo, getRepoInfo, parseGitHubUrl, createBranch, commitChanges, pushChanges, createPullRequest } from '@/lib/github';
import { scanProject, runAnalysis } from '@/lib/analysis';
import { generateSummary } from '@/lib/analysis/report';
import { Project, ProjectAnalysis, ProjectIssue, FixRequest, FixResult } from '@/types/project';
import {
  getProject, getAllProjects, setProject, deleteProject, hasProject,
  getAnalysis, setAnalysis,
} from '@/lib/project-store';
import * as fs from 'fs/promises';
import * as path from 'path';

function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('id');

  if (projectId) {
    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const analysis = getAnalysis(projectId);
    return NextResponse.json({ project, analysis });
  }

  return NextResponse.json({ projects: getAllProjects() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (!action || typeof action !== 'string') {
      return NextResponse.json({ error: 'action is required (string)' }, { status: 400 });
    }

    switch (action) {
      case 'add': {
        if (!body.githubUrl || typeof body.githubUrl !== 'string') {
          return NextResponse.json({ error: 'githubUrl is required (string)' }, { status: 400 });
        }
        return addProject(body.githubUrl);
      }
      case 'analyze': {
        if (!body.projectId || typeof body.projectId !== 'string') {
          return NextResponse.json({ error: 'projectId is required (string)' }, { status: 400 });
        }
        return analyzeProject(body.projectId);
      }
      case 'fix': {
        if (!body.projectId || !body.issueIds || !Array.isArray(body.issueIds)) {
          return NextResponse.json({ error: 'projectId and issueIds[] required' }, { status: 400 });
        }
        return fixIssues(body as FixRequest);
      }
      case 'remove': {
        if (!body.projectId || typeof body.projectId !== 'string') {
          return NextResponse.json({ error: 'projectId is required (string)' }, { status: 400 });
        }
        return removeProject(body.projectId);
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
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

  const existing = hasProject(parsed.url);
  if (existing) {
    return NextResponse.json({ error: 'Project already added', projectId: existing.id }, { status: 400 });
  }

  const repoInfo = await getRepoInfo(githubUrl, token);
  if (!repoInfo) {
    return NextResponse.json(
      { error: 'Cannot access repository. Make sure it exists and GITHUB_TOKEN is set for private repos.' },
      { status: 400 }
    );
  }

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

  setProject(projectId, project);
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
    project.status = 'cloning';
    project.updatedAt = new Date();
    setProject(project.id, project);
    console.log(`[Projects] Cloning ${project.owner}/${project.repo}...`);

    const cloneResult = await cloneRepo(project.githubUrl, token);

    if (!cloneResult.success) {
      project.status = 'error';
      project.error = cloneResult.error;
      project.updatedAt = new Date();
      setProject(project.id, project);
      console.error(`[Projects] Clone failed for ${project.owner}/${project.repo}: ${cloneResult.error}`);
      return;
    }

    project.status = 'analyzing';
    project.updatedAt = new Date();
    setProject(project.id, project);
    console.log(`[Projects] Analyzing ${project.owner}/${project.repo}...`);

    const projectInfo = await scanProject(cloneResult.localPath);
    const issues = await runAnalysis(projectInfo, ['security', 'performance', 'code_quality', 'architecture']);
    const summary = generateSummary(issues);

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
        language: projectInfo.language || 'Unknown',
      },
    };

    setAnalysis(project.id, analysis);

    project.status = 'ready';
    project.healthScore = summary.healthScore;
    project.issuesCount = projectIssues.length;
    project.lastAnalysis = new Date();
    project.updatedAt = new Date();
    setProject(project.id, project);
    console.log(`[Projects] Analysis complete for ${project.owner}/${project.repo}: ${projectIssues.length} issues, health ${summary.healthScore}`);

  } catch (error) {
    project.status = 'error';
    project.error = error instanceof Error ? error.message : 'Analysis failed';
    project.updatedAt = new Date();
    setProject(project.id, project);
    console.error(`[Projects] Analysis error for ${project.owner}/${project.repo}:`, error);
  }
}

async function analyzeProject(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (project.status === 'cloning' || project.status === 'analyzing') {
    return NextResponse.json({ error: 'Analysis already in progress' }, { status: 400 });
  }

  project.status = 'analyzing';
  project.updatedAt = new Date();
  cloneAndAnalyze(project);

  return NextResponse.json({ success: true, message: 'Re-analysis started' });
}

async function fixIssues(request: FixRequest) {
  const project = getProject(request.projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const analysis = getAnalysis(request.projectId);
  if (!analysis) {
    return NextResponse.json({ error: 'No analysis found. Run analysis first.' }, { status: 400 });
  }

  const token = getGitHubToken();
  if (!token) {
    return NextResponse.json({ error: 'GITHUB_TOKEN required for fixes' }, { status: 400 });
  }

  const reposDir = path.join(process.cwd(), '.chimera-repos');
  const localPath = path.join(reposDir, project.owner, project.repo);

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
    const branchName = `chimera-fixes-${Date.now()}`;
    await createBranch(localPath, branchName);

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

    const commitMessage = `fix: Chimera auto-fixes (${result.fixedCount} issues)\n\nFixed issues:\n${
      issuesToFix.filter(i => i.status === 'fixed').map(i => `- ${i.title}`).join('\n')
    }`;

    await commitChanges(localPath, commitMessage);
    await pushChanges(localPath, branchName, token);

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
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  deleteProject(projectId);

  try {
    const reposDir = path.join(process.cwd(), '.chimera-repos');
    const localPath = path.join(reposDir, project.owner, project.repo);
    await fs.rm(localPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  return NextResponse.json({ success: true, message: 'Project removed' });
}
