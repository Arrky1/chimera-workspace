import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ModelProvider, ModelConfig, ModelResponse } from '@/types';

// Model configurations - Updated January 2026
export const MODELS: ModelConfig[] = [
  // Claude models (Anthropic)
  {
    id: 'claude-opus-4.5',
    provider: 'claude',
    name: 'Claude Opus 4.5',
    apiModel: 'claude-opus-4-5-20251101',
    strengths: ['code', 'architecture', 'review', 'complex_reasoning', 'writing'],
    available: true,
  },
  {
    id: 'claude-sonnet-4.5',
    provider: 'claude',
    name: 'Claude Sonnet 4.5',
    apiModel: 'claude-sonnet-4-5-20251101',
    strengths: ['fast_code', 'general', 'code', 'agentic'],
    available: true,
  },
  // OpenAI models
  {
    id: 'gpt-5.2',
    provider: 'openai',
    name: 'GPT-5.2',
    apiModel: 'gpt-5.2',
    strengths: ['complex_reasoning', 'math', 'code', 'architecture'],
    available: true,
  },
  {
    id: 'gpt-5.2-pro',
    provider: 'openai',
    name: 'GPT-5.2 Pro',
    apiModel: 'gpt-5.2-pro',
    strengths: ['complex_reasoning', 'math', 'code', 'planning', 'architecture'],
    available: true,
  },
  {
    id: 'o3',
    provider: 'openai',
    name: 'o3 (Reasoning)',
    apiModel: 'o3',
    strengths: ['complex_reasoning', 'math', 'code', 'planning'],
    available: true,
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    name: 'o4-mini (Fast Reasoning)',
    apiModel: 'o4-mini',
    strengths: ['fast', 'reasoning', 'code'],
    available: true,
  },
  // Google Gemini models
  {
    id: 'gemini-3-pro',
    provider: 'gemini',
    name: 'Gemini 3 Pro',
    apiModel: 'gemini-3-pro',
    strengths: ['fast', 'multimodal', 'long_context', 'code', 'reasoning'],
    available: false,
  },
  {
    id: 'gemini-3-flash',
    provider: 'gemini',
    name: 'Gemini 3 Flash',
    apiModel: 'gemini-3-flash',
    strengths: ['fast', 'multimodal', 'value'],
    available: false,
  },
  {
    id: 'gemini-2.5-deep-think',
    provider: 'gemini',
    name: 'Gemini 2.5 Deep Think',
    apiModel: 'gemini-2.5-deep-think',
    strengths: ['complex_reasoning', 'math', 'planning'],
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
    id: 'grok-4.1',
    provider: 'grok',
    name: 'Grok 4.1',
    apiModel: 'grok-4-1',
    strengths: ['reasoning', 'code', 'agentic', 'tool_use'],
    available: false,
  },
  {
    id: 'grok-4.1-fast',
    provider: 'grok',
    name: 'Grok 4.1 Fast',
    apiModel: 'grok-4-1-fast',
    strengths: ['fast', 'agentic', 'tool_use'],
    available: false,
  },
  // DeepSeek models
  {
    id: 'deepseek-r1',
    provider: 'deepseek',
    name: 'DeepSeek R1',
    apiModel: 'deepseek-r1',
    strengths: ['reasoning', 'math', 'code', 'open_source'],
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

      case 'grok': {
        const client = getGrokClient();
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

      case 'deepseek': {
        const client = getDeepSeekClient();
        const response = await client.chat.completions.create({
          model: modelId,
          messages: [
            ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
            { role: 'user', content: prompt },
          ],
          max_tokens: 4096,
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
    case 'grok':
      return !!process.env.XAI_API_KEY;
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY;
    default:
      return false;
  }
}
