/**
 * JSON Schemas for Chimera - Strict validation for deterministic execution
 *
 * Using Zod for:
 * - Runtime validation
 * - Type inference
 * - Error messages
 * - Repair layer (coercion)
 */

import { z } from 'zod';

// =============================================================================
// Base Types
// =============================================================================

export const ModelProviderSchema = z.enum([
  'claude',
  'openai',
  'gemini',
  'qwen',
  'grok',
  'deepseek',
]);

export const ExecutionModeSchema = z.enum([
  'single',
  'council',
  'swarm',
  'deliberation',
  'debate',
]);

// =============================================================================
// Intent Schemas
// =============================================================================

export const ParsedIntentSchema = z.object({
  action: z.enum(['create', 'modify', 'delete', 'fix', 'explain', 'analyze']),
  object: z.string().min(1, 'Object cannot be empty'),
  scope: z.enum(['minimal', 'moderate', 'full']).optional(),
  constraints: z.array(z.string()).optional(),
  priorities: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

// =============================================================================
// Ambiguity Schemas
// =============================================================================

export const AmbiguitySchema = z.object({
  type: z.enum(['reference', 'scope', 'technical', 'priority', 'context']),
  term: z.string(),
  question: z.string(),
  candidates: z.array(z.string()),
  severity: z.enum(['low', 'medium', 'high']),
});

export type Ambiguity = z.infer<typeof AmbiguitySchema>;

export const AmbiguityReportSchema = z.object({
  ambiguities: z.array(AmbiguitySchema),
  overallClarity: z.number().min(0).max(1),
  requiresClarification: z.boolean(),
});

export type AmbiguityReport = z.infer<typeof AmbiguityReportSchema>;

// =============================================================================
// Execution Plan Schemas
// =============================================================================

export const PhaseResultSchema = z.object({
  output: z.string(),
  votes: z.record(z.string()).optional(), // Record<ModelProvider, string> - optional field
  winner: z.string().optional(),
  iterations: z.number().optional(),
});

export const ExecutionPhaseSchema = z.object({
  id: z.string().min(1),
  mode: ExecutionModeSchema,
  name: z.string().min(1),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  models: z.array(ModelProviderSchema),
  progress: z.number().min(0).max(100),
  result: PhaseResultSchema.optional(),
});

export type ExecutionPhase = z.infer<typeof ExecutionPhaseSchema>;

export const ExecutionPlanSchema = z.object({
  id: z.string().min(1),
  originalMessage: z.string().min(1, 'Original message is required'),
  phases: z.array(ExecutionPhaseSchema).min(1, 'At least one phase is required'),
  estimatedModels: z.number().min(1),
  currentPhase: z.number().min(0),
  status: z.enum(['planning', 'awaiting_confirmation', 'executing', 'completed', 'failed']),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// =============================================================================
// Task Classification Schemas
// =============================================================================

export const TaskClassificationSchema = z.object({
  complexity: z.enum(['simple', 'moderate', 'complex']),
  recommendedMode: ExecutionModeSchema,
  estimatedSubtasks: z.number().min(1),
  needsArchitecture: z.boolean(),
  reasoning: z.string().optional(),
});

export type TaskClassification = z.infer<typeof TaskClassificationSchema>;

// =============================================================================
// Council/Debate Schemas
// =============================================================================

export const CouncilVoteSchema = z.object({
  model: ModelProviderSchema,
  vote: z.string().min(1),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export type CouncilVote = z.infer<typeof CouncilVoteSchema>;

export const CouncilResultSchema = z.object({
  votes: z.array(CouncilVoteSchema),
  consensus: z.number().min(0).max(1),
  synthesizedAnswer: z.string(),
});

export type CouncilResult = z.infer<typeof CouncilResultSchema>;

export const DebateArgumentSchema = z.object({
  model: ModelProviderSchema,
  position: z.enum(['pro', 'con']),
  argument: z.string().min(1),
  round: z.number().min(1),
});

export type DebateArgument = z.infer<typeof DebateArgumentSchema>;

export const DebateResultSchema = z.object({
  arguments: z.array(DebateArgumentSchema),
  verdict: z.enum(['PRO', 'CON']),
  reasoning: z.string(),
});

export type DebateResult = z.infer<typeof DebateResultSchema>;

// =============================================================================
// API Request/Response Schemas
// =============================================================================

export const ChatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.number().optional(),
});

export type ChatHistoryMessage = z.infer<typeof ChatHistoryMessageSchema>;

export const OrchestrateRequestSchema = z.object({
  message: z.string().min(1, 'Message is required').optional(),
  history: z.array(ChatHistoryMessageSchema).optional(), // История диалога
  sessionId: z.string().optional(), // ID сессии для разделения историй
  clarificationAnswers: z.record(z.string(), z.string()).optional(),
  confirmedPlan: ExecutionPlanSchema.optional(),
  idempotencyKey: z.string().optional(),
  executionId: z.string().optional(), // For resuming
}).refine(
  (data) => data.message || data.confirmedPlan || data.executionId,
  { message: 'Either message, confirmedPlan, or executionId is required' }
);

export type OrchestrateRequest = z.infer<typeof OrchestrateRequestSchema>;

export const OrchestrateResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('clarification'),
    message: z.string(),
    clarification: z.object({
      questions: z.array(z.object({
        id: z.string(),
        question: z.string(),
        type: z.string(),
        options: z.array(z.object({
          value: z.string(),
          label: z.string(),
          description: z.string().optional(),
          recommended: z.boolean().optional(),
        })),
        allowCustom: z.boolean(),
        default: z.string().optional(),
      })),
      context: z.string(),
    }),
    intent: ParsedIntentSchema,
    executionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('plan'),
    message: z.string(),
    plan: ExecutionPlanSchema,
    classification: TaskClassificationSchema,
    requiresConfirmation: z.boolean(),
    executionId: z.string(),
  }),
  z.object({
    type: z.literal('result'),
    message: z.string(),
    plan: ExecutionPlanSchema,
    modelUsed: z.string(),
    latency: z.number(),
    toolsUsed: z.array(z.string()).optional(),
    executionId: z.string(),
  }),
  z.object({
    type: z.literal('execution_complete'),
    plan: ExecutionPlanSchema,
    results: z.array(z.object({
      phase: z.string(),
      result: z.unknown(),
    })),
    executionId: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    details: z.string().optional(),
    executionId: z.string().optional(),
  }),
]);

export type OrchestrateResponse = z.infer<typeof OrchestrateResponseSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate and parse with detailed errors
 */
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Validation failed: ${errors}`);
  }
  return result.data;
}

/**
 * Validate with repair attempt (coercion)
 */
export function validateWithRepair<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  defaults?: Partial<T>
): { success: true; data: T } | { success: false; errors: string[] } {
  // First try direct validation
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  // Try with defaults merged
  if (defaults && typeof data === 'object' && data !== null) {
    const merged = { ...defaults, ...data };
    const retryResult = schema.safeParse(merged);
    if (retryResult.success) {
      return { success: true, data: retryResult.data };
    }
  }

  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * Parse LLM response to structured format with fallback
 */
export function parseLLMResponse<T>(
  content: string,
  schema: z.ZodSchema<T>,
  fallbackExtractor?: (content: string) => Partial<T>
): T | null {
  // Try JSON extraction first
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                    content.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      const result = schema.safeParse(json);
      if (result.success) {
        return result.data;
      }
    } catch {
      // JSON parse failed, try fallback
    }
  }

  // Try fallback extractor
  if (fallbackExtractor) {
    const extracted = fallbackExtractor(content);
    const result = schema.safeParse(extracted);
    if (result.success) {
      return result.data;
    }
  }

  return null;
}

// =============================================================================
// Intent Parser Helper
// =============================================================================

/**
 * Extract intent from LLM response with fallback parsing
 */
export function parseIntentResponse(content: string): ParsedIntent | null {
  return parseLLMResponse(content, ParsedIntentSchema, (text) => {
    // Fallback extraction from text patterns
    const actionMatch = text.match(/action[:\s]*(create|modify|delete|fix|explain|analyze)/i);
    const objectMatch = text.match(/object[:\s]*([^\n,]+)/i);
    const confidenceMatch = text.match(/confidence[:\s]*([0-9.]+)/i);

    return {
      action: (actionMatch?.[1]?.toLowerCase() as ParsedIntent['action']) || 'create',
      object: objectMatch?.[1]?.trim() || 'unknown',
      confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
    };
  });
}

/**
 * Extract classification from LLM response
 */
export function parseClassificationResponse(content: string): TaskClassification | null {
  return parseLLMResponse(content, TaskClassificationSchema, (text) => {
    const complexityMatch = text.match(/complexity[:\s]*(simple|moderate|complex)/i);
    const modeMatch = text.match(/mode[:\s]*(single|council|swarm|deliberation|debate)/i);
    const subtasksMatch = text.match(/subtasks?[:\s]*(\d+)/i);
    const architectureMatch = text.match(/architecture[:\s]*(yes|no|true|false)/i);

    return {
      complexity: (complexityMatch?.[1]?.toLowerCase() as TaskClassification['complexity']) || 'simple',
      recommendedMode: (modeMatch?.[1]?.toLowerCase() as TaskClassification['recommendedMode']) || 'single',
      estimatedSubtasks: subtasksMatch ? parseInt(subtasksMatch[1]) : 1,
      needsArchitecture: architectureMatch ?
        ['yes', 'true'].includes(architectureMatch[1].toLowerCase()) : false,
    };
  });
}
