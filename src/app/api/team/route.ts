import { NextRequest, NextResponse } from 'next/server';
import { getTeamManager, TeamTask } from '@/lib/team';

export async function GET() {
  const manager = getTeamManager();
  const state = manager.getTeamState();

  return NextResponse.json({
    lead: state.lead,
    members: state.members,
    activeTasks: state.activeTasks,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, userRequest, taskId } = body;
    const manager = getTeamManager();

    switch (action) {
      case 'plan': {
        // Alex analyzes the request and plans the team
        const plan = await manager.analyzeAndPlanTask(userRequest);

        // Assemble the team
        const team = manager.assembleTeam(plan.requiredRoles);

        // Create tasks
        const tasks = plan.taskBreakdown.map((t) => manager.createTask(t));

        return NextResponse.json({
          type: 'plan',
          analysis: plan.analysis,
          team: team.map((m) => ({
            id: m.id,
            name: m.name,
            role: m.role,
            emoji: m.emoji,
            provider: m.provider,
            status: m.status,
          })),
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            type: t.type,
            priority: t.priority,
            status: t.status,
          })),
          estimatedTeamSize: plan.estimatedTeamSize,
        });
      }

      case 'execute': {
        // Execute all pending tasks
        const state = manager.getTeamState();
        const pendingTasks = state.activeTasks.filter((t) => t.status === 'pending');
        const results: { taskId: string; member: string; result: string }[] = [];

        for (const task of pendingTasks) {
          const member = manager.assignTask(task, state.members);
          if (member) {
            const result = await manager.executeTask(task, member);
            results.push({
              taskId: task.id,
              member: member.name,
              result,
            });
          }
        }

        // Alex synthesizes results
        if (results.length > 0) {
          const synthesisPrompt = `As Lead Architect Alex, synthesize these team results into a coherent response:

${results.map((r) => `**${r.member}:**\n${r.result}`).join('\n\n---\n\n')}

Provide a unified, well-structured response that combines all findings.`;

          const { generateWithModel } = await import('@/lib/models');
          const synthesis = await generateWithModel(
            'claude',
            'claude-opus-4-5-20251101',
            synthesisPrompt,
            'You are Alex, Lead Architect. Synthesize team results professionally.'
          );

          return NextResponse.json({
            type: 'result',
            synthesis: synthesis.content,
            teamResults: results,
            team: state.members.map((m) => ({
              id: m.id,
              name: m.name,
              status: m.status,
              workload: m.workload,
            })),
          });
        }

        return NextResponse.json({
          type: 'no_tasks',
          message: 'No pending tasks to execute',
        });
      }

      case 'status': {
        const state = manager.getTeamState();
        return NextResponse.json({
          type: 'status',
          ...state,
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Team API error:', error);
    return NextResponse.json(
      { error: 'Internal error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
