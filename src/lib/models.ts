import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ModelProvider, ModelConfig, ModelResponse } from '@/types';

// Model configurations
export const MODELS: ModelConfig[] = [
  {
    id: 'claude-opus',
    provider: 'claude',
    name: 'Claude Opus 4.5',
    apiModel: 'claude-opus-4-5-20251101',
    strengths: ['code', 'architecture', 'review', 'complex_reasoning'],
    available: true,
  },
  {
    id: 'claude-sonnet',
    provider: 'claude',
    name: 'Claude Sonnet 4.5',
    apiModel: 'claude-sonnet-4-5-20251101',
    strengths: ['fast_code', 'general'],
    available: true,
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    apiModel: 'gpt-4o',
    strengths: ['math', 'stem', 'reasoning'],
    available: true,
  },
  {
    id: 'codex',
    provider: 'openai',
    name: 'GPT-4 Turbo (Codex)',
    apiModel: 'gpt-4-turbo',
    strengths: ['code_review', 'debugging', 'implementation'],
    available: true,
  },
  {
    id: 'gemini-pro',
    provider: 'gemini',
    name: 'Gemini 3 Pro',
    apiModel: 'gemini-3-pro',
    strengths: ['multimodal', 'long_context', 'vision'],
    available: false, // Enable when API key provided
  },
  {
    id: 'qwen-thinking',
    provider: 'qwen',
    name: 'Qwen3-Max-Thinking',
    apiModel: 'qwen3-235b-a22b-thinking-2507',
    strengths: ['math', 'reasoning', 'agentic', 'tool_use'],
    available: false, // Enable when API key provided
  },
];

// API Clients
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

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

// Qwen uses OpenAI-compatible API
export function getQwenClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  });
}

// Generate with specific model
export async function generateWithModel(
  provider: ModelProvider,
  modelId: string,
  prompt: string,
  systemPrompt?: string
): Promise<ModelResponse> {
  const startTime = Date.now();

  try {
    let content = '';
    let thinking: string | undefined;

    switch (provider) {
      case 'claude': {
        const client = getAnthropicClient();
        const response = await client.messages.create({
          model: modelId,
          max_tokens: 4096,
          system: systemPrompt || 'You are a helpful AI assistant.',
          messages: [{ role: 'user', content: prompt }],
        });
        content = response.content[0].type === 'text' ? response.content[0].text : '';
        break;
      }

      case 'openai': {
        const client = getOpenAIClient();
        const response = await client.chat.completions.create({
          model: modelId,
          messages: [
            ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
            { role: 'user', content: prompt },
          ],
          max_tokens: 4096,
        });
        content = response.choices[0]?.message?.content || '';
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
          max_tokens: 4096,
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
        // TODO: Implement Gemini when API key provided
        throw new Error('Gemini not yet implemented');
      }

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    return {
      model: provider,
      modelId,
      content,
      thinking,
      status: 'completed',
      latency: Date.now() - startTime,
    };
  } catch (error) {
    return {
      model: provider,
      modelId,
      content: '',
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      latency: Date.now() - startTime,
    };
  }
}

// Get best model for task type
export function getBestModelForTask(
  taskType: string,
  availableModels: ModelConfig[] = MODELS.filter(m => m.available)
): ModelConfig | null {
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

  for (const model of availableModels) {
    const score = model.strengths.filter(s => requiredStrengths.includes(s)).length;
    if (score > bestScore) {
      bestScore = score;
      bestModel = model;
    }
  }

  return bestModel || availableModels[0] || null;
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
    default:
      return false;
  }
}
