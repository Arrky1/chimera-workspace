import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ModelProvider, ModelConfig, ModelResponse } from '@/types';

// Timeout configuration
const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds default
const PROVIDER_TIMEOUTS: Record<ModelProvider, number> = {
  claude: 90000,    // Claude can be slower for complex tasks
  openai: 60000,
  gemini: 45000,    // Gemini is usually fast
  qwen: 120000,     // Qwen thinking models can take longer
  grok: 60000,
  deepseek: 120000, // DeepSeek R1 reasoning takes time
};

// Provider health tracking
interface ProviderHealth {
  lastSuccess: number;
  lastError: number;
  consecutiveFailures: number;
  isHealthy: boolean;
  errorMessage?: string;
}

const providerHealth: Map<ModelProvider, ProviderHealth> = new Map();

// Initialize provider health
function initProviderHealth(provider: ModelProvider): ProviderHealth {
  return {
    lastSuccess: 0,
    lastError: 0,
    consecutiveFailures: 0,
    isHealthy: true,
  };
}

// Update provider health on success
function markProviderSuccess(provider: ModelProvider): void {
  const health = providerHealth.get(provider) || initProviderHealth(provider);
  health.lastSuccess = Date.now();
  health.consecutiveFailures = 0;
  health.isHealthy = true;
  health.errorMessage = undefined;
  providerHealth.set(provider, health);
}

// Update provider health on failure
function markProviderFailure(provider: ModelProvider, error: string): void {
  const health = providerHealth.get(provider) || initProviderHealth(provider);
  health.lastError = Date.now();
  health.consecutiveFailures++;
  health.errorMessage = error;
  // Mark unhealthy after 5 consecutive failures (более мягкий порог)
  if (health.consecutiveFailures >= 5) {
    health.isHealthy = false;
    console.log(`[Health] ${provider} marked UNHEALTHY after ${health.consecutiveFailures} failures: ${error}`);
  }
  providerHealth.set(provider, health);
}

// Get provider health status
export function getProviderHealth(provider: ModelProvider): ProviderHealth {
  return providerHealth.get(provider) || initProviderHealth(provider);
}

// Get all providers health
export function getAllProvidersHealth(): Record<ModelProvider, ProviderHealth> {
  const providers: ModelProvider[] = ['claude', 'openai', 'gemini', 'qwen', 'grok', 'deepseek'];
  const result: Record<string, ProviderHealth> = {};
  for (const provider of providers) {
    result[provider] = getProviderHealth(provider);
  }
  return result as Record<ModelProvider, ProviderHealth>;
}

// Timeout helper with AbortController
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, provider: ModelProvider): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Request to ${provider} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then(result => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

// User-friendly error messages
function formatErrorMessage(provider: ModelProvider, error: Error): string {
  const message = error.message.toLowerCase();

  if (message.includes('timeout')) {
    return `${provider} is taking too long to respond. Try again or use a different model.`;
  }
  if (message.includes('401') || message.includes('unauthorized')) {
    return `Invalid API key for ${provider}. Please check your credentials.`;
  }
  if (message.includes('403') || message.includes('forbidden')) {
    return `Access denied for ${provider}. Your account may not have access to this model.`;
  }
  if (message.includes('429') || message.includes('rate limit')) {
    return `${provider} rate limit reached. Please wait a moment before trying again.`;
  }
  if (message.includes('500') || message.includes('502') || message.includes('503')) {
    return `${provider} is experiencing issues. Try again later or use a different provider.`;
  }
  if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
    return `Cannot connect to ${provider}. Check your internet connection.`;
  }
  if (message.includes('context') || message.includes('token')) {
    return `Message too long for ${provider}. Try a shorter request.`;
  }

  return `${provider} error: ${error.message}`;
}

// Model configurations - Updated January 2026
// NOTE: `available` is computed dynamically by getAvailableModels() based on env API keys.
// Do NOT set static `available` values here — all are treated as potentially available.
export const MODELS: ModelConfig[] = [
  // Claude models (Anthropic)
  {
    id: 'claude-opus-4.5',
    provider: 'claude',
    name: 'Claude Opus 4.5',
    apiModel: 'claude-opus-4-5-20251101',
    strengths: ['code', 'architecture', 'review', 'complex_reasoning', 'writing'],
    available: false, // dynamic — set by getAvailableModels()
  },
  {
    id: 'claude-sonnet-4.5',
    provider: 'claude',
    name: 'Claude Sonnet 4.5',
    apiModel: 'claude-sonnet-4-5-20251101',
    strengths: ['fast_code', 'general', 'code', 'agentic'],
    available: false,
  },
  // OpenAI models
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    apiModel: 'gpt-4o',
    strengths: ['complex_reasoning', 'code', 'architecture', 'multimodal'],
    available: false,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    apiModel: 'gpt-4o-mini',
    strengths: ['fast', 'code', 'general'],
    available: false,
  },
  {
    id: 'o3',
    provider: 'openai',
    name: 'o3 (Reasoning)',
    apiModel: 'o3',
    strengths: ['complex_reasoning', 'math', 'code', 'planning'],
    available: false,
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    name: 'o4-mini (Fast Reasoning)',
    apiModel: 'o4-mini',
    strengths: ['fast', 'reasoning', 'code'],
    available: false,
  },
  // Google Gemini models (stable IDs — January 2026)
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    name: 'Gemini 2.5 Pro',
    apiModel: 'gemini-2.5-pro',
    strengths: ['fast', 'multimodal', 'long_context', 'code', 'reasoning'],
    available: false,
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    name: 'Gemini 2.5 Flash',
    apiModel: 'gemini-2.5-flash',
    strengths: ['fast', 'multimodal', 'value'],
    available: false,
  },
  // Qwen models (Alibaba)
  {
    id: 'qwen-thinking',
    provider: 'qwen',
    name: 'Qwen3-Max-Thinking',
    apiModel: 'qwen3-235b-a22b-thinking-2507',
    strengths: ['math', 'reasoning', 'agentic', 'tool_use'],
    available: false,
  },
  {
    id: 'qwen-coder',
    provider: 'qwen',
    name: 'Qwen2.5-Coder-32B',
    apiModel: 'qwen2.5-coder-32b-instruct',
    strengths: ['code', 'fast_code', 'debugging'],
    available: false,
  },
  // xAI Grok models
  {
    id: 'grok-3',
    provider: 'grok',
    name: 'Grok 3',
    apiModel: 'grok-3',
    strengths: ['reasoning', 'code', 'agentic', 'tool_use'],
    available: false,
  },
  {
    id: 'grok-3-fast',
    provider: 'grok',
    name: 'Grok 3 Fast',
    apiModel: 'grok-3-fast',
    strengths: ['fast', 'agentic', 'tool_use'],
    available: false,
  },
  // DeepSeek models
  {
    id: 'deepseek-r1',
    provider: 'deepseek',
    name: 'DeepSeek R1',
    apiModel: 'deepseek-reasoner',
    strengths: ['reasoning', 'math', 'code', 'open_source'],
    available: false,
  },
  {
    id: 'deepseek-chat',
    provider: 'deepseek',
    name: 'DeepSeek V3',
    apiModel: 'deepseek-chat',
    strengths: ['code', 'fast_code', 'general'],
    available: false,
  },
];

// API Clients
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let geminiClient: GoogleGenerativeAI | null = null;

export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');
  }
  return geminiClient;
}

// Qwen uses OpenAI-compatible API
export function getQwenClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  });
}

// Grok (xAI) uses OpenAI-compatible API
export function getGrokClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  });
}

// DeepSeek uses OpenAI-compatible API
export function getDeepSeekClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
  });
}

// Generate with specific model (with timeout and health tracking)
export async function generateWithModel(
  provider: ModelProvider,
  modelId: string,
  prompt: string,
  systemPrompt?: string,
  options?: { timeout?: number; skipHealthCheck?: boolean; maxTokens?: number }
): Promise<ModelResponse> {
  const startTime = Date.now();
  const timeout = options?.timeout || PROVIDER_TIMEOUTS[provider] || DEFAULT_TIMEOUT_MS;
  const maxTokens = options?.maxTokens || 4096;

  console.log(`[Model] Calling ${provider}/${modelId} (maxTokens=${maxTokens}, timeout=${timeout}ms)`);

  // Check provider health (skip if explicitly told to)
  if (!options?.skipHealthCheck) {
    const health = getProviderHealth(provider);
    if (!health.isHealthy) {
      // Provider is unhealthy, but allow retry after 1 minute
      const timeSinceLastError = Date.now() - health.lastError;
      if (timeSinceLastError < 60 * 1000) {
        console.log(`[Model] ${provider} blocked by health check (${health.consecutiveFailures} failures, ${Math.round(timeSinceLastError / 1000)}s ago)`);
        return {
          model: provider,
          modelId,
          content: '',
          status: 'error',
          error: `${provider} is temporarily unavailable (${health.consecutiveFailures} consecutive failures). Last error: ${health.errorMessage}`,
          latency: Date.now() - startTime,
        };
      }
      // Reset health after cooldown — give it another chance
      console.log(`[Model] ${provider} cooldown expired, resetting health`);
      markProviderSuccess(provider);
    }
  }

  try {
    let content = '';
    let thinking: string | undefined;

    const generateContent = async (): Promise<void> => {
      switch (provider) {
        case 'claude': {
          const client = getAnthropicClient();
          const response = await client.messages.create({
            model: modelId,
            max_tokens: maxTokens,
            system: systemPrompt || 'You are a helpful AI assistant.',
            messages: [{ role: 'user', content: prompt }],
          });
          content = response.content[0].type === 'text' ? response.content[0].text : '';
          break;
        }

        case 'openai': {
          const client = getOpenAIClient();
          // Reasoning models (o3, o4-mini) не поддерживают max_tokens и system role
          const isReasoningModel = modelId.startsWith('o3') || modelId.startsWith('o4');

          if (isReasoningModel) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const response = await (client.chat.completions.create as any)({
              model: modelId,
              messages: [
                { role: 'user', content: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt },
              ],
              max_completion_tokens: maxTokens,
            });
            content = response.choices[0]?.message?.content || '';
          } else {
            const response = await client.chat.completions.create({
              model: modelId,
              messages: [
                ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
                { role: 'user' as const, content: prompt },
              ],
              max_tokens: maxTokens,
            });
            content = response.choices[0]?.message?.content || '';
          }
          break;
        }

        case 'qwen': {
          const client = getQwenClient();
          const response = await client.chat.completions.create({
            model: modelId,
            messages: [
              ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            max_tokens: maxTokens,
          });
          content = response.choices[0]?.message?.content || '';

          // Extract thinking if present
          if (content.includes('<think>') && content.includes('</think>')) {
            const thinkStart = content.indexOf('<think>') + 7;
            const thinkEnd = content.indexOf('</think>');
            thinking = content.substring(thinkStart, thinkEnd).trim();
            content = content.substring(thinkEnd + 8).trim();
          }
          break;
        }

        case 'gemini': {
          const client = getGeminiClient();
          const model = client.getGenerativeModel({ model: modelId });

          const chat = model.startChat({
            history: systemPrompt ? [
              { role: 'user', parts: [{ text: `System instruction: ${systemPrompt}` }] },
              { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
            ] : [],
          });

          const result = await chat.sendMessage(prompt);
          content = result.response.text();
          break;
        }

        case 'grok': {
          const client = getGrokClient();
          const response = await client.chat.completions.create({
            model: modelId,
            messages: [
              ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            max_tokens: maxTokens,
          });
          content = response.choices[0]?.message?.content || '';
          break;
        }

        case 'deepseek': {
          const client = getDeepSeekClient();
          const response = await client.chat.completions.create({
            model: modelId,
            messages: [
              ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            max_tokens: maxTokens,
          });
          content = response.choices[0]?.message?.content || '';

          // Extract thinking if present (DeepSeek R1 uses reasoning tokens)
          if (content.includes('<think>') && content.includes('</think>')) {
            const thinkStart = content.indexOf('<think>') + 7;
            const thinkEnd = content.indexOf('</think>');
            thinking = content.substring(thinkStart, thinkEnd).trim();
            content = content.substring(thinkEnd + 8).trim();
          }
          break;
        }

        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    };

    // Execute with timeout
    await withTimeout(generateContent(), timeout, provider);

    // Mark provider as healthy
    markProviderSuccess(provider);

    const latency = Date.now() - startTime;
    console.log(`[Model] ✅ ${provider}/${modelId} completed in ${latency}ms (${content.length} chars)`);

    return {
      model: provider,
      modelId,
      content,
      thinking,
      status: 'completed',
      latency,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[Model] ❌ ${provider}/${modelId} FAILED: ${err.message}`);

    // Mark provider failure
    markProviderFailure(provider, err.message);

    return {
      model: provider,
      modelId,
      content: '',
      status: 'error',
      error: formatErrorMessage(provider, err),
      latency: Date.now() - startTime,
    };
  }
}

// Generate with fallback to other providers
export async function generateWithFallback(
  preferredProvider: ModelProvider,
  preferredModelId: string,
  prompt: string,
  systemPrompt?: string,
  fallbackProviders?: ModelProvider[]
): Promise<ModelResponse & { usedFallback?: boolean; originalProvider?: ModelProvider }> {
  // Try preferred provider first
  const result = await generateWithModel(preferredProvider, preferredModelId, prompt, systemPrompt);

  if (result.status === 'completed') {
    return result;
  }

  // If failed, try fallbacks
  const availableModels = getAvailableModels().filter(m => m.available);
  const fallbacks = fallbackProviders || ['claude', 'openai', 'deepseek', 'qwen'] as ModelProvider[];

  for (const fallbackProvider of fallbacks) {
    if (fallbackProvider === preferredProvider) continue;

    const fallbackModel = availableModels.find(m => m.provider === fallbackProvider);
    if (!fallbackModel) continue;

    const health = getProviderHealth(fallbackProvider);
    if (!health.isHealthy) continue;

    console.log(`Falling back from ${preferredProvider} to ${fallbackProvider}`);

    const fallbackResult = await generateWithModel(
      fallbackProvider,
      fallbackModel.apiModel,
      prompt,
      systemPrompt
    );

    if (fallbackResult.status === 'completed') {
      return {
        ...fallbackResult,
        usedFallback: true,
        originalProvider: preferredProvider,
      };
    }
  }

  // All fallbacks failed, return original error
  return result;
}

// Get best model for task type
// IMPORTANT: always pass getAvailableModels().filter(m => m.available) or use default
export function getBestModelForTask(
  taskType: string,
  availableModels?: ModelConfig[]
): ModelConfig | null {
  // Always use dynamic availability check, never static MODELS array
  const models = availableModels ?? getAvailableModels().filter(m => m.available);
  if (models.length === 0) return null;
  const taskStrengthMap: Record<string, string[]> = {
    code: ['code', 'architecture'],
    math: ['math', 'reasoning'],
    review: ['code_review', 'debugging'],
    multimodal: ['multimodal', 'vision'],
    reasoning: ['reasoning', 'complex_reasoning'],
    fast: ['fast_code', 'general'],
  };

  const requiredStrengths = taskStrengthMap[taskType] || [];

  // Find model with most matching strengths
  let bestModel: ModelConfig | null = null;
  let bestScore = 0;

  for (const model of models) {
    const score = model.strengths.filter(s => requiredStrengths.includes(s)).length;
    if (score > bestScore) {
      bestScore = score;
      bestModel = model;
    }
  }

  return bestModel || models[0] || null;
}

// Get available models
export function getAvailableModels(): ModelConfig[] {
  return MODELS.map(model => ({
    ...model,
    available: isModelAvailable(model.provider),
  }));
}

function isModelAvailable(provider: ModelProvider): boolean {
  switch (provider) {
    case 'claude':
      return !!process.env.ANTHROPIC_API_KEY;
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'gemini':
      return !!process.env.GOOGLE_AI_API_KEY;
    case 'qwen':
      return !!process.env.QWEN_API_KEY;
    case 'grok':
      return !!process.env.XAI_API_KEY;
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY;
    default:
      return false;
  }
}
