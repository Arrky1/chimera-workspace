import { ModelProvider } from '@/types';
import { generateWithModel, MODELS } from './models';

// Memory management constants
const MAX_COMPLETED_TASKS = 100; // Keep only last 100 completed tasks
const MAX_IDLE_MEMBERS = 20; // Keep max 20 idle members

// Team member roles and specializations
export type TeamRole =
  | 'lead_architect'
  | 'senior_developer'
  | 'junior_developer'
  | 'qa_engineer'
  | 'research_engineer'
  | 'devops_engineer'
  | 'technical_writer'
  | 'security_specialist'
  | 'performance_engineer'
  | 'ui_designer';

export interface TeamMember {
  id: string;
  name: string;
  role: TeamRole;
  emoji: string;
  provider: ModelProvider;
  modelId: string;
  specialty: string[];
  status: 'idle' | 'working' | 'reviewing' | 'complete';
  currentTask?: string;
  workload: number; // 0-100%
}

export interface TeamTask {
  id: string;
  title: string;
  description: string;
  type: 'research' | 'coding' | 'review' | 'testing' | 'documentation' | 'architecture' | 'debugging';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedTo?: string; // member id
  status: 'pending' | 'in_progress' | 'review' | 'complete' | 'blocked';
  dependencies?: string[]; // task ids
  result?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface TeamProject {
  id: string;
  name: string;
  tasks: TeamTask[];
  members: TeamMember[];
  lead: TeamMember;
  status: 'planning' | 'in_progress' | 'review' | 'complete';
  createdAt: Date;
}

// Predefined team member templates
const MEMBER_TEMPLATES: Record<string, Omit<TeamMember, 'id' | 'status' | 'currentTask' | 'workload'>> = {
  // Lead Architects
  alex: {
    name: 'Alex',
    role: 'lead_architect',
    emoji: '🧠',
    provider: 'claude',
    modelId: 'claude-opus-4-5-20251101',
    specialty: ['architecture', 'planning', 'complex_reasoning', 'team_management'],
  },

  // Senior Developers
  max: {
    name: 'Max',
    role: 'senior_developer',
    emoji: '💻',
    provider: 'openai',
    modelId: 'gpt-5.2',
    specialty: ['code', 'algorithms', 'mathematics', 'optimization'],
  },
  kate: {
    name: 'Kate',
    role: 'senior_developer',
    emoji: '👩‍💻',
    provider: 'claude',
    modelId: 'claude-sonnet-4-5-20251101',
    specialty: ['code', 'refactoring', 'best_practices'],
  },

  // Junior Developers
  dasha: {
    name: 'Dasha',
    role: 'junior_developer',
    emoji: '⚡',
    provider: 'claude',
    modelId: 'claude-sonnet-4-5-20251101',
    specialty: ['fast_code', 'simple_tasks', 'utilities'],
  },
  tim: {
    name: 'Tim',
    role: 'junior_developer',
    emoji: '🚀',
    provider: 'openai',
    modelId: 'o4-mini',
    specialty: ['fast_code', 'scripts', 'automation'],
  },

  // QA Engineers
  lena: {
    name: 'Lena',
    role: 'qa_engineer',
    emoji: '🔍',
    provider: 'gemini',
    modelId: 'gemini-3-pro',
    specialty: ['testing', 'edge_cases', 'multimodal', 'validation'],
  },
  mike: {
    name: 'Mike',
    role: 'qa_engineer',
    emoji: '🧪',
    provider: 'openai',
    modelId: 'gpt-5.2',
    specialty: ['testing', 'security_testing', 'penetration'],
  },

  // Research Engineers
  ivan: {
    name: 'Ivan',
    role: 'research_engineer',
    emoji: '🔬',
    provider: 'deepseek',
    modelId: 'deepseek-r1',
    specialty: ['research', 'deep_reasoning', 'analysis', 'papers'],
  },
  sergey: {
    name: 'Sergey',
    role: 'research_engineer',
    emoji: '📚',
    provider: 'openai',
    modelId: 'o3',
    specialty: ['research', 'complex_reasoning', 'mathematics'],
  },
  olga: {
    name: 'Olga',
    role: 'research_engineer',
    emoji: '🎓',
    provider: 'qwen',
    modelId: 'qwen3-235b-a22b-thinking-2507',
    specialty: ['research', 'analysis', 'synthesis'],
  },

  // DevOps
  nick: {
    name: 'Nick',
    role: 'devops_engineer',
    emoji: '🛠️',
    provider: 'claude',
    modelId: 'claude-sonnet-4-5-20251101',
    specialty: ['devops', 'ci_cd', 'infrastructure', 'docker'],
  },

  // Security
  anna: {
    name: 'Anna',
    role: 'security_specialist',
    emoji: '🔒',
    provider: 'openai',
    modelId: 'gpt-5.2-pro',
    specialty: ['security', 'vulnerabilities', 'audit', 'compliance'],
  },

  // Performance
  viktor: {
    name: 'Viktor',
    role: 'performance_engineer',
    emoji: '⚡',
    provider: 'deepseek',
    modelId: 'deepseek-r1',
    specialty: ['performance', 'optimization', 'profiling', 'benchmarks'],
  },

  // Technical Writer
  elena: {
    name: 'Elena',
    role: 'technical_writer',
    emoji: '📝',
    provider: 'claude',
    modelId: 'claude-sonnet-4-5-20251101',
    specialty: ['documentation', 'api_docs', 'tutorials', 'readme'],
  },
};

// Names pool for dynamic member creation
const NAMES_POOL = {
  male: ['Dmitry', 'Pavel', 'Andrey', 'Kirill', 'Artem', 'Nikita', 'Roman', 'Vlad', 'Boris', 'Yuri'],
  female: ['Maria', 'Natasha', 'Svetlana', 'Yulia', 'Anya', 'Oksana', 'Vera', 'Polina', 'Alina', 'Daria'],
};

// Alex's Team Manager class
export class TeamManager {
  private members: Map<string, TeamMember> = new Map();
  private tasks: Map<string, TeamTask> = new Map();
  private lead: TeamMember;
  private usedNames: Set<string> = new Set();

  constructor() {
    // Always start with Alex as lead
    this.lead = this.createMember('alex');
    this.members.set(this.lead.id, this.lead);
  }

  private createMember(templateKey: string): TeamMember {
    const template = MEMBER_TEMPLATES[templateKey];
    if (!template) throw new Error(`Unknown member template: ${templateKey}`);

    return {
      ...template,
      id: `member-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'idle',
      workload: 0,
    };
  }

  private generateUniqueName(gender: 'male' | 'female'): string {
    const pool = NAMES_POOL[gender];
    const available = pool.filter(n => !this.usedNames.has(n));
    if (available.length === 0) {
      return `${pool[0]}_${this.usedNames.size}`;
    }
    const name = available[Math.floor(Math.random() * available.length)];
    this.usedNames.add(name);
    return name;
  }

  // Alex analyzes task and decides team composition
  async analyzeAndPlanTask(userRequest: string): Promise<{
    analysis: string;
    requiredRoles: TeamRole[];
    taskBreakdown: Omit<TeamTask, 'id' | 'status' | 'createdAt'>[];
    estimatedTeamSize: number;
  }> {
    const systemPrompt = `You are Alex, a Lead Architect managing an AI development team.
Your job is to analyze user requests and plan how to execute them with your team.

Available team roles:
- senior_developer: Complex coding, algorithms
- junior_developer: Simple tasks, utilities, scripts
- qa_engineer: Testing, validation, edge cases
- research_engineer: Research, analysis, deep reasoning
- devops_engineer: Infrastructure, CI/CD, deployment
- security_specialist: Security audits, vulnerabilities
- performance_engineer: Optimization, profiling
- technical_writer: Documentation

Respond in JSON format:
{
  "analysis": "Brief analysis of the request",
  "requiredRoles": ["role1", "role2"],
  "taskBreakdown": [
    {"title": "Task 1", "description": "...", "type": "coding|research|testing|...", "priority": "high|medium|low"}
  ],
  "estimatedTeamSize": number,
  "reasoning": "Why this team composition"
}`;

    const response = await generateWithModel(
      'claude',
      'claude-opus-4-5-20251101',
      `Analyze this request and plan the team:\n\n${userRequest}`,
      systemPrompt
    );

    try {
      const parsed = JSON.parse(response.content);
      return {
        analysis: parsed.analysis,
        requiredRoles: parsed.requiredRoles,
        taskBreakdown: parsed.taskBreakdown.map((t: { title: string; description: string; type: string; priority: string }) => ({
          ...t,
          type: t.type as TeamTask['type'],
          priority: t.priority as TeamTask['priority'],
        })),
        estimatedTeamSize: parsed.estimatedTeamSize,
      };
    } catch {
      // Fallback if parsing fails
      return {
        analysis: 'Standard task analysis',
        requiredRoles: ['senior_developer'],
        taskBreakdown: [{
          title: 'Execute request',
          description: userRequest,
          type: 'coding',
          priority: 'medium',
        }],
        estimatedTeamSize: 2,
      };
    }
  }

  // Assemble team based on required roles
  assembleTeam(requiredRoles: TeamRole[]): TeamMember[] {
    const team: TeamMember[] = [this.lead];

    for (const role of requiredRoles) {
      // Find existing idle member with this role
      let member = Array.from(this.members.values()).find(
        m => m.role === role && m.status === 'idle' && m.id !== this.lead.id
      );

      // If not found, create new member
      if (!member) {
        member = this.hireForRole(role);
        this.members.set(member.id, member);
      }

      if (!team.find(m => m.id === member!.id)) {
        team.push(member);
      }
    }

    return team;
  }

  // Create a new team member for a specific role
  private hireForRole(role: TeamRole): TeamMember {
    // Find best template for role
    const templates = Object.entries(MEMBER_TEMPLATES)
      .filter(([_, t]) => t.role === role)
      .map(([key]) => key);

    if (templates.length > 0) {
      // Use existing template
      const templateKey = templates[Math.floor(Math.random() * templates.length)];
      return this.createMember(templateKey);
    }

    // Create dynamic member
    const gender = Math.random() > 0.5 ? 'male' : 'female';
    const name = this.generateUniqueName(gender);
    const emojis: Record<TeamRole, string> = {
      lead_architect: '🧠',
      senior_developer: '💻',
      junior_developer: '🚀',
      qa_engineer: '🔍',
      research_engineer: '🔬',
      devops_engineer: '🛠️',
      security_specialist: '🔒',
      performance_engineer: '⚡',
      technical_writer: '📝',
      ui_designer: '🎨',
    };

    // Pick best available model for role
    const roleModels: Record<TeamRole, { provider: ModelProvider; modelId: string }> = {
      lead_architect: { provider: 'claude', modelId: 'claude-opus-4-5-20251101' },
      senior_developer: { provider: 'openai', modelId: 'gpt-5.2' },
      junior_developer: { provider: 'claude', modelId: 'claude-sonnet-4-5-20251101' },
      qa_engineer: { provider: 'gemini', modelId: 'gemini-3-pro' },
      research_engineer: { provider: 'deepseek', modelId: 'deepseek-r1' },
      devops_engineer: { provider: 'claude', modelId: 'claude-sonnet-4-5-20251101' },
      security_specialist: { provider: 'openai', modelId: 'gpt-5.2-pro' },
      performance_engineer: { provider: 'deepseek', modelId: 'deepseek-r1' },
      technical_writer: { provider: 'claude', modelId: 'claude-sonnet-4-5-20251101' },
      ui_designer: { provider: 'gemini', modelId: 'gemini-3-pro' },
    };

    const modelConfig = roleModels[role];

    return {
      id: `member-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      role,
      emoji: emojis[role],
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      specialty: [role],
      status: 'idle',
      workload: 0,
    };
  }

  // Assign task to best available member
  assignTask(task: TeamTask, team: TeamMember[]): TeamMember | null {
    // Find member with matching specialty and lowest workload
    const candidates = team
      .filter(m => m.status !== 'working' || m.workload < 80)
      .sort((a, b) => a.workload - b.workload);

    if (candidates.length === 0) return null;

    // Match by task type to role
    const typeToRole: Record<TeamTask['type'], TeamRole[]> = {
      research: ['research_engineer', 'lead_architect'],
      coding: ['senior_developer', 'junior_developer'],
      review: ['qa_engineer', 'senior_developer', 'lead_architect'],
      testing: ['qa_engineer'],
      documentation: ['technical_writer', 'senior_developer'],
      architecture: ['lead_architect', 'senior_developer'],
      debugging: ['senior_developer', 'junior_developer', 'performance_engineer'],
    };

    const preferredRoles = typeToRole[task.type];
    const bestMatch = candidates.find(c => preferredRoles.includes(c.role)) || candidates[0];

    bestMatch.status = 'working';
    bestMatch.currentTask = task.title;
    bestMatch.workload = Math.min(100, bestMatch.workload + 30);
    task.assignedTo = bestMatch.id;
    task.status = 'in_progress';

    return bestMatch;
  }

  // Execute task with assigned member
  async executeTask(task: TeamTask, member: TeamMember): Promise<string> {
    const systemPrompt = `You are ${member.name}, a ${member.role.replace('_', ' ')} with expertise in ${member.specialty.join(', ')}.
You are working on a team led by Alex (Lead Architect).

Your task: ${task.title}
Description: ${task.description}
Priority: ${task.priority}

Provide a thorough, professional response appropriate for your role.`;

    const response = await generateWithModel(
      member.provider,
      member.modelId,
      task.description,
      systemPrompt
    );

    // Update member status
    member.status = 'complete';
    member.currentTask = undefined;
    member.workload = Math.max(0, member.workload - 30);
    task.status = 'complete';
    task.result = response.content;
    task.completedAt = new Date();

    return response.content;
  }

  // Get current team state
  getTeamState(): {
    lead: TeamMember;
    members: TeamMember[];
    activeTasks: TeamTask[];
  } {
    return {
      lead: this.lead,
      members: Array.from(this.members.values()),
      activeTasks: Array.from(this.tasks.values()).filter(t => t.status !== 'complete'),
    };
  }

  // Create a new task
  createTask(task: Omit<TeamTask, 'id' | 'status' | 'createdAt'>): TeamTask {
    const newTask: TeamTask = {
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'pending',
      createdAt: new Date(),
    };
    this.tasks.set(newTask.id, newTask);
    return newTask;
  }

  // Memory cleanup - remove old completed tasks and excess idle members
  cleanup(): void {
    // Get all completed tasks sorted by completion time
    const completedTasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'complete' && t.completedAt)
      .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0));

    // Remove old completed tasks beyond limit
    if (completedTasks.length > MAX_COMPLETED_TASKS) {
      const tasksToRemove = completedTasks.slice(MAX_COMPLETED_TASKS);
      for (const task of tasksToRemove) {
        this.tasks.delete(task.id);
      }
      console.log(`[TeamManager] Cleaned up ${tasksToRemove.length} old completed tasks`);
    }

    // Get idle members (excluding lead)
    const idleMembers = Array.from(this.members.values())
      .filter(m => m.status === 'idle' && m.id !== this.lead.id);

    // Remove excess idle members
    if (idleMembers.length > MAX_IDLE_MEMBERS) {
      const membersToRemove = idleMembers.slice(MAX_IDLE_MEMBERS);
      for (const member of membersToRemove) {
        this.members.delete(member.id);
        this.usedNames.delete(member.name);
      }
      console.log(`[TeamManager] Cleaned up ${membersToRemove.length} excess idle members`);
    }
  }

  // Get memory stats for monitoring
  getMemoryStats(): { tasks: number; members: number; completedTasks: number } {
    const completedTasks = Array.from(this.tasks.values()).filter(t => t.status === 'complete').length;
    return {
      tasks: this.tasks.size,
      members: this.members.size,
      completedTasks,
    };
  }
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup every 5 minutes

// Singleton instance
let teamManagerInstance: TeamManager | null = null;
let cleanupIntervalId: NodeJS.Timeout | null = null;

export function getTeamManager(): TeamManager {
  if (!teamManagerInstance) {
    teamManagerInstance = new TeamManager();

    // Start periodic cleanup
    if (!cleanupIntervalId) {
      cleanupIntervalId = setInterval(() => {
        teamManagerInstance?.cleanup();
      }, CLEANUP_INTERVAL_MS);
    }
  }
  return teamManagerInstance;
}

// For testing or reset purposes
export function resetTeamManager(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  teamManagerInstance = null;
}
