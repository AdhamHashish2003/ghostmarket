import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface IntegrationResult {
  name: string;
  status: 'ok' | 'error' | 'disabled';
  message: string;
  latency_ms?: number;
}

async function testGroq(): Promise<IntegrationResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { name: 'Groq', status: 'disabled', message: 'GROQ_API_KEY not set' };
  const start = Date.now();
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { name: 'Groq', status: 'error', message: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`, latency_ms: Date.now() - start };
    return { name: 'Groq', status: 'ok', message: 'Connected', latency_ms: Date.now() - start };
  } catch (e) { return { name: 'Groq', status: 'error', message: String(e).slice(0, 200), latency_ms: Date.now() - start }; }
}

async function testGemini(): Promise<IntegrationResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { name: 'Gemini', status: 'disabled', message: 'GEMINI_API_KEY not set' };
  const start = Date.now();
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }], generationConfig: { maxOutputTokens: 5 } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { name: 'Gemini', status: 'error', message: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`, latency_ms: Date.now() - start };
    return { name: 'Gemini', status: 'ok', message: 'Connected', latency_ms: Date.now() - start };
  } catch (e) { return { name: 'Gemini', status: 'error', message: String(e).slice(0, 200), latency_ms: Date.now() - start }; }
}

async function testNIM(): Promise<IntegrationResult> {
  const key = process.env.NIM_API_KEY;
  if (!key) return { name: 'NVIDIA NIM', status: 'disabled', message: 'NIM_API_KEY not set' };
  const start = Date.now();
  try {
    const resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'meta/llama-3.3-70b-instruct', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { name: 'NVIDIA NIM', status: 'error', message: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`, latency_ms: Date.now() - start };
    return { name: 'NVIDIA NIM', status: 'ok', message: 'Connected', latency_ms: Date.now() - start };
  } catch (e) { return { name: 'NVIDIA NIM', status: 'error', message: String(e).slice(0, 200), latency_ms: Date.now() - start }; }
}

async function testTelegram(): Promise<IntegrationResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { name: 'Telegram', status: 'disabled', message: 'TELEGRAM_BOT_TOKEN not set' };
  const start = Date.now();
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) });
    const data = await resp.json() as { ok: boolean; result?: { username?: string } };
    if (data.ok) return { name: 'Telegram', status: 'ok', message: `Bot: @${data.result?.username}`, latency_ms: Date.now() - start };
    return { name: 'Telegram', status: 'error', message: 'Invalid token', latency_ms: Date.now() - start };
  } catch (e) { return { name: 'Telegram', status: 'error', message: String(e).slice(0, 200), latency_ms: Date.now() - start }; }
}

async function testBuffer(): Promise<IntegrationResult> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token || token.includes('your_')) return { name: 'Buffer', status: 'disabled', message: 'BUFFER_ACCESS_TOKEN not configured' };
  const start = Date.now();
  try {
    const resp = await fetch(`https://api.bufferapp.com/1/user.json?access_token=${token}`, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) return { name: 'Buffer', status: 'ok', message: 'Connected', latency_ms: Date.now() - start };
    return { name: 'Buffer', status: 'error', message: `HTTP ${resp.status}`, latency_ms: Date.now() - start };
  } catch (e) { return { name: 'Buffer', status: 'error', message: String(e).slice(0, 200), latency_ms: Date.now() - start }; }
}

async function testReplicate(): Promise<IntegrationResult> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return { name: 'Replicate', status: 'disabled', message: 'REPLICATE_API_TOKEN not set' };
  const start = Date.now();
  try {
    const resp = await fetch('https://api.replicate.com/v1/account', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) return { name: 'Replicate', status: 'ok', message: 'Connected', latency_ms: Date.now() - start };
    return { name: 'Replicate', status: 'error', message: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`, latency_ms: Date.now() - start };
  } catch (e) { return { name: 'Replicate', status: 'error', message: String(e).slice(0, 200), latency_ms: Date.now() - start }; }
}

async function testVercel(): Promise<IntegrationResult> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { name: 'Vercel', status: 'disabled', message: 'VERCEL_TOKEN not set' };
  const start = Date.now();
  try {
    const resp = await fetch('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) return { name: 'Vercel', status: 'ok', message: 'Connected', latency_ms: Date.now() - start };
    return { name: 'Vercel', status: 'error', message: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`, latency_ms: Date.now() - start };
  } catch (e) { return { name: 'Vercel', status: 'error', message: String(e).slice(0, 200), latency_ms: Date.now() - start }; }
}

async function testReddit(): Promise<IntegrationResult> {
  const start = Date.now();
  try {
    const resp = await fetch('https://www.reddit.com/r/gadgets/hot.json?limit=1', {
      headers: { 'User-Agent': 'ghostmarket:v1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json() as { data?: { children?: unknown[] } };
      const count = data.data?.children?.length || 0;
      return { name: 'Reddit JSON', status: 'ok', message: `Got ${count} posts`, latency_ms: Date.now() - start };
    }
    return { name: 'Reddit JSON', status: 'error', message: `HTTP ${resp.status}`, latency_ms: Date.now() - start };
  } catch (e) { return { name: 'Reddit JSON', status: 'error', message: String(e).slice(0, 200), latency_ms: Date.now() - start }; }
}

async function testROG(): Promise<IntegrationResult> {
  const url = process.env.ROG_WORKER_URL;
  if (!url) return { name: 'ROG Worker', status: 'disabled', message: 'ROG_WORKER_URL not set' };
  const start = Date.now();
  try {
    const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) return { name: 'ROG Worker', status: 'ok', message: 'Reachable', latency_ms: Date.now() - start };
    return { name: 'ROG Worker', status: 'error', message: `HTTP ${resp.status}`, latency_ms: Date.now() - start };
  } catch (e) { return { name: 'ROG Worker', status: 'error', message: `Unreachable: ${String(e).slice(0, 100)}`, latency_ms: Date.now() - start }; }
}

function testSQLite(): IntegrationResult {
  try {
    const db = getDb();
    const tables = db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type IN ('table','view')").get() as { cnt: number };
    const writable = db.prepare("SELECT 1").get();
    return { name: 'SQLite', status: writable ? 'ok' : 'error', message: `${tables.cnt} objects, writable` };
  } catch (e) { return { name: 'SQLite', status: 'error', message: String(e).slice(0, 200) }; }
}

export async function GET() {
  const results = await Promise.all([
    testGroq(), testGemini(), testNIM(), testTelegram(),
    testBuffer(), testReplicate(), testVercel(), testReddit(),
    testROG(),
  ]);
  results.push(testSQLite());
  return NextResponse.json({ results, timestamp: new Date().toISOString() });
}
