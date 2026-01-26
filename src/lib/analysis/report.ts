import {
  AnalysisResult,
  AnalysisIssue,
  AnalysisSummary,
  Recommendation,
  RevisionReport,
  ReportSection,
  RevisionSession,
} from '@/types/analysis';

// Generate analysis summary
export function generateSummary(issues: AnalysisIssue[]): AnalysisSummary {
  const bySeverity: Record<AnalysisIssue['severity'], number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  const byType: Record<string, number> = {};

  for (const issue of issues) {
    bySeverity[issue.severity]++;
    byType[issue.type] = (byType[issue.type] || 0) + 1;
  }

  // Calculate health score (0-100)
  const weights = { critical: 20, high: 10, medium: 3, low: 1, info: 0 };
  const totalPenalty = Object.entries(bySeverity).reduce(
    (sum, [severity, count]) => sum + weights[severity as keyof typeof weights] * count,
    0
  );
  const healthScore = Math.max(0, 100 - totalPenalty);

  return {
    totalIssues: issues.length,
    bySeverity,
    byType: byType as Record<string, number>,
    healthScore,
    autoFixableCount: issues.filter(i => i.autoFixable).length,
  };
}

// Generate recommendations based on issues
export function generateRecommendations(issues: AnalysisIssue[]): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Group issues by type
  const issuesByType = new Map<string, AnalysisIssue[]>();
  for (const issue of issues) {
    const existing = issuesByType.get(issue.type) || [];
    existing.push(issue);
    issuesByType.set(issue.type, existing);
  }

  // Security recommendations
  const securityIssues = issuesByType.get('security') || [];
  if (securityIssues.length > 0) {
    const criticalSecurity = securityIssues.filter(i => i.severity === 'critical');
    if (criticalSecurity.length > 0) {
      recommendations.push({
        priority: 1,
        title: 'Fix Critical Security Vulnerabilities',
        description: `Found ${criticalSecurity.length} critical security issues including potential secrets exposure and injection vulnerabilities. These should be fixed immediately.`,
        effort: 'medium',
        impact: 'high',
        relatedIssues: criticalSecurity.map(i => i.id),
      });
    }
  }

  // Performance recommendations
  const perfIssues = issuesByType.get('performance') || [];
  if (perfIssues.length > 5) {
    recommendations.push({
      priority: 2,
      title: 'Performance Optimization Pass',
      description: `Found ${perfIssues.length} performance issues. Consider a dedicated optimization sprint to improve app responsiveness.`,
      effort: 'high',
      impact: 'high',
      relatedIssues: perfIssues.slice(0, 5).map(i => i.id),
    });
  }

  // Code quality recommendations
  const qualityIssues = issuesByType.get('code_quality') || [];
  const todoIssues = qualityIssues.filter(i => i.title.includes('TODO'));
  if (todoIssues.length > 10) {
    recommendations.push({
      priority: 3,
      title: 'Address Technical Debt',
      description: `Found ${todoIssues.length} TODO/FIXME comments. Schedule time to address accumulated technical debt.`,
      effort: 'medium',
      impact: 'medium',
      relatedIssues: todoIssues.slice(0, 5).map(i => i.id),
    });
  }

  // Console.log cleanup
  const consoleIssues = qualityIssues.filter(i => i.title.includes('Console'));
  if (consoleIssues.length > 0) {
    recommendations.push({
      priority: 4,
      title: 'Clean Up Debug Statements',
      description: `Found ${consoleIssues.length} console.log statements. Remove or replace with proper logging before production.`,
      effort: 'low',
      impact: 'low',
      relatedIssues: consoleIssues.map(i => i.id),
    });
  }

  // Sort by priority
  recommendations.sort((a, b) => a.priority - b.priority);

  return recommendations;
}

// Generate markdown report
export function generateMarkdownReport(session: RevisionSession): string {
  if (!session.result) return 'No analysis results available.';

  const { projectInfo, issues, summary, recommendations } = session.result;

  let report = `# Project Revision Report

## Project Overview

| Property | Value |
|----------|-------|
| **Name** | ${projectInfo.name} |
| **Path** | \`${projectInfo.path}\` |
| **Framework** | ${projectInfo.framework || 'Unknown'} |
| **Language** | ${projectInfo.language || 'Unknown'} |
| **Total Files** | ${projectInfo.totalFiles} |
| **Total Lines** | ${projectInfo.totalLines.toLocaleString()} |

## Health Score

\`\`\`
${getHealthBar(summary.healthScore)}
${summary.healthScore}/100
\`\`\`

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${summary.bySeverity.critical} |
| 🟠 High | ${summary.bySeverity.high} |
| 🟡 Medium | ${summary.bySeverity.medium} |
| 🔵 Low | ${summary.bySeverity.low} |
| ⚪ Info | ${summary.bySeverity.info} |
| **Total** | **${summary.totalIssues}** |

Auto-fixable issues: ${summary.autoFixableCount}

## Top Recommendations

${recommendations.slice(0, 5).map((rec, i) => `
### ${i + 1}. ${rec.title}

${rec.description}

- **Effort:** ${rec.effort}
- **Impact:** ${rec.impact}
- **Related Issues:** ${rec.relatedIssues.length}
`).join('\n')}

## All Issues

${generateIssuesList(issues)}

---

*Generated by Unified Orchestrator on ${new Date().toISOString()}*
`;

  return report;
}

function getHealthBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  const color = score >= 80 ? '🟢' : score >= 60 ? '🟡' : score >= 40 ? '🟠' : '🔴';
  return `${color} [${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function generateIssuesList(issues: AnalysisIssue[]): string {
  // Group by type
  const byType = new Map<string, AnalysisIssue[]>();
  for (const issue of issues) {
    const existing = byType.get(issue.type) || [];
    existing.push(issue);
    byType.set(issue.type, existing);
  }

  let output = '';

  for (const [type, typeIssues] of byType) {
    output += `\n### ${type.replace('_', ' ').toUpperCase()}\n\n`;

    // Sort by severity
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    typeIssues.sort((a, b) =>
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
    );

    for (const issue of typeIssues) {
      const severityEmoji = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🔵',
        info: '⚪',
      }[issue.severity];

      output += `#### ${severityEmoji} ${issue.title}\n\n`;
      output += `${issue.description}\n\n`;

      if (issue.file) {
        output += `**File:** \`${issue.file}\``;
        if (issue.line) output += ` (line ${issue.line})`;
        output += '\n\n';
      }

      if (issue.code) {
        output += `\`\`\`\n${issue.code}\n\`\`\`\n\n`;
      }

      if (issue.suggestion) {
        output += `💡 **Suggestion:** ${issue.suggestion}\n\n`;
      }

      if (issue.autoFixable) {
        output += `✨ *Auto-fixable*\n\n`;
      }

      output += '---\n\n';
    }
  }

  return output;
}

// Generate JSON report
export function generateJsonReport(session: RevisionSession): string {
  return JSON.stringify({
    session: {
      id: session.id,
      projectPath: session.projectPath,
      status: session.status,
      startTime: session.startTime,
      endTime: session.endTime,
    },
    projectInfo: session.projectInfo,
    result: session.result,
  }, null, 2);
}

// Generate HTML report
export function generateHtmlReport(session: RevisionSession): string {
  const markdown = generateMarkdownReport(session);

  // Simple markdown to HTML conversion
  let html = markdown
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/```[\s\S]*?```/g, (match) => `<pre>${match.slice(3, -3)}</pre>`)
    .replace(/\n/g, '<br>\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Project Revision Report - ${session.projectInfo.name}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #0a0a0f; color: #e4e4e7; }
    h1, h2, h3 { color: #fff; }
    code { background: #1a1a2e; padding: 2px 6px; border-radius: 4px; }
    pre { background: #1a1a2e; padding: 16px; border-radius: 8px; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #2a2a3e; padding: 8px 12px; text-align: left; }
    th { background: #1a1a2e; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}
