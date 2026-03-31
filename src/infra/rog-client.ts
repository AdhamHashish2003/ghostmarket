/**
 * GhostMarket ROG Client
 *
 * Dispatches heavy jobs (QLoRA, scraping, image gen) to the ASUS ROG worker.
 * Falls back gracefully when ROG is offline or ROG_ENABLED=false.
 *
 * Usage:
 *   const rog = getRogClient();
 *   if (rog.isEnabled()) {
 *     await rog.qlora({ jobId, trainingData });
 *   }
 */

import type { IncomingMessage } from 'http';

const ROG_ENABLED = process.env.ROG_ENABLED === 'true';
const ROG_HOST = process.env.ROG_HOST || '192.168.1.100';
const ROG_PORT = process.env.ROG_PORT || '5555';
const ROG_SECRET = process.env.ROG_SECRET || 'ghostmarket-rog-secret';
const ROG_BASE_URL = `http://${ROG_HOST}:${ROG_PORT}`;
const DEFAULT_TIMEOUT_MS = 30_000;  // for fire-and-forget jobs
const HEALTH_TIMEOUT_MS = 5_000;

export interface RogGpuInfo {
  available: boolean;
  device: string;
  vram_total_gb?: number;
  vram_free_gb?: number;
}

export interface RogHealthResult {
  online: boolean;
  gpu: RogGpuInfo;
  jobs: Record<string, { status: string }>;
  python?: string;
  error?: string;
}

export interface QLoRAJobRequest {
  jobId: string;
  trainingData: Array<{ instruction: string; input: string; output: string }>;
  baseModel?: string;
  epochs?: number;
  batchSize?: number;
  loraR?: number;
  loraAlpha?: number;
  learningRate?: number;
}

export interface ScrapeJobRequest {
  jobId: string;
  urls: string[];
  extract?: 'text' | 'html' | 'links' | 'price';
  waitFor?: string;
  timeoutMs?: number;
}

export interface ImageGenJobRequest {
  jobId: string;
  prompts: string[];
  model?: 'sdxl-turbo' | 'flux-schnell';
  width?: number;
  height?: number;
  steps?: number;
  outputFormat?: 'png' | 'base64';
}

export interface JobAccepted {
  jobId: string;
  status: 'accepted';
  dispatched_to: 'rog';
}

// ── HTTP helper ───────────────────────────────────────────────

async function rogFetch(
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${ROG_BASE_URL}${path}`, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Secret': ROG_SECRET,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ROG worker HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── RogClient class ───────────────────────────────────────────

class RogClient {
  isEnabled(): boolean {
    return ROG_ENABLED;
  }

  baseUrl(): string {
    return ROG_BASE_URL;
  }

  // ── Health ────────────────────────────────────────────────

  async health(): Promise<RogHealthResult> {
    try {
      const data = await rogFetch('/health', undefined, HEALTH_TIMEOUT_MS) as RogHealthResult;
      return { online: true, ...data };
    } catch (err) {
      return {
        online: false,
        gpu: { available: false, device: 'unknown' },
        jobs: {},
        error: String(err),
      };
    }
  }

  async ping(): Promise<boolean> {
    const h = await this.health();
    return h.online;
  }

  // ── QLoRA ─────────────────────────────────────────────────

  async qlora(req: QLoRAJobRequest): Promise<JobAccepted> {
    if (!ROG_ENABLED) throw new Error('ROG_ENABLED is false');

    const data = await rogFetch('/qlora', {
      job_id: req.jobId,
      training_data: req.trainingData,
      base_model: req.baseModel,
      epochs: req.epochs ?? 3,
      batch_size: req.batchSize ?? 2,
      lora_r: req.loraR ?? 16,
      lora_alpha: req.loraAlpha ?? 32,
      learning_rate: req.learningRate ?? 2e-4,
      callback_on_complete: true,
    }) as { job_id: string; status: string };

    return { jobId: data.job_id, status: 'accepted', dispatched_to: 'rog' };
  }

  // ── Scrape ────────────────────────────────────────────────

  async scrape(req: ScrapeJobRequest): Promise<JobAccepted> {
    if (!ROG_ENABLED) throw new Error('ROG_ENABLED is false');

    const data = await rogFetch('/scrape', {
      job_id: req.jobId,
      urls: req.urls,
      extract: req.extract ?? 'text',
      wait_for: req.waitFor ?? '',
      timeout_ms: req.timeoutMs ?? 15000,
      callback_on_complete: true,
    }) as { job_id: string; status: string };

    return { jobId: data.job_id, status: 'accepted', dispatched_to: 'rog' };
  }

  // ── Image gen ─────────────────────────────────────────────

  async imagegen(req: ImageGenJobRequest): Promise<JobAccepted> {
    if (!ROG_ENABLED) throw new Error('ROG_ENABLED is false');

    const data = await rogFetch('/imagegen', {
      job_id: req.jobId,
      prompts: req.prompts,
      model: req.model ?? 'sdxl-turbo',
      width: req.width ?? 1024,
      height: req.height ?? 1024,
      steps: req.steps ?? 4,
      output_format: req.outputFormat ?? 'base64',
      callback_on_complete: true,
    }) as { job_id: string; status: string };

    return { jobId: data.job_id, status: 'accepted', dispatched_to: 'rog' };
  }
}

// ── Singleton ─────────────────────────────────────────────────

let _client: RogClient | null = null;

export function getRogClient(): RogClient {
  if (!_client) _client = new RogClient();
  return _client;
}

export default getRogClient;
