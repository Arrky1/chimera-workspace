import { AnalysisIssue, AnalysisCheck, ProjectInfo } from '@/types/analysis';
import { generateWithModel, getAvailableModels } from '../models';
import { readFileContent, getCodeFiles } from './scanner';
import * as path from 'path';

// Base analyzer interface
interface Analyzer {
  type: AnalysisCheck;
  name: string;
  analyze(projectInfo: ProjectInfo, files: Map<string, string>): Promise<AnalysisIssue[]>;
}

// Security Analyzer
export const securityAnalyzer: Analyzer = {
  type: 'security',
  name: 'Security Analysis',

  async analyze(projectInfo, files): Promise<AnalysisIssue[]> {
    const issues: AnalysisIssue[] = [];

    for (const [filePath, content] of files) {
      const relativePath = path.relative(projectInfo.path, filePath);

      // Check for hardcoded secrets
      const secretPatterns = [
        { pattern: /(['"`])sk-[a-zA-Z0-9]{20,}\1/g, name: 'API Key' },
        { pattern: /(['"`])[a-f0-9]{32,}\1/g, name: 'Potential Secret' },
        { pattern: /password\s*[:=]\s*(['"`])[^'"]+\1/gi, name: 'Hardcoded Password' },
        { pattern: /apiKey\s*[:=]\s*(['"`])[^'"]+\1/gi, name: 'Hardcoded API Key' },
        { pattern: /secret\s*[:=]\s*(['"`])[^'"]+\1/gi, name: 'Hardcoded Secret' },
        { pattern: /AWS_SECRET_ACCESS_KEY\s*[:=]\s*(['"`])[^'"]+\1/gi, name: 'AWS Secret' },
      ];

      for (const { pattern, name } of secretPatterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            id: `sec-${issues.length}`,
            type: 'security',
            severity: 'critical',
            title: `${name} found in code`,
            description: `Potential ${name.toLowerCase()} found hardcoded in source code. This is a security risk.`,
            file: relativePath,
            line,
            code: match[0].substring(0, 50) + '...',
            suggestion: 'Move secrets to environment variables and use .env files (not committed to git)',
            autoFixable: false,
            references: ['https://owasp.org/www-project-web-security-testing-guide/'],
          });
        }
      }

      // Check for SQL injection vulnerabilities
      if (content.match(/\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi) ||
          content.match(/`.*\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi)) {
        issues.push({
          id: `sec-${issues.length}`,
          type: 'security',
          severity: 'critical',
          title: 'Potential SQL Injection',
          description: 'Template literals with SQL queries can lead to SQL injection attacks.',
          file: relativePath,
          suggestion: 'Use parameterized queries or an ORM',
          autoFixable: false,
          references: ['https://owasp.org/www-community/attacks/SQL_Injection'],
        });
      }

      // Check for XSS vulnerabilities (React)
      if (content.includes('dangerouslySetInnerHTML')) {
        const line = content.split('\n').findIndex(l => l.includes('dangerouslySetInnerHTML')) + 1;
        issues.push({
          id: `sec-${issues.length}`,
          type: 'security',
          severity: 'high',
          title: 'Potential XSS vulnerability',
          description: 'Using dangerouslySetInnerHTML can lead to XSS attacks if the content is not sanitized.',
          file: relativePath,
          line,
          suggestion: 'Sanitize HTML content before rendering or avoid using dangerouslySetInnerHTML',
          autoFixable: false,
          references: ['https://owasp.org/www-community/attacks/xss/'],
        });
      }

      // Check for eval usage
      if (content.match(/\beval\s*\(/)) {
        issues.push({
          id: `sec-${issues.length}`,
          type: 'security',
          severity: 'high',
          title: 'Dangerous eval() usage',
          description: 'Using eval() can execute arbitrary code and is a security risk.',
          file: relativePath,
          suggestion: 'Avoid using eval(). Use JSON.parse() for JSON or safer alternatives.',
          autoFixable: false,
        });
      }
    }

    return issues;
  }
};

// Performance Analyzer
export const performanceAnalyzer: Analyzer = {
  type: 'performance',
  name: 'Performance Analysis',

  async analyze(projectInfo, files): Promise<AnalysisIssue[]> {
    const issues: AnalysisIssue[] = [];

    for (const [filePath, content] of files) {
      const relativePath = path.relative(projectInfo.path, filePath);

      // Check for console.log in production code
      if (!filePath.includes('.test.') && !filePath.includes('.spec.') && !filePath.includes('__tests__')) {
        const consoleMatches = content.matchAll(/console\.(log|debug|info)\(/g);
        for (const match of consoleMatches) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            id: `perf-${issues.length}`,
            type: 'performance',
            severity: 'low',
            title: 'Console statement in production code',
            description: 'console.log statements should be removed in production for performance and security.',
            file: relativePath,
            line,
            suggestion: 'Remove console statements or use a proper logging library',
            autoFixable: true,
            fix: {
              description: 'Remove console statement',
              changes: [{
                file: relativePath,
                type: 'modify',
                diff: `- ${content.split('\n')[line - 1]}`,
              }]
            }
          });
        }
      }

      // Check for missing React.memo or useMemo
      if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
        // Large component without memo
        const componentMatch = content.match(/(?:export\s+)?(?:default\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/);
        if (componentMatch && content.length > 5000 && !content.includes('memo(') && !content.includes('React.memo')) {
          issues.push({
            id: `perf-${issues.length}`,
            type: 'performance',
            severity: 'medium',
            title: 'Large component without memoization',
            description: `Component "${componentMatch[1]}" is large and might benefit from React.memo()`,
            file: relativePath,
            suggestion: 'Consider wrapping with React.memo() to prevent unnecessary re-renders',
            autoFixable: false,
          });
        }
      }

      // Check for synchronous file operations in Node.js
      if (content.match(/\breadFileSync\b|\bwriteFileSync\b|\bexistsSync\b/)) {
        issues.push({
          id: `perf-${issues.length}`,
          type: 'performance',
          severity: 'medium',
          title: 'Synchronous file operations',
          description: 'Synchronous file operations block the event loop.',
          file: relativePath,
          suggestion: 'Use async/await with fs.promises instead',
          autoFixable: false,
        });
      }

      // Check for missing async/await with database calls
      if (content.match(/\.findOne\(|\.find\(|\.save\(|\.create\(/) &&
          !content.includes('await') && !content.includes('.then(')) {
        issues.push({
          id: `perf-${issues.length}`,
          type: 'performance',
          severity: 'high',
          title: 'Potentially unhandled async database operation',
          description: 'Database operations appear to be missing await/then handling.',
          file: relativePath,
          suggestion: 'Ensure database operations are properly awaited',
          autoFixable: false,
        });
      }
    }

    return issues;
  }
};

// Code Quality Analyzer
export const codeQualityAnalyzer: Analyzer = {
  type: 'code_quality',
  name: 'Code Quality Analysis',

  async analyze(projectInfo, files): Promise<AnalysisIssue[]> {
    const issues: AnalysisIssue[] = [];

    for (const [filePath, content] of files) {
      const relativePath = path.relative(projectInfo.path, filePath);
      const lines = content.split('\n');

      // Check for very long files
      if (lines.length > 500) {
        issues.push({
          id: `qual-${issues.length}`,
          type: 'code_quality',
          severity: 'medium',
          title: 'File too long',
          description: `File has ${lines.length} lines. Consider splitting into smaller modules.`,
          file: relativePath,
          suggestion: 'Split large files into smaller, focused modules',
          autoFixable: false,
        });
      }

      // Check for very long lines
      const longLines = lines.filter(l => l.length > 120);
      if (longLines.length > 10) {
        issues.push({
          id: `qual-${issues.length}`,
          type: 'code_quality',
          severity: 'low',
          title: 'Many long lines',
          description: `${longLines.length} lines exceed 120 characters.`,
          file: relativePath,
          suggestion: 'Consider breaking long lines for better readability',
          autoFixable: false,
        });
      }

      // Check for TODO/FIXME comments
      const todoMatches = content.matchAll(/\/\/\s*(TODO|FIXME|HACK|XXX)[\s:]+(.+)/gi);
      for (const match of todoMatches) {
        const line = content.substring(0, match.index).split('\n').length;
        issues.push({
          id: `qual-${issues.length}`,
          type: 'code_quality',
          severity: 'info',
          title: `${match[1].toUpperCase()} comment found`,
          description: match[2].trim(),
          file: relativePath,
          line,
          suggestion: 'Address the TODO or create a ticket to track it',
          autoFixable: false,
        });
      }

      // Check for duplicate code blocks (simple heuristic)
      const codeBlocks = content.match(/\{[\s\S]{50,200}\}/g) || [];
      const duplicates = codeBlocks.filter((block, i) =>
        codeBlocks.indexOf(block) !== i
      );
      if (duplicates.length > 0) {
        issues.push({
          id: `qual-${issues.length}`,
          type: 'code_quality',
          severity: 'medium',
          title: 'Potential code duplication',
          description: `Found ${duplicates.length} similar code blocks that might be duplicated.`,
          file: relativePath,
          suggestion: 'Consider extracting duplicated code into reusable functions',
          autoFixable: false,
        });
      }

      // Check for deeply nested code
      let maxNesting = 0;
      let currentNesting = 0;
      for (const char of content) {
        if (char === '{') currentNesting++;
        if (char === '}') currentNesting--;
        maxNesting = Math.max(maxNesting, currentNesting);
      }
      if (maxNesting > 5) {
        issues.push({
          id: `qual-${issues.length}`,
          type: 'code_quality',
          severity: 'medium',
          title: 'Deeply nested code',
          description: `Maximum nesting level is ${maxNesting}. Deep nesting reduces readability.`,
          file: relativePath,
          suggestion: 'Consider refactoring to reduce nesting (early returns, extract functions)',
          autoFixable: false,
        });
      }

      // Check for any type usage in TypeScript
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        const anyMatches = content.matchAll(/:\s*any\b/g);
        let anyCount = 0;
        for (const _ of anyMatches) anyCount++;
        if (anyCount > 3) {
          issues.push({
            id: `qual-${issues.length}`,
            type: 'code_quality',
            severity: 'medium',
            title: 'Excessive use of "any" type',
            description: `Found ${anyCount} usages of "any" type. This defeats TypeScript's type safety.`,
            file: relativePath,
            suggestion: 'Replace "any" with proper types or use "unknown" when type is truly unknown',
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  }
};

// AI-powered deep analysis
export async function aiDeepAnalysis(
  projectInfo: ProjectInfo,
  files: Map<string, string>,
  area: AnalysisCheck
): Promise<AnalysisIssue[]> {
  const models = getAvailableModels();
  const availableModel = models.find(m => m.available);

  if (!availableModel) {
    return [];
  }

  // Prepare code summary for AI
  const fileSummaries = Array.from(files.entries())
    .slice(0, 20) // Limit to 20 files for context
    .map(([path, content]) => {
      const lines = content.split('\n');
      const preview = lines.slice(0, 50).join('\n');
      return `### ${path} (${lines.length} lines)\n\`\`\`\n${preview}\n\`\`\`\n`;
    })
    .join('\n');

  const prompt = `Analyze this ${projectInfo.framework || projectInfo.language || 'code'} project for ${area} issues.

Project: ${projectInfo.name}
Framework: ${projectInfo.framework || 'Unknown'}
Language: ${projectInfo.language || 'Unknown'}
Total Files: ${projectInfo.totalFiles}

Code samples:
${fileSummaries}

Find specific ${area} issues. For each issue provide:
1. Severity (critical/high/medium/low)
2. File and line number if applicable
3. Clear description
4. Concrete fix suggestion

Format as JSON array:
[{"severity": "...", "title": "...", "description": "...", "file": "...", "line": N, "suggestion": "..."}]

Only return the JSON array, no other text.`;

  try {
    const response = await generateWithModel(
      availableModel.provider,
      availableModel.apiModel,
      prompt,
      'You are an expert code reviewer specializing in finding bugs, security issues, and improvements.'
    );

    // Parse AI response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const aiIssues = JSON.parse(jsonMatch[0]);
      return aiIssues.map((issue: any, idx: number) => ({
        id: `ai-${area}-${idx}`,
        type: area,
        severity: issue.severity || 'medium',
        title: issue.title,
        description: issue.description,
        file: issue.file,
        line: issue.line,
        suggestion: issue.suggestion,
        autoFixable: false,
      }));
    }
  } catch (error) {
    console.error('AI analysis error:', error);
  }

  return [];
}

// Run all analyzers
export async function runAnalysis(
  projectInfo: ProjectInfo,
  checks: AnalysisCheck[]
): Promise<AnalysisIssue[]> {
  // Load code files
  const codeFiles = await getCodeFiles(projectInfo.structure, projectInfo.path);
  const files = new Map<string, string>();

  for (const filePath of codeFiles.slice(0, 100)) { // Limit to 100 files
    const content = await readFileContent(filePath);
    if (content) {
      files.set(filePath, content);
    }
  }

  const allIssues: AnalysisIssue[] = [];

  // Run static analyzers
  const analyzers: Analyzer[] = [];
  if (checks.includes('security')) analyzers.push(securityAnalyzer);
  if (checks.includes('performance')) analyzers.push(performanceAnalyzer);
  if (checks.includes('code_quality')) analyzers.push(codeQualityAnalyzer);

  for (const analyzer of analyzers) {
    const issues = await analyzer.analyze(projectInfo, files);
    allIssues.push(...issues);
  }

  // Run AI deep analysis for architecture and complex checks
  if (checks.includes('architecture')) {
    const aiIssues = await aiDeepAnalysis(projectInfo, files, 'architecture');
    allIssues.push(...aiIssues);
  }

  return allIssues;
}
