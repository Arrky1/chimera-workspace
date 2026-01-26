import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface GitHubRepo {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  isPrivate: boolean;
}

export interface CloneResult {
  success: boolean;
  localPath: string;
  error?: string;
}

// Parse GitHub URL to extract owner and repo name
export function parseGitHubUrl(url: string): GitHubRepo | null {
  // Support formats:
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  // owner/repo

  let match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/);

  if (!match) {
    // Try simple owner/repo format
    match = url.match(/^([\w.-]+)\/([\w.-]+)$/);
  }

  if (!match) return null;

  const owner = match[1];
  const name = match[2].replace(/\.git$/, '');

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
    isPrivate: false, // Will be determined after API call
  };
}

// Get temp directory for cloning repos
function getReposDir(): string {
  return path.join(process.cwd(), '.chimera-repos');
}

// Clone a GitHub repository
export async function cloneRepo(
  repoUrl: string,
  token?: string
): Promise<CloneResult> {
  const repo = parseGitHubUrl(repoUrl);
  if (!repo) {
    return { success: false, localPath: '', error: 'Invalid GitHub URL' };
  }

  const reposDir = getReposDir();
  const localPath = path.join(reposDir, repo.owner, repo.name);

  try {
    // Create repos directory
    await fs.mkdir(reposDir, { recursive: true });

    // Check if already cloned
    try {
      await fs.access(localPath);
      // Repo exists, pull latest
      await execAsync('git pull', { cwd: localPath });
      return { success: true, localPath };
    } catch {
      // Repo doesn't exist, clone it
    }

    // Build clone URL with token for private repos
    let cloneUrl = `https://github.com/${repo.fullName}.git`;
    if (token) {
      cloneUrl = `https://${token}@github.com/${repo.fullName}.git`;
    }

    // Create owner directory
    await fs.mkdir(path.join(reposDir, repo.owner), { recursive: true });

    // Clone with depth 1 for speed
    await execAsync(`git clone --depth 1 "${cloneUrl}" "${localPath}"`);

    return { success: true, localPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clone failed';
    // Don't expose token in error messages
    const safeMessage = message.replace(/https:\/\/[^@]+@/g, 'https://***@');
    return { success: false, localPath: '', error: safeMessage };
  }
}

// Get repository info from GitHub API
export async function getRepoInfo(
  repoUrl: string,
  token?: string
): Promise<{
  name: string;
  description: string;
  isPrivate: boolean;
  defaultBranch: string;
  language: string;
  stars: number;
} | null> {
  const repo = parseGitHubUrl(repoUrl);
  if (!repo) return null;

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Chimera-Orchestrator',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${repo.fullName}`,
      { headers }
    );

    if (!response.ok) return null;

    const data = await response.json();

    return {
      name: data.name,
      description: data.description || '',
      isPrivate: data.private,
      defaultBranch: data.default_branch,
      language: data.language || 'Unknown',
      stars: data.stargazers_count,
    };
  } catch {
    return null;
  }
}

// Create a new branch
export async function createBranch(
  localPath: string,
  branchName: string
): Promise<boolean> {
  try {
    await execAsync(`git checkout -b "${branchName}"`, { cwd: localPath });
    return true;
  } catch {
    return false;
  }
}

// Commit changes
export async function commitChanges(
  localPath: string,
  message: string,
  files?: string[]
): Promise<boolean> {
  try {
    if (files && files.length > 0) {
      await execAsync(`git add ${files.map(f => `"${f}"`).join(' ')}`, { cwd: localPath });
    } else {
      await execAsync('git add -A', { cwd: localPath });
    }

    await execAsync(`git commit -m "${message}"`, { cwd: localPath });
    return true;
  } catch {
    return false;
  }
}

// Push changes
export async function pushChanges(
  localPath: string,
  branch: string,
  token?: string
): Promise<boolean> {
  try {
    // Set remote URL with token if provided
    if (token) {
      const { stdout } = await execAsync('git remote get-url origin', { cwd: localPath });
      const url = stdout.trim();
      const repo = parseGitHubUrl(url);
      if (repo) {
        const authUrl = `https://${token}@github.com/${repo.fullName}.git`;
        await execAsync(`git remote set-url origin "${authUrl}"`, { cwd: localPath });
      }
    }

    await execAsync(`git push -u origin "${branch}"`, { cwd: localPath });
    return true;
  } catch {
    return false;
  }
}

// Create a Pull Request
export async function createPullRequest(
  repo: GitHubRepo,
  token: string,
  options: {
    title: string;
    body: string;
    head: string;
    base: string;
  }
): Promise<{ success: boolean; prUrl?: string; error?: string }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo.fullName}/pulls`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Chimera-Orchestrator',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: options.title,
          body: options.body,
          head: options.head,
          base: options.base,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to create PR' };
    }

    const data = await response.json();
    return { success: true, prUrl: data.html_url };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create PR'
    };
  }
}

// Clean up cloned repo
export async function cleanupRepo(localPath: string): Promise<void> {
  try {
    await fs.rm(localPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// List all cloned repos
export async function listClonedRepos(): Promise<string[]> {
  const reposDir = getReposDir();
  const repos: string[] = [];

  try {
    const owners = await fs.readdir(reposDir);
    for (const owner of owners) {
      const ownerPath = path.join(reposDir, owner);
      const stat = await fs.stat(ownerPath);
      if (stat.isDirectory()) {
        const repoNames = await fs.readdir(ownerPath);
        for (const name of repoNames) {
          repos.push(`${owner}/${name}`);
        }
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  return repos;
}
