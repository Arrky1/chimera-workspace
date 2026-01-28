/**
 * Upstash Redis client for persistent storage
 *
 * Used for: vision context, chat summaries, session data
 * Falls back gracefully if Redis is not configured
 */

import { Redis } from '@upstash/redis';

// Keys
const KEYS = {
  vision: 'chimera:vision',
  chatSummary: (sessionId: string) => `chimera:summary:${sessionId}`,
  chatHistory: (sessionId: string) => `chimera:history:${sessionId}`,
} as const;

// Initialize Redis client (lazy, only when env vars exist)
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.log('[Redis] Not configured — using in-memory fallback');
    return null;
  }

  redis = new Redis({ url, token });
  console.log('[Redis] Connected to Upstash');
  return redis;
}

// =============================================================================
// Vision Context
// =============================================================================

export async function getVisionFromRedis(): Promise<string> {
  const r = getRedis();
  if (!r) return '';

  try {
    const vision = await r.get<string>(KEYS.vision);
    return vision || '';
  } catch (error) {
    console.error('[Redis] Failed to get vision:', error);
    return '';
  }
}

export async function setVisionInRedis(text: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;

  try {
    await r.set(KEYS.vision, text.slice(0, 5000));
    return true;
  } catch (error) {
    console.error('[Redis] Failed to set vision:', error);
    return false;
  }
}

// =============================================================================
// Chat Summary
// =============================================================================

export async function getSummaryFromRedis(sessionId: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    return await r.get<string>(KEYS.chatSummary(sessionId));
  } catch (error) {
    console.error('[Redis] Failed to get summary:', error);
    return null;
  }
}

export async function setSummaryInRedis(sessionId: string, summary: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;

  try {
    // Expire after 7 days of inactivity
    await r.set(KEYS.chatSummary(sessionId), summary, { ex: 60 * 60 * 24 * 7 });
    return true;
  } catch (error) {
    console.error('[Redis] Failed to set summary:', error);
    return false;
  }
}

// =============================================================================
// Chat History (optional — for cross-device sync)
// =============================================================================

export interface StoredMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export async function getHistoryFromRedis(sessionId: string): Promise<StoredMessage[]> {
  const r = getRedis();
  if (!r) return [];

  try {
    const history = await r.get<StoredMessage[]>(KEYS.chatHistory(sessionId));
    return history || [];
  } catch (error) {
    console.error('[Redis] Failed to get history:', error);
    return [];
  }
}

export async function setHistoryInRedis(sessionId: string, messages: StoredMessage[]): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;

  try {
    // Keep last 100 messages, expire after 7 days
    const trimmed = messages.slice(-100);
    await r.set(KEYS.chatHistory(sessionId), trimmed, { ex: 60 * 60 * 24 * 7 });
    return true;
  } catch (error) {
    console.error('[Redis] Failed to set history:', error);
    return false;
  }
}

// =============================================================================
// Health check
// =============================================================================

export async function isRedisAvailable(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;

  try {
    await r.ping();
    return true;
  } catch {
    return false;
  }
}
