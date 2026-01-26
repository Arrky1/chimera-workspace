import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectInfo, DirectoryNode } from '@/types/analysis';

// Files and directories to ignore
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.cache',
  'coverage',
  '.env',
  '.env.local',
  '*.log',
  '.DS_Store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

// File extensions to analyze
const CODE_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.java', '.kt',
  '.rb',
  '.php',
  '.vue', '.svelte',
  '.css', '.scss', '.sass', '.less',
  '.html', '.htm',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
  '.sql',
  '.sh', '.bash', '.zsh',
  '.dockerfile', '.docker-compose.yml',
];

export async function scanProject(projectPath: string): Promise<ProjectInfo> {
  const absolutePath = path.resolve(projectPath);

  // Check if path exists
  try {
    await fs.access(absolutePath);
  } catch {
    throw new Error(`Project path does not exist: ${absolutePath}`);
  }

  const stats = await fs.stat(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${absolutePath}`);
  }

  // Scan directory structure
  const structure = await scanDirectory(absolutePath, absolutePath);

  // Count files and lines
  const { totalFiles, totalLines } = await countFilesAndLines(structure);

  // Detect framework and language
  const { framework, language, packageManager } = await detectProjectType(absolutePath);

  return {
    path: absolutePath,
    name: path.basename(absolutePath),
    framework,
    language,
    packageManager,
    totalFiles,
    totalLines,
    structure,
  };
}

async function scanDirectory(dirPath: string, rootPath: string): Promise<DirectoryNode> {
  const name = path.basename(dirPath);
  const relativePath = path.relative(rootPath, dirPath) || '.';

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const children: DirectoryNode[] = [];

  for (const entry of entries) {
    // Skip ignored patterns
    if (shouldIgnore(entry.name)) continue;

    const entryPath = path.join(dirPath, entry.name);
    const relativeEntryPath = path.relative(rootPath, entryPath);

    if (entry.isDirectory()) {
      const childNode = await scanDirectory(entryPath, rootPath);
      children.push(childNode);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const stats = await fs.stat(entryPath);

      children.push({
        name: entry.name,
        type: 'file',
        path: relativeEntryPath,
        size: stats.size,
        extension: ext,
      });
    }
  }

  // Sort: directories first, then files
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    name,
    type: 'directory',
    path: relativePath,
    children,
  };
}

function shouldIgnore(name: string): boolean {
  return IGNORE_PATTERNS.some(pattern => {
    if (pattern.startsWith('*')) {
      return name.endsWith(pattern.slice(1));
    }
    return name === pattern;
  });
}

async function countFilesAndLines(node: DirectoryNode): Promise<{ totalFiles: number; totalLines: number }> {
  let totalFiles = 0;
  let totalLines = 0;

  async function traverse(n: DirectoryNode, basePath: string) {
    if (n.type === 'file') {
      const ext = n.extension?.toLowerCase() || '';
      if (CODE_EXTENSIONS.includes(ext)) {
        totalFiles++;
        try {
          const content = await fs.readFile(path.join(basePath, n.path), 'utf-8');
          totalLines += content.split('\n').length;
        } catch {
          // Skip unreadable files
        }
      }
    } else if (n.children) {
      for (const child of n.children) {
        await traverse(child, basePath);
      }
    }
  }

  // Get root path from the structure
  const rootPath = path.dirname(node.path === '.' ? process.cwd() : node.path);
  await traverse(node, rootPath);

  return { totalFiles, totalLines };
}

async function detectProjectType(projectPath: string): Promise<{
  framework?: string;
  language?: string;
  packageManager?: string;
}> {
  const result: { framework?: string; language?: string; packageManager?: string } = {};

  // Check for package.json (Node.js)
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

    result.language = 'JavaScript/TypeScript';

    // Detect framework
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps['next']) result.framework = 'Next.js';
    else if (deps['nuxt']) result.framework = 'Nuxt';
    else if (deps['@angular/core']) result.framework = 'Angular';
    else if (deps['vue']) result.framework = 'Vue';
    else if (deps['svelte']) result.framework = 'Svelte';
    else if (deps['react']) result.framework = 'React';
    else if (deps['express']) result.framework = 'Express';
    else if (deps['fastify']) result.framework = 'Fastify';
    else if (deps['nest']) result.framework = 'NestJS';

    // Check TypeScript
    if (deps['typescript'] || await fileExists(path.join(projectPath, 'tsconfig.json'))) {
      result.language = 'TypeScript';
    }
  } catch {
    // Not a Node.js project
  }

  // Check for Python
  if (await fileExists(path.join(projectPath, 'requirements.txt')) ||
      await fileExists(path.join(projectPath, 'pyproject.toml')) ||
      await fileExists(path.join(projectPath, 'setup.py'))) {
    result.language = 'Python';

    // Detect Python framework
    try {
      const reqPath = path.join(projectPath, 'requirements.txt');
      const requirements = await fs.readFile(reqPath, 'utf-8');

      if (requirements.includes('django')) result.framework = 'Django';
      else if (requirements.includes('fastapi')) result.framework = 'FastAPI';
      else if (requirements.includes('flask')) result.framework = 'Flask';
    } catch {
      // Skip
    }
  }

  // Check for Go
  if (await fileExists(path.join(projectPath, 'go.mod'))) {
    result.language = 'Go';
  }

  // Check for Rust
  if (await fileExists(path.join(projectPath, 'Cargo.toml'))) {
    result.language = 'Rust';
  }

  // Detect package manager
  if (await fileExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
    result.packageManager = 'pnpm';
  } else if (await fileExists(path.join(projectPath, 'yarn.lock'))) {
    result.packageManager = 'yarn';
  } else if (await fileExists(path.join(projectPath, 'package-lock.json'))) {
    result.packageManager = 'npm';
  } else if (await fileExists(path.join(projectPath, 'bun.lockb'))) {
    result.packageManager = 'bun';
  }

  return result;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Read file content with size limit
export async function readFileContent(filePath: string, maxSize: number = 100000): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > maxSize) {
      return null; // File too large
    }
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// Get all code files in project
export async function getCodeFiles(structure: DirectoryNode, basePath: string): Promise<string[]> {
  const files: string[] = [];

  function traverse(node: DirectoryNode) {
    if (node.type === 'file') {
      const ext = node.extension?.toLowerCase() || '';
      if (CODE_EXTENSIONS.includes(ext)) {
        files.push(path.join(basePath, node.path));
      }
    } else if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(structure);
  return files;
}
