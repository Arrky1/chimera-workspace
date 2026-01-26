/**
 * Execution Store - Persistent state management for Chimera
 *
 * Provides:
 * - Execution state persistence (Redis or in-memory fallback)
 * - Recovery after restart
 * - Idempotency support
 * - Audit logging
 */

import Redis from 'ioredis';
import { ExecutionPlan, ModelProvider } from '@/types';

// Store configuration
const REDIS_URL = process.env.REDIS_URL;
const EXECUTION_TTL = 60 * 60 * 24; // 24 hours
const AUDIT_TTL = 60 * 60 * 24 * 7; // 7 days

// Execution state with full context
export interface ExecutionState {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  plan: ExecutionPlan;
  currentPhaseIndex: number;
  phaseResults: Record<string, PhaseExecutionResult>;
  error?: string;
  metadata: {
    userId?: string;
    source?: string;
    idempotencyKey?: string;
  };
}

export interface PhaseExecutionResult {
  phaseId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  modelCalls: ModelCallRecord[];
}

export interface ModelCallRecord {
  id: string;
  provider: ModelProvider;
  modelId: string;
  prompt: string;
  systemPrompt?: string;
  response?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  latency?: number;
  tokens?: { input: number; output: number };
}

export interface AuditLogEntry {
  timestamp: number;
  executionId: string;
  event: 'created' | 'phase_started' | 'phase_completed' | 'phase_failed' | 'completed' | 'failed' | 'cancelled' | 'model_call';
  data: Record<string, unknown>;
}

// Redis client singleton
let redisClient: Redis | null = null;
let useInMemory = false;

// In-memory fallback store
const inMemoryStore = new Map<string, string>();
const inMemoryAuditLog: AuditLogEntry[] = [];

// Initialize Redis connection
function getRedisClient(): Redis | null {
  if (useInMemory) return null;

  if (!redisClient && REDIS_URL) {
    try {
      redisClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('[Store] Redis connection failed, using in-memory');
            useInMemory = true;
            return null;
          }
          return Math.min(times * 100, 3000);
        },
        lazyConnect: true,
      });

      redisClient.on('error', (err) => {
        console.error('[Store] Redis error:', err.message);
        if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
          console.warn('[Store] Falling back to in-memory store');
          useInMemory = true;
          redisClient = null;
        }
      });

      redisClient.on('connect', () => {
        console.log('[Store] Connected to Redis');
      });
    } catch (error) {
      console.warn('[Store] Redis initialization failed, using in-memory:', error);
      useInMemory = true;
    }
  }

  if (!REDIS_URL) {
    useInMemory = true;
  }

  return redisClient;
}

// Key generators
const keys = {
  execution: (id: string) => `chimera:execution:${id}`,
  idempotency: (key: string) => `chimera:idempotency:${key}`,
  audit: (id: string) => `chimera:audit:${id}`,
  activeExecutions: () => 'chimera:active',
};

// Generate unique execution ID
export function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `exec-${timestamp}-${random}`;
}

// Create new execution
export async function createExecution(
  plan: ExecutionPlan,
  metadata?: ExecutionState['metadata']
): Promise<ExecutionState> {
  const redis = getRedisClient();
  const id = generateExecutionId();

  const state: ExecutionState = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    plan,
    currentPhaseIndex: 0,
    phaseResults: {},
    metadata: metadata || {},
  };

  // Initialize phase results
  for (const phase of plan.phases) {
    state.phaseResults[phase.id] = {
      phaseId: phase.id,
      status: 'pending',
      modelCalls: [],
    };
  }

  const serialized = JSON.stringify(state);

  if (redis) {
    await redis.setex(keys.execution(id), EXECUTION_TTL, serialized);
    await redis.sadd(keys.activeExecutions(), id);
  } else {
    inMemoryStore.set(keys.execution(id), serialized);
  }

  await logAudit(id, 'created', { planId: plan.id, phases: plan.phases.length });

  return state;
}

// Get execution by ID
export async function getExecution(id: string): Promise<ExecutionState | null> {
  const redis = getRedisClient();
  let data: string | null = null;

  if (redis) {
    data = await redis.get(keys.execution(id));
  } else {
    data = inMemoryStore.get(keys.execution(id)) || null;
  }

  if (!data) return null;

  try {
    return JSON.parse(data) as ExecutionState;
  } catch {
    console.error('[Store] Failed to parse execution state:', id);
    return null;
  }
}

// Update execution state
export async function updateExecution(
  id: string,
  updates: Partial<ExecutionState>
): Promise<ExecutionState | null> {
  const state = await getExecution(id);
  if (!state) return null;

  const updated: ExecutionState = {
    ...state,
    ...updates,
    updatedAt: Date.now(),
  };

  const redis = getRedisClient();
  const serialized = JSON.stringify(updated);

  if (redis) {
    await redis.setex(keys.execution(id), EXECUTION_TTL, serialized);
  } else {
    inMemoryStore.set(keys.execution(id), serialized);
  }

  return updated;
}

// Start phase execution
export async function startPhase(
  executionId: string,
  phaseId: string
): Promise<ExecutionState | null> {
  const state = await getExecution(executionId);
  if (!state) return null;

  const phaseResult = state.phaseResults[phaseId];
  if (!phaseResult) return null;

  phaseResult.status = 'running';
  phaseResult.startedAt = Date.now();

  // Update plan phase status too
  const planPhase = state.plan.phases.find(p => p.id === phaseId);
  if (planPhase) {
    planPhase.status = 'running';
  }

  await logAudit(executionId, 'phase_started', { phaseId });

  return updateExecution(executionId, {
    status: 'running',
    phaseResults: state.phaseResults,
    plan: state.plan,
  });
}

// Complete phase execution
export async function completePhase(
  executionId: string,
  phaseId: string,
  result: unknown
): Promise<ExecutionState | null> {
  const state = await getExecution(executionId);
  if (!state) return null;

  const phaseResult = state.phaseResults[phaseId];
  if (!phaseResult) return null;

  phaseResult.status = 'completed';
  phaseResult.completedAt = Date.now();
  phaseResult.result = result;

  // Update plan phase status
  const planPhase = state.plan.phases.find(p => p.id === phaseId);
  if (planPhase) {
    planPhase.status = 'completed';
    planPhase.progress = 100;
    planPhase.result = { output: JSON.stringify(result) };
  }

  // Move to next phase
  const currentIndex = state.plan.phases.findIndex(p => p.id === phaseId);
  const nextIndex = currentIndex + 1;
  const isLastPhase = nextIndex >= state.plan.phases.length;

  await logAudit(executionId, 'phase_completed', {
    phaseId,
    duration: phaseResult.completedAt - (phaseResult.startedAt || 0),
  });

  // If last phase, also log overall completion
  if (isLastPhase) {
    await logAudit(executionId, 'completed', {
      totalDuration: Date.now() - state.createdAt,
      phases: state.plan.phases.length,
    });
  }

  return updateExecution(executionId, {
    status: isLastPhase ? 'completed' : 'running',
    currentPhaseIndex: nextIndex,
    phaseResults: state.phaseResults,
    plan: state.plan,
  });
}

// Fail phase execution
export async function failPhase(
  executionId: string,
  phaseId: string,
  error: string
): Promise<ExecutionState | null> {
  const state = await getExecution(executionId);
  if (!state) return null;

  const phaseResult = state.phaseResults[phaseId];
  if (!phaseResult) return null;

  phaseResult.status = 'failed';
  phaseResult.completedAt = Date.now();
  phaseResult.error = error;

  // Update plan phase status
  const planPhase = state.plan.phases.find(p => p.id === phaseId);
  if (planPhase) {
    planPhase.status = 'failed';
  }

  await logAudit(executionId, 'phase_failed', { phaseId, error });
  await logAudit(executionId, 'failed', { error, failedPhase: phaseId });

  return updateExecution(executionId, {
    status: 'failed',
    error,
    phaseResults: state.phaseResults,
    plan: state.plan,
  });
}

// Record model call
export async function recordModelCall(
  executionId: string,
  phaseId: string,
  call: Omit<ModelCallRecord, 'id'>
): Promise<void> {
  const state = await getExecution(executionId);
  if (!state) return;

  const phaseResult = state.phaseResults[phaseId];
  if (!phaseResult) return;

  const callRecord: ModelCallRecord = {
    ...call,
    id: `call-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
  };

  phaseResult.modelCalls.push(callRecord);

  await updateExecution(executionId, {
    phaseResults: state.phaseResults,
  });

  await logAudit(executionId, 'model_call', {
    phaseId,
    provider: call.provider,
    modelId: call.modelId,
    latency: call.latency,
    hasError: !!call.error,
  });
}

// Idempotency check - returns existing execution ID if found
export async function checkIdempotency(key: string): Promise<string | null> {
  const redis = getRedisClient();

  if (redis) {
    return redis.get(keys.idempotency(key));
  } else {
    return inMemoryStore.get(keys.idempotency(key)) || null;
  }
}

// Set idempotency key
export async function setIdempotency(key: string, executionId: string, ttl = 3600): Promise<void> {
  const redis = getRedisClient();

  if (redis) {
    await redis.setex(keys.idempotency(key), ttl, executionId);
  } else {
    inMemoryStore.set(keys.idempotency(key), executionId);
  }
}

// Audit logging
async function logAudit(
  executionId: string,
  event: AuditLogEntry['event'],
  data: Record<string, unknown>
): Promise<void> {
  const entry: AuditLogEntry = {
    timestamp: Date.now(),
    executionId,
    event,
    data,
  };

  const redis = getRedisClient();

  if (redis) {
    await redis.lpush(keys.audit(executionId), JSON.stringify(entry));
    await redis.expire(keys.audit(executionId), AUDIT_TTL);
  } else {
    inMemoryAuditLog.push(entry);
    // Trim in-memory log
    if (inMemoryAuditLog.length > 1000) {
      inMemoryAuditLog.splice(0, 100);
    }
  }
}

// Get audit log for execution
export async function getAuditLog(executionId: string): Promise<AuditLogEntry[]> {
  const redis = getRedisClient();

  if (redis) {
    const entries = await redis.lrange(keys.audit(executionId), 0, -1);
    return entries.map(e => JSON.parse(e) as AuditLogEntry).reverse();
  } else {
    return inMemoryAuditLog
      .filter(e => e.executionId === executionId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

// Get active executions
export async function getActiveExecutions(): Promise<string[]> {
  const redis = getRedisClient();

  if (redis) {
    return redis.smembers(keys.activeExecutions());
  } else {
    // For in-memory, scan for running executions
    const active: string[] = [];
    for (const [key, value] of inMemoryStore.entries()) {
      if (key.startsWith('chimera:execution:')) {
        try {
          const state = JSON.parse(value) as ExecutionState;
          if (state.status === 'running' || state.status === 'pending') {
            active.push(state.id);
          }
        } catch {
          // Skip invalid entries
        }
      }
    }
    return active;
  }
}

// Cancel execution
export async function cancelExecution(id: string): Promise<ExecutionState | null> {
  const state = await getExecution(id);
  if (!state) return null;

  if (state.status === 'completed' || state.status === 'failed') {
    return state; // Already finished
  }

  await logAudit(id, 'cancelled', { previousStatus: state.status });

  const redis = getRedisClient();
  if (redis) {
    await redis.srem(keys.activeExecutions(), id);
  }

  return updateExecution(id, { status: 'cancelled' });
}

// Cleanup old executions (call periodically)
export async function cleanupStore(): Promise<number> {
  const redis = getRedisClient();
  if (!redis) {
    // In-memory cleanup
    const now = Date.now();
    let cleaned = 0;
    for (const [key, value] of inMemoryStore.entries()) {
      if (key.startsWith('chimera:execution:')) {
        try {
          const state = JSON.parse(value) as ExecutionState;
          if (now - state.updatedAt > EXECUTION_TTL * 1000) {
            inMemoryStore.delete(key);
            cleaned++;
          }
        } catch {
          inMemoryStore.delete(key);
          cleaned++;
        }
      }
    }
    return cleaned;
  }

  // Redis handles TTL automatically
  return 0;
}

// Check if using Redis or in-memory
export function isUsingRedis(): boolean {
  getRedisClient(); // Trigger initialization
  return !useInMemory && !!REDIS_URL;
}

// Get store stats
export async function getStoreStats(): Promise<{
  mode: 'redis' | 'memory';
  activeExecutions: number;
  totalKeys?: number;
}> {
  const redis = getRedisClient();
  const active = await getActiveExecutions();

  if (redis && !useInMemory) {
    try {
      const info = await redis.dbsize();
      return {
        mode: 'redis',
        activeExecutions: active.length,
        totalKeys: info,
      };
    } catch {
      // Redis might not be connected yet
    }
  }

  return {
    mode: 'memory',
    activeExecutions: active.length,
    totalKeys: inMemoryStore.size,
  };
}
