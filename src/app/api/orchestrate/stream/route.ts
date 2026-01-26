/**
 * Streaming Orchestration Endpoint
 *
 * Provides Server-Sent Events (SSE) for real-time execution updates.
 * Supports cancellation via AbortController.
 */

import { NextRequest } from 'next/server';
import {
  parseIntent,
  detectAmbiguities,
  classifyTask,
  createExecutionPlan,
} from '@/lib/orchestrator';
import { generateWithModel, getAvailableModels, getBestModelForTask } from '@/lib/models';
import { getToolDescriptions, parseToolCalls, executeToolCalls } from '@/lib/mcp';
import {
  createExecution,
  getExecution,
  updateExecution,
  startPhase,
  completePhase,
  failPhase,
  recordModelCall,
  checkIdempotency,
  setIdempotency,
  cancelExecution,
} from '@/lib/execution-store';

// Active executions for cancellation support
const activeExecutions = new Map<string, AbortController>();

/**
 * Send SSE event
 */
function sendEvent(
  controller: ReadableStreamDefaultController,
  event: string,
  data: unknown
): void {
  const encoder = new TextEncoder();
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

/**
 * Check if execution was cancelled
 */
function checkCancelled(executionId: string): boolean {
  const abortController = activeExecutions.get(executionId);
  return abortController?.signal.aborted ?? false;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { message, idempotencyKey } = body;

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check idempotency
  if (idempotencyKey) {
    const existingId = await checkIdempotency(idempotencyKey);
    if (existingId) {
      const existing = await getExecution(existingId);
      if (existing) {
        return new Response(JSON.stringify({
          type: 'cached',
          executionId: existingId,
          plan: existing.plan,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      let executionId: string | null = null;

      try {
        // 1. Parse intent
        sendEvent(controller, 'phase', { phase: 'parsing', status: 'started' });
        const intent = await parseIntent(message);
        sendEvent(controller, 'phase', { phase: 'parsing', status: 'completed', data: intent });

        // Check for cancellation
        if (executionId && checkCancelled(executionId)) {
          sendEvent(controller, 'cancelled', { executionId });
          controller.close();
          return;
        }

        // 2. Detect ambiguities
        sendEvent(controller, 'phase', { phase: 'ambiguity_check', status: 'started' });
        const ambiguities = await detectAmbiguities(message, intent);
        sendEvent(controller, 'phase', { phase: 'ambiguity_check', status: 'completed', data: { count: ambiguities.length } });

        // If high ambiguity, return clarification request
        if (intent.confidence < 0.85 || ambiguities.filter(a => a.severity === 'high').length > 0) {
          sendEvent(controller, 'clarification_needed', {
            ambiguities,
            intent,
          });
          controller.close();
          return;
        }

        // 3. Classify and plan
        sendEvent(controller, 'phase', { phase: 'planning', status: 'started' });
        const classification = classifyTask(intent, message);
        const plan = createExecutionPlan(intent, classification, message);
        sendEvent(controller, 'phase', { phase: 'planning', status: 'completed', data: { classification, plan } });

        // 4. Create execution state
        const executionState = await createExecution(plan, {
          idempotencyKey,
          source: 'streaming',
        });
        executionId = executionState.id;

        // Register for cancellation
        const abortController = new AbortController();
        activeExecutions.set(executionId, abortController);

        // Set idempotency
        if (idempotencyKey) {
          await setIdempotency(idempotencyKey, executionId);
        }

        sendEvent(controller, 'execution_started', { executionId, plan });

        // 5. Execute based on complexity
        if (classification.complexity === 'simple') {
          await executeSimpleTaskStreaming(controller, message, plan, executionId);
        } else {
          // For complex tasks, send plan for confirmation
          sendEvent(controller, 'plan_confirmation_required', {
            executionId,
            plan,
            classification,
          });
        }

        sendEvent(controller, 'complete', { executionId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        sendEvent(controller, 'error', { error: errorMessage, executionId });

        if (executionId) {
          await updateExecution(executionId, { status: 'failed', error: errorMessage });
        }
      } finally {
        if (executionId) {
          activeExecutions.delete(executionId);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Cancel endpoint
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const executionId = searchParams.get('executionId');

  if (!executionId) {
    return new Response(JSON.stringify({ error: 'executionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Abort the execution
  const abortController = activeExecutions.get(executionId);
  if (abortController) {
    abortController.abort();
    activeExecutions.delete(executionId);
  }

  // Update execution state
  const result = await cancelExecution(executionId);

  if (!result) {
    return new Response(JSON.stringify({ error: 'Execution not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    executionId,
    status: result.status,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Get execution status
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const executionId = searchParams.get('executionId');

  if (!executionId) {
    return new Response(JSON.stringify({ error: 'executionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const state = await getExecution(executionId);

  if (!state) {
    return new Response(JSON.stringify({ error: 'Execution not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    executionId: state.id,
    status: state.status,
    currentPhase: state.currentPhaseIndex,
    plan: state.plan,
    phaseResults: state.phaseResults,
    error: state.error,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Execute simple task with streaming updates
 */
async function executeSimpleTaskStreaming(
  controller: ReadableStreamDefaultController,
  message: string,
  plan: Parameters<typeof startPhase>[1] extends string ? { phases: { id: string }[]; status: string } : never,
  executionId: string
): Promise<void> {
  const availableModels = getAvailableModels();
  const bestModel = getBestModelForTask('code', availableModels.filter(m => m.available));

  if (!bestModel) {
    await failPhase(executionId, plan.phases[0].id, 'No models available');
    sendEvent(controller, 'error', { error: 'No models available' });
    return;
  }

  // Start phase
  await startPhase(executionId, plan.phases[0].id);
  sendEvent(controller, 'phase_started', { phaseId: plan.phases[0].id, model: bestModel.name });

  // Check cancellation
  if (checkCancelled(executionId)) {
    sendEvent(controller, 'cancelled', { executionId });
    return;
  }

  const toolsDescription = getToolDescriptions();
  const systemPrompt = `You are a helpful AI assistant that helps with coding tasks. Be concise and provide working code.

Available tools you can use:
${toolsDescription}

To use a tool, format your response as:
<tool_use name="tool_name">{"param": "value"}</tool_use>`;

  const startTime = Date.now();

  // Stream progress updates
  sendEvent(controller, 'model_call_started', { model: bestModel.name, provider: bestModel.provider });

  const response = await generateWithModel(
    bestModel.provider,
    bestModel.apiModel,
    message,
    systemPrompt
  );

  // Check cancellation after model call
  if (checkCancelled(executionId)) {
    sendEvent(controller, 'cancelled', { executionId });
    return;
  }

  // Record model call
  await recordModelCall(executionId, plan.phases[0].id, {
    provider: bestModel.provider,
    modelId: bestModel.apiModel,
    prompt: message,
    systemPrompt,
    response: response.content,
    startedAt: startTime,
    completedAt: Date.now(),
    latency: response.latency,
  });

  sendEvent(controller, 'model_call_completed', {
    model: bestModel.name,
    latency: response.latency,
    contentLength: response.content.length,
  });

  // Process tool calls
  const toolCalls = parseToolCalls(response.content);
  let finalContent = response.content;

  if (toolCalls.length > 0) {
    sendEvent(controller, 'tool_calls_started', { count: toolCalls.length });

    const toolResults = await executeToolCalls(toolCalls, { executionId });

    const toolResultsText = toolResults
      .map(r => `Tool ${r.toolName}: ${r.result.success ? JSON.stringify(r.result.data) : r.result.error}`)
      .join('\n');

    finalContent = `${response.content}\n\n---\nTool Results:\n${toolResultsText}`;

    sendEvent(controller, 'tool_calls_completed', { results: toolResults });
  }

  // Complete phase
  await completePhase(executionId, plan.phases[0].id, { content: finalContent });

  sendEvent(controller, 'phase_completed', {
    phaseId: plan.phases[0].id,
    result: finalContent,
    model: bestModel.name,
    latency: response.latency,
  });
}
