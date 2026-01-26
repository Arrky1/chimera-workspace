import { NextResponse } from 'next/server';
import { getAvailableModels, getAllProvidersHealth, generateWithModel } from '@/lib/models';
import { getTeamManager } from '@/lib/team';
import { ModelProvider } from '@/types';

// Quick health check
export async function GET() {
  const models = getAvailableModels();
  const providersHealth = getAllProvidersHealth();
  const teamManager = getTeamManager();
  const memoryStats = teamManager.getMemoryStats();

  const availableProviders = models
    .filter(m => m.available)
    .map(m => m.provider)
    .filter((v, i, a) => a.indexOf(v) === i); // unique

  const healthyProviders = availableProviders.filter(
    p => providersHealth[p]?.isHealthy !== false
  );

  const overallStatus = healthyProviders.length > 0 ? 'healthy' : 'degraded';

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    providers: {
      total: availableProviders.length,
      healthy: healthyProviders.length,
      details: Object.fromEntries(
        availableProviders.map(p => [p, {
          available: true,
          healthy: providersHealth[p]?.isHealthy !== false,
          consecutiveFailures: providersHealth[p]?.consecutiveFailures || 0,
          lastError: providersHealth[p]?.errorMessage,
          lastSuccess: providersHealth[p]?.lastSuccess
            ? new Date(providersHealth[p].lastSuccess).toISOString()
            : null,
        }])
      ),
    },
    team: {
      members: memoryStats.members,
      activeTasks: memoryStats.tasks - memoryStats.completedTasks,
      completedTasks: memoryStats.completedTasks,
    },
    models: models
      .filter(m => m.available)
      .map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
      })),
  });
}

// Deep health check - actually tests provider connections
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { providers: requestedProviders } = body as { providers?: ModelProvider[] };

  const models = getAvailableModels();
  const availableProviders = requestedProviders ||
    [...new Set(models.filter(m => m.available).map(m => m.provider))];

  const results: Record<string, {
    status: 'ok' | 'error';
    latency?: number;
    error?: string;
    model?: string;
  }> = {};

  // Test each provider with a simple request
  const testPromises = availableProviders.map(async (provider) => {
    const model = models.find(m => m.provider === provider && m.available);
    if (!model) {
      results[provider] = { status: 'error', error: 'No available model' };
      return;
    }

    try {
      const response = await generateWithModel(
        provider,
        model.apiModel,
        'Reply with just "OK"',
        'You are a health check bot. Reply with exactly "OK" and nothing else.',
        { timeout: 30000, skipHealthCheck: true } // Short timeout for health check
      );

      if (response.status === 'completed') {
        results[provider] = {
          status: 'ok',
          latency: response.latency,
          model: model.name,
        };
      } else {
        results[provider] = {
          status: 'error',
          error: response.error,
          latency: response.latency,
        };
      }
    } catch (error) {
      results[provider] = {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  await Promise.all(testPromises);

  const healthyCount = Object.values(results).filter(r => r.status === 'ok').length;
  const overallStatus = healthyCount === availableProviders.length
    ? 'healthy'
    : healthyCount > 0
      ? 'degraded'
      : 'unhealthy';

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    tested: availableProviders.length,
    healthy: healthyCount,
    results,
  });
}
