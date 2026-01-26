import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ModelProvider, ModelConfig, ModelResponse } from '@/types';

// Model configurations
export const MODELS: ModelConfig[] = [
  // Claude models
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
    name: 'Claude Sonnet 4',
    apiModel: 'claude-sonnet-4-20250514',
    strengths: ['fast_code', 'general', 'code'],
    available: true,
  },
  // OpenAI models
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    apiModel: 'gpt-4o',
    strengths: ['math', 'stem', 'reasoning', 'multimodal'],
    available: true,
  },
  {
    id: 'gpt-4-turbo',
    provider: 'openai',
    name: 'GPT-4 Turbo',
    apiModel: 'gpt-4-turbo',
    strengths: ['code_review', 'debugging', 'implementation'],
    available: true,
  },
  {
    id: 'o1',
    provider: 'openai',
    name: 'o1 (Reasoning)',
    apiModel: 'o1',
    strengths: ['complex_reasoning', 'math', 'code', 'planning'],
    available: true,
  },
  // Google Gemini models
  {
    id: 'gemini-2-flash',
    provider: 'gemini',
    name: 'Gemini 2.0 Flash',
    apiModel: 'gemini-2.0-flash',
    strengths: ['fast', 'multimodal', 'long_context'],
    available: false,
  },
  {
    id: 'gemini-2-pro',
    provider: 'gemini',
    name: 'Gemini 2.0 Pro',
    apiModel: 'gemini-2.0-pro-exp',
    strengths: ['code', 'reasoning', 'multimodal', 'vision'],
    available: false,
  },
  // Qwen models
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
