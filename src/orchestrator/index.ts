// GhostMarket — Orchestrator
// Event bus, cron scheduler, agent coordination, health monitoring
// Runs on the PC, coordinates all agents across both machines

import express from 'express';
import cron from 'node-cron';
import { getDb, uuid, nowISO, withRetry } from '../shared/db.js';
import type { ROGWorkerResult, AgentEvent } from '../shared/types.js';
import { EventEmitter } from 'events';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT) || 4000;
const ROG_WORKER_URL = process.env.ROG_WORKER_URL || 'http://localhost:8500';

// Internal event bus for same-machine agent coordination
const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

// ============================================================
// State
// ============================================================

let paused = false;
let dailyBudget = 0;
let telegramProductsToday = 0;

function resetDailyCounts(): void {
  telegramProductsToday = 0;
}

// ============================================================
// ROG Worker Communication
// ============================================================

async function sendToROG(endpoint: string, payload: Record<string, unknown>): Promise<Response> {
  const resp = await fetch(`${ROG_WORKER_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      callback_url: `http://${process.env.HOSTNAME || 'localhost'}:${PORT}/callback`,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    throw new Error(`ROG worker ${endpoint} error: ${resp.status}`);
  }
  return resp;
}

// ============================================================
// Callback endpoint — ROG sends results here
// ============================================================

app.post('/callback', (req, res) => {
  const result = req.body as ROGWorkerResult;
  console.log(`[Callback] job=${result.job_id} type=${result.job_type} success=${result.success}`);
  eventBus.emit(`job:${result.job_id}`, result);
  eventBus.emit(`type:${result.job_type}`, result);
  res.json({ received: true });
});

// ============================================================
// Health & Status endpoints
// ============================================================

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', paused, dailyBudget, telegramProductsToday });
});

app.get('/status', (_req, res) => {
  const db = getDb();
  const stages = db.prepare(`
    SELECT stage, COUNT(*) as count FROM products GROUP BY stage
  `).all() as Array<{ stage: string; count: number }>;

  const recentEvents = db.prepare(`
    SELECT agent, event_type, severity, message, created_at
    FROM system_events ORDER BY created_at DESC LIMIT 20
  `).all();

  res.json({ paused, stages, recentEvents });
});

// ============================================================
// Agent trigger endpoints (called by Telegram bot or cron)
// ============================================================

app.post('/trigger/score', async (_req, res) => {
  if (paused) { res.json({ skipped: 'paused' }); return; }
  eventBus.emit('agent:score');
  res.json({ triggered: 'scorer' });
});

app.post('/trigger/build', (req, res) => {
  if (paused) { res.json({ skipped: 'paused' }); return; }
  const { product_id } = req.body as { product_id: string };
  eventBus.emit('agent:build', product_id);
  res.json({ triggered: 'builder', product_id });
});

app.post('/trigger/deploy', (req, res) => {
  if (paused) { res.json({ skipped: 'paused' }); return; }
  const { product_id } = req.body as { product_id: string };
  eventBus.emit('agent:deploy', product_id);
  res.json({ triggered: 'deployer', product_id });
});

app.post('/trigger/learn', (_req, res) => {
  eventBus.emit('agent:learn');
  res.json({ triggered: 'learner' });
});

// Control endpoints
app.post('/control/pause', (_req, res) => { paused = true; res.json({ paused }); });
app.post('/control/resume', (_req, res) => { paused = false; res.json({ paused }); });
app.post('/control/budget', (req, res) => {
  dailyBudget = (req.body as { amount: number }).amount;
  res.json({ dailyBudget });
});

// ============================================================
// Cron Schedules (staggered — not all at once)
// ============================================================

function setupCron(): void {
  // Scout light: pytrends every 2 hours, Reddit every 30 min
  cron.schedule('0 */2 * * *', () => {
    if (paused) return;
    logEvent('orchestrator', 'health_check', 'info', 'Triggering scout-light: google_trends');
    eventBus.emit('agent:scout:google_trends');
  });

  cron.schedule('*/30 * * * *', () => {
    if (paused) return;
    logEvent('orchestrator', 'health_check', 'info', 'Triggering scout-light: reddit');
    eventBus.emit('agent:scout:reddit');
  });

  // Scout heavy (on ROG): TikTok every 4 hours, Amazon every 6, AliExpress every 6
  cron.schedule('15 */4 * * *', async () => {
    if (paused) return;
    logEvent('orchestrator', 'health_check', 'info', 'Triggering scout-heavy: tiktok_cc');
    try {
      await sendToROG('/scrape', { job_id: uuid(), source: 'tiktok_cc' });
    } catch (e) {
      logEvent('orchestrator', 'api_failure', 'error', `ROG scrape tiktok failed: ${e}`);
    }
  });

  cron.schedule('30 */6 * * *', async () => {
    if (paused) return;
    logEvent('orchestrator', 'health_check', 'info', 'Triggering scout-heavy: amazon');
    try {
      await sendToROG('/scrape', { job_id: uuid(), source: 'amazon' });
    } catch (e) {
      logEvent('orchestrator', 'api_failure', 'error', `ROG scrape amazon failed: ${e}`);
    }
  });

  cron.schedule('45 */6 * * *', async () => {
    if (paused) return;
    logEvent('orchestrator', 'health_check', 'info', 'Triggering scout-heavy: aliexpress');
    try {
      await sendToROG('/scrape', { job_id: uuid(), source: 'aliexpress' });
    } catch (e) {
      logEvent('orchestrator', 'api_failure', 'error', `ROG scrape aliexpress failed: ${e}`);
    }
  });

  // Score new products every hour
  cron.schedule('5 * * * *', () => {
    if (paused) return;
    eventBus.emit('agent:score');
  });

  // Tracker: collect analytics every 3 hours
  cron.schedule('20 */3 * * *', () => {
    if (paused) return;
    eventBus.emit('agent:track');
  });

  // Daily reset at midnight
  cron.schedule('0 0 * * *', () => {
    resetDailyCounts();
    logEvent('orchestrator', 'health_check', 'info', 'Daily counters reset');
  });

  // Weekly learning cycle: Sunday 3 AM
  cron.schedule('0 3 * * 0', () => {
    eventBus.emit('agent:learn');
  });

  console.log('[Orchestrator] Cron schedules initialized');
}

// ============================================================
// Logging helper
// ============================================================

function logEvent(agent: string, eventType: string, severity: string, message: string, metadata?: Record<string, unknown>): void {
  const db = getDb();
  withRetry(() => {
    db.prepare(`
      INSERT INTO system_events (id, agent, event_type, severity, message, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid(), agent, eventType, severity, message, metadata ? JSON.stringify(metadata) : null);
  });
}

// ============================================================
// Pipeline event handlers
// ============================================================

// When scrape results arrive, check for new products and trigger scoring
eventBus.on('type:scrape', (result: ROGWorkerResult) => {
  if (!result.success || !result.data) return;
  console.log(`[Pipeline] Scrape results received, triggering scoring`);
  eventBus.emit('agent:score');
});

// When learning cycle completes, forward results to Telegram
eventBus.on('type:learn', (result: ROGWorkerResult) => {
  if (!result.success) {
    logEvent('orchestrator', 'error', 'error', `Learning cycle failed: ${result.error}`);
    return;
  }
  console.log('[Pipeline] Learning cycle completed');
  logEvent('orchestrator', 'health_check', 'info', 'Learning cycle completed', result.data || {});
});

// When Claude Code task completes, log it
eventBus.on('type:claude_code', (result: ROGWorkerResult) => {
  const status = result.success ? 'completed' : 'failed';
  logEvent('orchestrator', result.success ? 'health_check' : 'error',
    result.success ? 'info' : 'error',
    `Claude Code task ${status}`,
    result.data || { error: result.error },
  );
});

// ============================================================
// Health Monitoring — detect failing agents
// ============================================================

async function runHealthCheck(): Promise<void> {
  const db = getDb();

  // Check for agents with consecutive failures
  const failingAgents = db.prepare(`
    SELECT agent, COUNT(*) as failures
    FROM system_events
    WHERE severity IN ('error', 'critical')
      AND created_at > datetime('now', '-24 hours')
    GROUP BY agent
    HAVING failures >= 10
  `).all() as Array<{ agent: string; failures: number }>;

  for (const agent of failingAgents) {
    // Check if we already alerted recently
    const recentAlert = db.prepare(`
      SELECT 1 FROM system_events
      WHERE agent = 'orchestrator' AND event_type = 'health_check'
        AND message LIKE ? AND created_at > datetime('now', '-6 hours')
    `).get(`%${agent.agent} failing%`);

    if (!recentAlert) {
      logEvent('orchestrator', 'health_check', 'warning',
        `Agent ${agent.agent} failing: ${agent.failures} errors in last 24h`);
    }
  }

  // Check ROG worker health
  try {
    const resp = await fetch(`${ROG_WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      logEvent('orchestrator', 'health_check', 'warning', 'ROG worker unhealthy');
    }
  } catch {
    logEvent('orchestrator', 'health_check', 'error', 'ROG worker unreachable');
  }
}

// Run health check every 15 minutes
setInterval(() => { runHealthCheck().catch(e => console.error('[Health] Check failed:', e)); }, 900000);

// Expose event bus for other modules
export { eventBus, sendToROG, paused, dailyBudget, telegramProductsToday, logEvent };

// ============================================================
// Start
// ============================================================

app.listen(PORT, () => {
  console.log(`[Orchestrator] Listening on port ${PORT}`);
  logEvent('orchestrator', 'startup', 'info', `Orchestrator started on port ${PORT}`);
  setupCron();
});
