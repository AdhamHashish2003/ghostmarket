// GhostMarket — Orchestrator
// Event bus, cron scheduler, agent coordination, health monitoring
// Runs on the PC, coordinates all agents across both machines

import express from 'express';
import cron from 'node-cron';
import { getDb, uuid, withRetry } from '../shared/db.js';
import type { ROGWorkerResult } from '../shared/types.js';
import { EventEmitter } from 'events';

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS middleware — allow Vercel-deployed dashboard to call these APIs
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

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
// Data API endpoints — consumed by Vercel-deployed dashboard
// ============================================================

// 1. GET /api/pipeline — stage counts, recent events, last activity per stage
app.get('/api/pipeline', (_req, res) => {
  try {
    const db = getDb();
    const stages = db.prepare(`
      SELECT stage, COUNT(*) as count FROM products GROUP BY stage ORDER BY count DESC
    `).all() as Array<{ stage: string; count: number }>;

    const recentEvents = db.prepare(`
      SELECT id, agent, event_type, severity, message, metadata, created_at
      FROM system_events ORDER BY created_at DESC LIMIT 50
    `).all();

    const lastActivityRows = db.prepare(`
      SELECT stage, MAX(updated_at) as last_activity FROM products GROUP BY stage
    `).all() as Array<{ stage: string; last_activity: string }>;
    const lastActivityPerStage: Record<string, string> = {};
    for (const row of lastActivityRows) {
      lastActivityPerStage[row.stage] = row.last_activity;
    }

    res.json({ stages, recentEvents, lastActivityPerStage });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 2. GET /api/metrics — dashboard KPIs
app.get('/api/metrics', (_req, res) => {
  try {
    const db = getDb();

    const totalProducts = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;

    const todayStr = new Date().toISOString().slice(0, 10);
    const scoredToday = (db.prepare(`
      SELECT COUNT(*) as c FROM products WHERE stage != 'discovered' AND updated_at >= ?
    `).get(todayStr) as { c: number }).c;

    const approved = (db.prepare(`
      SELECT COUNT(*) as c FROM products WHERE stage = 'approved'
    `).get() as { c: number }).c;

    const live = (db.prepare(`
      SELECT COUNT(*) as c FROM products WHERE stage IN ('live', 'tracking')
    `).get() as { c: number }).c;

    const revRow = db.prepare(`
      SELECT COALESCE(SUM(total_revenue), 0) as rev, COALESCE(SUM(total_ad_spend), 0) as spend
      FROM products
    `).get() as { rev: number; spend: number };

    const modelVersionRow = db.prepare(`
      SELECT model_version_after as model_version FROM learning_cycles WHERE deployed = 1 ORDER BY created_at DESC LIMIT 1
    `).get() as { model_version: string } | undefined;

    // Source hit rates: % of signals from each source that became wins
    const sourceHitRows = db.prepare(`
      SELECT ts.source,
        CAST(SUM(CASE WHEN p.outcome_label = 'win' THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1) as hit_rate
      FROM trend_signals ts
      LEFT JOIN products p ON p.id = ts.product_id
      GROUP BY ts.source
    `).all() as Array<{ source: string; hit_rate: number }>;
    const sourceHitRates: Record<string, number> = {};
    for (const row of sourceHitRows) {
      sourceHitRates[row.source] = Math.round(row.hit_rate * 1000) / 1000;
    }

    const recentProducts = db.prepare(`
      SELECT id, keyword, category, stage, score, decision, outcome_label, created_at, updated_at
      FROM products ORDER BY created_at DESC LIMIT 5
    `).all();

    const outcomeRows = db.prepare(`
      SELECT outcome_label, COUNT(*) as count FROM products
      WHERE outcome_label IS NOT NULL GROUP BY outcome_label
    `).all() as Array<{ outcome_label: string; count: number }>;
    const outcomeDistribution: Record<string, number> = {};
    for (const row of outcomeRows) {
      outcomeDistribution[row.outcome_label] = row.count;
    }

    res.json({
      totalProducts,
      scoredToday,
      approved,
      live,
      totalRevenue: revRow.rev,
      totalAdSpend: revRow.spend,
      modelVersion: modelVersionRow?.model_version || 'rule_v1',
      sourceHitRates,
      recentProducts,
      outcomeDistribution,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 3. GET /api/products — paginated, filterable, sortable product list
app.get('/api/products', (req, res) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const stage = req.query.stage as string | undefined;
    const sort = ['score', 'created_at', 'updated_at', 'keyword', 'total_revenue', 'roas'].includes(req.query.sort as string)
      ? req.query.sort as string : 'created_at';
    const order = (req.query.order as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let whereClause = '';
    const params: unknown[] = [];
    if (stage && stage.trim()) {
      whereClause = 'WHERE stage = ?';
      params.push(stage);
    }

    const totalRow = db.prepare(`SELECT COUNT(*) as c FROM products ${whereClause}`).get(...params) as { c: number };
    const total = totalRow.c;

    // Sort column is validated above so this is safe from injection
    const rows = db.prepare(`
      SELECT id, keyword, category, stage, score, score_breakdown, model_version,
             decision, fulfillment_method, outcome_label, total_revenue, total_ad_spend,
             total_orders, roas, daily_budget, landing_page_url, created_at, updated_at
      FROM products ${whereClause}
      ORDER BY ${sort} ${order}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      products: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 4. GET /api/products/:id — single product with all related data
app.get('/api/products/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const signals = db.prepare('SELECT * FROM trend_signals WHERE product_id = ? ORDER BY created_at DESC').all(id);
    const suppliers = db.prepare('SELECT * FROM suppliers WHERE product_id = ? ORDER BY is_best DESC, landed_cost ASC').all(id);
    const brandKit = db.prepare('SELECT * FROM brand_kits WHERE product_id = ? ORDER BY approved DESC LIMIT 1').get(id);
    const pages = db.prepare('SELECT * FROM landing_pages WHERE product_id = ? ORDER BY conversion_rate DESC').all(id);
    const creatives = db.prepare('SELECT * FROM ad_creatives WHERE product_id = ? ORDER BY ctr DESC').all(id);
    const posts = db.prepare('SELECT * FROM content_posts WHERE product_id = ? ORDER BY created_at DESC').all(id);
    const metrics = db.prepare('SELECT * FROM campaign_metrics WHERE product_id = ? ORDER BY date DESC').all(id);
    const outcome = db.prepare('SELECT * FROM outcomes WHERE product_id = ?').get(id);
    const decisions = db.prepare('SELECT * FROM operator_decisions WHERE product_id = ? ORDER BY created_at DESC').all(id);

    res.json({ product, signals, suppliers, brandKit, pages, creatives, posts, metrics, outcome, decisions });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 5. GET /api/learning — learning cycles, feature importance, source hit rates, strategy
app.get('/api/learning', (_req, res) => {
  try {
    const db = getDb();

    const cycles = db.prepare(`
      SELECT * FROM learning_cycles ORDER BY cycle_number DESC LIMIT 20
    `).all();

    // Latest deployed cycle for current feature importance / strategy
    const latest = db.prepare(`
      SELECT feature_importance, source_hit_rates, strategy_summary, weight_adjustments, model_version_after
      FROM learning_cycles WHERE deployed = 1 ORDER BY created_at DESC LIMIT 1
    `).get() as {
      feature_importance: string | null;
      source_hit_rates: string | null;
      strategy_summary: string | null;
      weight_adjustments: string | null;
      model_version_after: string | null;
    } | undefined;

    let featureImportance: unknown = null;
    let sourceHitRates: unknown = null;
    let strategy: string | null = null;
    let weightAdjustments: unknown = null;
    let currentModel: string | null = null;

    if (latest) {
      featureImportance = latest.feature_importance ? JSON.parse(latest.feature_importance) : null;
      sourceHitRates = latest.source_hit_rates ? JSON.parse(latest.source_hit_rates) : null;
      strategy = latest.strategy_summary;
      weightAdjustments = latest.weight_adjustments ? JSON.parse(latest.weight_adjustments) : null;
      currentModel = latest.model_version_after;
    }

    // Accuracy trend across cycles
    const accuracyTrend = db.prepare(`
      SELECT cycle_number, cycle_type, accuracy_before, accuracy_after, training_samples, created_at
      FROM learning_cycles ORDER BY cycle_number ASC
    `).all();

    res.json({ cycles, featureImportance, sourceHitRates, strategy, weightAdjustments, currentModel, accuracyTrend });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 6. GET /api/pnl — revenue, spend, profit per product + aggregates
app.get('/api/pnl', (_req, res) => {
  try {
    const db = getDb();

    const perProduct = db.prepare(`
      SELECT p.id, p.keyword, p.category, p.stage, p.outcome_label,
             p.total_revenue, p.total_ad_spend,
             (p.total_revenue - p.total_ad_spend) as profit,
             p.roas, p.total_orders,
             s.landed_cost, s.margin_pct
      FROM products p
      LEFT JOIN suppliers s ON s.product_id = p.id AND s.is_best = 1
      WHERE p.stage NOT IN ('discovered', 'skipped')
      ORDER BY p.total_revenue DESC
    `).all();

    const aggregate = db.prepare(`
      SELECT
        COALESCE(SUM(total_revenue), 0) as totalRevenue,
        COALESCE(SUM(total_ad_spend), 0) as totalAdSpend,
        COALESCE(SUM(total_revenue) - SUM(total_ad_spend), 0) as totalProfit,
        COALESCE(SUM(total_orders), 0) as totalOrders,
        COUNT(CASE WHEN outcome_label = 'win' THEN 1 END) as wins,
        COUNT(CASE WHEN outcome_label = 'loss' THEN 1 END) as losses,
        COUNT(CASE WHEN outcome_label = 'breakeven' THEN 1 END) as breakevens
      FROM products
    `).get();

    // Daily P&L from campaign_metrics
    const daily = db.prepare(`
      SELECT date,
        COALESCE(SUM(revenue), 0) as revenue,
        COALESCE(SUM(ad_spend), 0) as adSpend,
        COALESCE(SUM(revenue) - SUM(ad_spend), 0) as profit,
        COALESCE(SUM(conversions), 0) as conversions
      FROM campaign_metrics
      GROUP BY date ORDER BY date DESC LIMIT 30
    `).all();

    res.json({ perProduct, aggregate, daily });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 7. GET /api/training — LLM calls stats, label distribution, QLoRA pair counts
app.get('/api/training', (_req, res) => {
  try {
    const db = getDb();

    // LLM call stats by task type
    const callsByTask = db.prepare(`
      SELECT task_type, model_used, COUNT(*) as count,
        COALESCE(SUM(tokens_in), 0) as total_tokens_in,
        COALESCE(SUM(tokens_out), 0) as total_tokens_out,
        ROUND(AVG(latency_ms)) as avg_latency_ms
      FROM llm_calls GROUP BY task_type, model_used ORDER BY count DESC
    `).all();

    // Total LLM stats
    const totals = db.prepare(`
      SELECT COUNT(*) as totalCalls,
        COALESCE(SUM(tokens_in), 0) as totalTokensIn,
        COALESCE(SUM(tokens_out), 0) as totalTokensOut,
        ROUND(AVG(latency_ms)) as avgLatencyMs
      FROM llm_calls
    `).get();

    // Label distribution: outcome_quality for training selection
    const labelDistribution = db.prepare(`
      SELECT outcome_quality, COUNT(*) as count
      FROM llm_calls WHERE outcome_quality IS NOT NULL
      GROUP BY outcome_quality
    `).all();

    // QLoRA training pair counts (calls marked for training)
    const qloraPairs = db.prepare(`
      SELECT training_version, COUNT(*) as pairs
      FROM llm_calls WHERE included_in_training = 1
      GROUP BY training_version ORDER BY training_version DESC
    `).all();

    // Calls ready for labeling (have eventual_outcome but not yet labeled)
    const unlabeled = (db.prepare(`
      SELECT COUNT(*) as c FROM llm_calls
      WHERE eventual_outcome IS NOT NULL AND outcome_quality IS NULL
    `).get() as { c: number }).c;

    // Recent LLM calls
    const recentCalls = db.prepare(`
      SELECT id, task_type, model_used, tokens_in, tokens_out, latency_ms,
             eventual_outcome, outcome_quality, included_in_training, created_at
      FROM llm_calls ORDER BY created_at DESC LIMIT 20
    `).all();

    res.json({ callsByTask, totals, labelDistribution, qloraPairs, unlabeled, recentCalls });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 8. GET /api/system — agent health, error log, DB stats, event counts
app.get('/api/system', (_req, res) => {
  try {
    const db = getDb();

    // Agent health: error counts in last 24h per agent
    const agentHealth = db.prepare(`
      SELECT agent,
        COUNT(*) as total_events,
        COUNT(CASE WHEN severity IN ('error', 'critical') THEN 1 END) as errors_24h,
        COUNT(CASE WHEN severity = 'warning' THEN 1 END) as warnings_24h,
        MAX(created_at) as last_seen
      FROM system_events
      WHERE created_at > datetime('now', '-24 hours')
      GROUP BY agent ORDER BY errors_24h DESC
    `).all();

    // Recent errors
    const recentErrors = db.prepare(`
      SELECT id, agent, event_type, severity, message, metadata, created_at
      FROM system_events
      WHERE severity IN ('error', 'critical')
      ORDER BY created_at DESC LIMIT 30
    `).all();

    // DB stats: row counts per table
    const tables = ['products', 'trend_signals', 'suppliers', 'brand_kits', 'landing_pages',
      'ad_creatives', 'content_posts', 'campaign_metrics', 'outcomes', 'learning_cycles',
      'operator_decisions', 'system_events', 'llm_calls'];
    const dbStats: Record<string, number> = {};
    for (const table of tables) {
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
      dbStats[table] = row.c;
    }

    // Event counts by type (last 7 days)
    const eventCounts = db.prepare(`
      SELECT event_type, COUNT(*) as count
      FROM system_events
      WHERE created_at > datetime('now', '-7 days')
      GROUP BY event_type ORDER BY count DESC
    `).all();

    // Unresolved events
    const unresolvedCount = (db.prepare(`
      SELECT COUNT(*) as c FROM system_events WHERE resolved = 0 AND severity IN ('error', 'critical')
    `).get() as { c: number }).c;

    res.json({
      paused,
      dailyBudget,
      telegramProductsToday,
      agentHealth,
      recentErrors,
      dbStats,
      eventCounts,
      unresolvedCount,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// 9. GET /api/events/stream — SSE endpoint for real-time system events
app.get('/api/events/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial keepalive
  res.write(':\n\n');

  const db = getDb();
  let lastEventTime = new Date().toISOString();

  const intervalId = setInterval(() => {
    try {
      const newEvents = db.prepare(`
        SELECT id, agent, event_type, severity, message, metadata, created_at
        FROM system_events
        WHERE created_at > ?
        ORDER BY created_at ASC
      `).all(lastEventTime) as Array<{ id: string; created_at: string; [k: string]: unknown }>;

      for (const event of newEvents) {
        res.write(`id: ${event.id}\n`);
        res.write(`event: system_event\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.created_at > lastEventTime) {
          lastEventTime = event.created_at as string;
        }
      }

      // Send keepalive comment if no events
      if (newEvents.length === 0) {
        res.write(':\n\n');
      }
    } catch {
      // DB might be briefly unavailable; skip this tick
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(intervalId);
  });
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
