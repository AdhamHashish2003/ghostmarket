// GhostMarket — LLM Failover Chain: Groq → Gemini → NVIDIA NIM
// Logs every call to llm_calls table for training data capture

import Groq from 'groq-sdk';
import { getDb, uuid, withRetry } from './db.js';
import type { LLMTaskType } from './types.js';

interface LLMResponse {
  text: string;
  model_used: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
}

interface LLMCallOptions {
  task_type: LLMTaskType;
  prompt: string;
  system_prompt?: string;
  product_id?: string;
  temperature?: number;
  max_tokens?: number;
}

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GEMINI_MODEL = 'gemini-2.0-flash';
const NIM_MODEL = 'meta/llama-3.3-70b-instruct';

let groqClient: Groq | null = null;

function getGroq(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

async function callGroq(
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  const start = Date.now();
  const groq = getGroq();

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature,
    max_tokens: maxTokens,
  });

  const choice = completion.choices[0];
  return {
    text: choice?.message?.content || '',
    model_used: GROQ_MODEL,
    tokens_in: completion.usage?.prompt_tokens || 0,
    tokens_out: completion.usage?.completion_tokens || 0,
    latency_ms: Date.now() - start,
  };
}

async function callGemini(
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  const start = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Gemini API error: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    text,
    model_used: GEMINI_MODEL,
    tokens_in: data.usageMetadata?.promptTokenCount || 0,
    tokens_out: data.usageMetadata?.candidatesTokenCount || 0,
    latency_ms: Date.now() - start,
  };
}

async function callNIM(
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  const start = Date.now();
  const apiKey = process.env.NIM_API_KEY;
  if (!apiKey) throw new Error('NIM_API_KEY not set');

  const resp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: NIM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    throw new Error(`NIM API error: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  return {
    text: choice?.message?.content || '',
    model_used: NIM_MODEL,
    tokens_in: data.usage?.prompt_tokens || 0,
    tokens_out: data.usage?.completion_tokens || 0,
    latency_ms: Date.now() - start,
  };
}

// Try local Ollama on ROG first if configured
async function callOllama(
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  const start = Date.now();
  const rogUrl = process.env.ROG_WORKER_URL;
  if (!rogUrl) throw new Error('ROG_WORKER_URL not set for Ollama');

  const resp = await fetch(`${rogUrl}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: uuid(),
      prompt,
      system_prompt: systemPrompt,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    throw new Error(`Ollama/ROG error: ${resp.status}`);
  }

  const data = await resp.json() as {
    text?: string;
    model?: string;
    tokens_in?: number;
    tokens_out?: number;
  };
  return {
    text: data.text || '',
    model_used: data.model || 'ghostmarket-local',
    tokens_in: data.tokens_in || 0,
    tokens_out: data.tokens_out || 0,
    latency_ms: Date.now() - start,
  };
}

function logCall(options: LLMCallOptions, response: LLMResponse): void {
  const db = getDb();
  withRetry(() => {
    db.prepare(`
      INSERT INTO llm_calls (id, task_type, model_used, input_prompt, output_text, product_id, tokens_in, tokens_out, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(),
      options.task_type,
      response.model_used,
      options.prompt,
      response.text,
      options.product_id || null,
      response.tokens_in,
      response.tokens_out,
      response.latency_ms,
    );
  });
}

function logFailover(from: string, to: string, error: string): void {
  const db = getDb();
  withRetry(() => {
    db.prepare(`
      INSERT INTO system_events (id, agent, event_type, severity, message, metadata)
      VALUES (?, 'llm', 'failover', 'warning', ?, ?)
    `).run(
      uuid(),
      `LLM failover: ${from} → ${to}: ${error}`,
      JSON.stringify({ from, to, error }),
    );
  });
}

// Failover chain for creative/copy tasks that benefit from fine-tuned local model
async function callWithOllamaFallback(
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  // Try local Ollama first (free, fine-tuned)
  if (process.env.ROG_WORKER_URL && process.env.USE_LOCAL_MODEL === 'true') {
    try {
      return await callOllama(prompt, systemPrompt, temperature, maxTokens);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logFailover('ollama', 'groq', msg);
    }
  }
  // Fall through to standard chain
  return callWithFailover(prompt, systemPrompt, temperature, maxTokens);
}

// Standard failover: Groq → Gemini → NIM
async function callWithFailover(
  prompt: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
  let consecutive429 = 0;

  // Try Groq
  try {
    const result = await callGroq(prompt, systemPrompt, temperature, maxTokens);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('429')) consecutive429++;
    logFailover('groq', 'gemini', msg);
  }

  // Wait if rate limited
  if (consecutive429 > 0) {
    await new Promise((r) => setTimeout(r, 60000));
  }

  // Try Gemini
  try {
    const result = await callGemini(prompt, systemPrompt, temperature, maxTokens);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logFailover('gemini', 'nim', msg);
  }

  // Try NIM — skip if not configured
  if (!process.env.NIM_API_KEY) {
    throw new Error('All LLM providers exhausted (Groq rate-limited, Gemini rate-limited, NIM not configured)');
  }
  return callNIM(prompt, systemPrompt, temperature, maxTokens);
}

export async function llm(options: LLMCallOptions): Promise<LLMResponse> {
  const systemPrompt = options.system_prompt || 'You are a helpful e-commerce analysis assistant. Respond concisely.';
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.max_tokens ?? 2048;

  // Creative tasks try local model first
  const creativeTasks: LLMTaskType[] = [
    'ad_hook', 'brand_naming', 'landing_page_copy',
    'social_caption', 'creative_direction',
  ];

  let response: LLMResponse;
  if (creativeTasks.includes(options.task_type)) {
    response = await callWithOllamaFallback(
      options.prompt, systemPrompt, temperature, maxTokens
    );
  } else {
    response = await callWithFailover(
      options.prompt, systemPrompt, temperature, maxTokens
    );
  }

  logCall(options, response);
  return response;
}

// JSON-mode wrapper — asks LLM to respond in JSON, parses result
export async function llmJSON<T = Record<string, unknown>>(
  options: LLMCallOptions
): Promise<{ parsed: T; raw: LLMResponse }> {
  const modifiedPrompt = options.prompt + '\n\nRespond ONLY with valid JSON. No markdown, no explanation.';
  const response = await llm({ ...options, prompt: modifiedPrompt });

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = response.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr) as T;
  return { parsed, raw: response };
}
