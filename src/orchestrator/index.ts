// GhostMarket — Orchestrator
// Event bus, cron scheduler, agent coordination, health monitoring
// Runs on the PC, coordinates all agents across both machines

import express from 'express';
import cron from 'node-cron';
import { exec, execSync } from 'child_process';
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
const ROG_ENABLED = process.env.ROG_ENABLED === 'true';

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

// Human actions API
app.get('/api/human-actions', (_req, res) => {
  try {
    const db = getDb();
    const pending = db.prepare("SELECT * FROM human_actions WHERE status = 'pending' ORDER BY created_at DESC").all();
    const recent = db.prepare("SELECT * FROM human_actions ORDER BY created_at DESC LIMIT 20").all();
    res.json({ pending, recent });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/human-actions/:id/complete', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { data } = req.body as { data?: string };
    db.prepare("UPDATE human_actions SET status = 'completed', completed_at = datetime('now'), operator_data = ? WHERE id = ? OR id LIKE ?")
      .run(data || null, id, `${id}%`);
    const action = db.prepare("SELECT * FROM human_actions WHERE id = ? OR id LIKE ?").get(id, `${id}%`) as { product_id: string | null } | undefined;
    if (action?.product_id) {
      db.prepare("UPDATE products SET stage = 'building' WHERE id = ? AND stage = 'waiting_human'").run(action.product_id);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/human-actions/:id/skip', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    db.prepare("UPDATE human_actions SET status = 'skipped', completed_at = datetime('now') WHERE id = ? OR id LIKE ?")
      .run(id, `${id}%`);
    const action = db.prepare("SELECT * FROM human_actions WHERE id = ? OR id LIKE ?").get(id, `${id}%`) as { product_id: string | null } | undefined;
    if (action?.product_id) {
      db.prepare("UPDATE products SET stage = 'building' WHERE id = ? AND stage = 'waiting_human'").run(action.product_id);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Manual report triggers (for testing)
app.post('/trigger/daily-report', async (_req, res) => {
  try {
    const report = await generateDailyReport();
    await sendTelegram(report);
    res.json({ sent: true, report });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.post('/trigger/weekly-report', async (_req, res) => {
  try {
    const report = await generateWeeklyReport();
    await sendTelegram(report);
    res.json({ sent: true, report });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Trigger Scout: runs light_sources.py in background, responds immediately
app.post('/trigger/scout', async (_req, res) => {
  if (paused) { res.json({ skipped: 'paused' }); return; }
  logEvent('orchestrator', 'health_check', 'info', 'Triggering scout via /trigger/scout');
  const db = getDb();
  const signalsBefore = (db.prepare('SELECT COUNT(*) as c FROM trend_signals').get() as { c: number }).c;

  // Respond immediately — scout runs in background
  res.json({ triggered: 'scout', status: 'running', signals_before: signalsBefore });

  // Run scout asynchronously
  exec('python3 src/agents/scout/light_sources.py', {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: `${process.cwd()}/src` },
    timeout: 120000,
  }, (error, _stdout, _stderr) => {
    const signalsAfter = (getDb().prepare('SELECT COUNT(*) as c FROM trend_signals').get() as { c: number }).c;
    const newSignals = signalsAfter - signalsBefore;
    if (error) {
      logEvent('orchestrator', 'api_failure', 'warning', `Scout finished with error: ${error.message.substring(0, 200)}`);
    } else {
      logEvent('orchestrator', 'health_check', 'info', `Scout complete: ${newSignals} new signals (${signalsAfter} total)`);
    }
    // Emit event so Telegram /start can pick up the result
    eventBus.emit('scout:complete', { success: !error, signals: signalsAfter, newSignals });
  });
});

// Trigger Scorer: runs scorer/main.py in background, responds immediately
app.post('/trigger/scorer', async (_req, res) => {
  if (paused) { res.json({ skipped: 'paused' }); return; }
  logEvent('orchestrator', 'health_check', 'info', 'Triggering scorer via /trigger/scorer');
  const db = getDb();
  const scoredBefore = (db.prepare("SELECT COUNT(*) as c FROM products WHERE stage = 'scored'").get() as { c: number }).c;

  // Respond immediately
  res.json({ triggered: 'scorer', status: 'running', scored_before: scoredBefore });

  // Run scorer asynchronously
  exec('python3 src/agents/scorer/main.py', {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: `${process.cwd()}/src` },
    timeout: 120000,
  }, (error, _stdout, _stderr) => {
    const scoredAfter = (getDb().prepare("SELECT COUNT(*) as c FROM products WHERE stage = 'scored'").get() as { c: number }).c;
    if (error) {
      logEvent('orchestrator', 'api_failure', 'warning', `Scorer finished with error: ${error.message.substring(0, 200)}`);
    } else {
      logEvent('orchestrator', 'health_check', 'info', `Scorer complete: ${scoredAfter} products scored`);
    }
    eventBus.emit('scorer:complete', { success: !error, scored: scoredAfter });
  });
});

// Serve landing page HTML from database
app.get('/api/landing/:id', (req, res) => {
  try {
    const db = getDb();
    const page = db.prepare(
      'SELECT html_content FROM landing_pages WHERE product_id = ? AND html_content IS NOT NULL ORDER BY variant_id LIMIT 1'
    ).get(req.params.id) as { html_content: string } | undefined;

    if (page?.html_content) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(page.html_content);
    } else {
      res.status(404).json({ error: 'Landing page not found' });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Trigger Builder for a specific product
app.post('/trigger/builder/:id', async (req, res) => {
  if (paused) { res.json({ skipped: 'paused' }); return; }
  const { id } = req.params;
  try {
    logEvent('orchestrator', 'health_check', 'info', `Triggering builder for product ${id}`);
    eventBus.emit('agent:build', id);
    res.json({ triggered: 'builder', product_id: id, success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logEvent('orchestrator', 'api_failure', 'error', `Builder trigger failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
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

// ============================================================
// Automated Telegram Reports
// ============================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendTelegram(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
  } catch (e) {
    console.error('[Orchestrator] Telegram send failed:', e);
  }
}

async function generateDailyReport(): Promise<string> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  const stages = db.prepare('SELECT stage, COUNT(*) as c FROM products GROUP BY stage').all() as Array<{ stage: string; c: number }>;
  const stageMap: Record<string, number> = {};
  let total = 0;
  for (const s of stages) { stageMap[s.stage] = s.c; total += s.c; }

  const labeled = (db.prepare("SELECT COUNT(*) as c FROM products WHERE outcome_label IS NOT NULL").get() as { c: number }).c;
  const llmCalls = (db.prepare("SELECT COUNT(*) as c FROM llm_calls").get() as { c: number }).c;
  const errors24h = (db.prepare("SELECT COUNT(*) as c FROM system_events WHERE severity IN ('error','critical') AND created_at > datetime('now', '-24 hours')").get() as { c: number }).c;
  const discovered24h = (db.prepare("SELECT COUNT(*) as c FROM products WHERE created_at > datetime('now', '-24 hours')").get() as { c: number }).c;
  const avgScore = (db.prepare("SELECT ROUND(AVG(score), 1) as avg FROM products WHERE score IS NOT NULL").get() as { avg: number | null }).avg || 0;
  const reviewZone = (db.prepare("SELECT COUNT(*) as c FROM products WHERE score >= 50 AND score < 60 AND stage = 'scored'").get() as { c: number }).c;
  const throughput24h = (db.prepare("SELECT COUNT(*) as c FROM products WHERE stage NOT IN ('discovered') AND updated_at > datetime('now', '-24 hours')").get() as { c: number }).c;

  const topProducts = db.prepare(`
    SELECT keyword, score, decision, stage FROM products
    WHERE score IS NOT NULL ORDER BY score DESC LIMIT 3
  `).all() as Array<{ keyword: string; score: number; decision: string | null; stage: string }>;

  const liveProducts = db.prepare(`
    SELECT keyword, landing_page_url FROM products
    WHERE stage IN ('live','tracking') AND landing_page_url IS NOT NULL LIMIT 3
  `).all() as Array<{ keyword: string; landing_page_url: string }>;

  let msg = `📊 DAILY BRIEFING — ${dayName}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📦 ${discovered24h} new products (24h) | ${total} total\n`;
  msg += `📊 ${stageMap['scored'] || 0} scored | ✅ ${stageMap['approved'] || 0} approved | 🟢 ${(stageMap['live'] || 0) + (stageMap['tracking'] || 0)} live\n`;
  msg += `🏗️ ${stageMap['building'] || 0} building | ⏭️ ${stageMap['skipped'] || 0} skipped\n`;
  msg += `⚡ ${throughput24h} processed (24h) | Avg score: ${avgScore}\n\n`;

  if (topProducts.length > 0) {
    msg += `Top 3:\n`;
    for (const p of topProducts) {
      const emoji = p.stage === 'tracking' || p.stage === 'live' ? '🟢' : p.decision === 'recommend' ? '🎯' : '📦';
      msg += `${emoji} ${p.keyword} — ${p.score} (${p.stage})\n`;
    }
    msg += '\n';
  }

  if (liveProducts.length > 0) {
    msg += `Live:\n`;
    for (const p of liveProducts) {
      msg += `🔗 ${p.keyword}: ${p.landing_page_url}\n`;
    }
    msg += '\n';
  }

  if (reviewZone > 0) {
    msg += `🔍 ${reviewZone} products in review zone (50-59)\n`;
  }

  msg += `🧠 ${labeled}/50 labeled | ${llmCalls} LLM calls\n`;

  const pendingActions = (db.prepare("SELECT COUNT(*) as c FROM human_actions WHERE status = 'pending'").get() as { c: number }).c;
  if (pendingActions > 0) {
    msg += `⚠️ ${pendingActions} pending human action(s) — /actions\n`;
  }

  msg += `${errors24h === 0 ? '✅ System clean' : `⚠️ ${errors24h} errors`} (24h)`;
  return msg;
}

async function generateWeeklyReport(): Promise<string> {
  const db = getDb();
  const weekStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const total = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
  const labeled = (db.prepare("SELECT COUNT(*) as c FROM products WHERE outcome_label IS NOT NULL").get() as { c: number }).c;
  const wins = (db.prepare("SELECT COUNT(*) as c FROM products WHERE outcome_label = 'win'").get() as { c: number }).c;
  const losses = (db.prepare("SELECT COUNT(*) as c FROM products WHERE outcome_label = 'loss'").get() as { c: number }).c;
  const llmCalls = (db.prepare("SELECT COUNT(*) as c FROM llm_calls").get() as { c: number }).c;
  const qloraPairs = (db.prepare("SELECT COUNT(*) as c FROM llm_calls WHERE outcome_quality IN ('keep','flip')").get() as { c: number }).c;
  const errors7d = (db.prepare("SELECT COUNT(*) as c FROM system_events WHERE severity IN ('error','critical') AND created_at > datetime('now', '-7 days')").get() as { c: number }).c;

  const rev = db.prepare("SELECT COALESCE(SUM(total_revenue),0) as rev, COALESCE(SUM(total_ad_spend),0) as spend FROM products").get() as { rev: number; spend: number };

  const latestReflection = db.prepare(`
    SELECT strategy_summary FROM learning_cycles
    WHERE cycle_type = 'reflection' AND strategy_summary IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `).get() as { strategy_summary: string } | undefined;

  let msg = `📈 GHOSTMARKET WEEKLY REPORT — Week of ${weekStr}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📦 Products: ${total} total\n`;
  msg += `🏷️ Labeled: ${labeled} (${wins} wins, ${losses} losses)\n`;
  msg += `💰 Revenue: $${rev.rev.toFixed(2)} | Spend: $${rev.spend.toFixed(2)}\n`;
  msg += `🧠 LLM calls: ${llmCalls} | QLoRA pairs: ${qloraPairs}\n`;
  msg += `⚠️ Errors (7d): ${errors7d}\n\n`;

  msg += `Model Progress:\n`;
  msg += `  XGBoost: ${labeled >= 50 ? '✅ Ready to retrain' : `${labeled}/50 labeled (need ${50 - labeled} more)`}\n`;
  msg += `  QLoRA: ${qloraPairs >= 50 ? '✅ Ready to fine-tune' : `${qloraPairs}/50 pairs (need ${50 - qloraPairs} more)`}\n\n`;

  msg += `This Week:\n`;
  if (labeled < 10) {
    msg += `• Approve more products from Telegram cards\n`;
    msg += `• Label outcomes with /result {id} win|loss\n`;
    msg += `• Run /start to discover fresh trends\n`;
  } else if (labeled < 50) {
    msg += `• ${50 - labeled} more labels needed for XGBoost retrain\n`;
    msg += `• Review live product performance\n`;
    msg += `• Label outcomes to improve the model\n`;
  } else {
    msg += `• Run /learn to retrain XGBoost with new data\n`;
    msg += `• Review strategy insights below\n`;
    msg += `• Check P&L for optimization opportunities\n`;
  }

  if (latestReflection?.strategy_summary) {
    const summary = latestReflection.strategy_summary.slice(0, 400);
    msg += `\n💡 Latest Strategy:\n${summary}`;
  }

  return msg;
}

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
  // Only run if ROG_ENABLED=true — otherwise these just spam errors
  if (ROG_ENABLED) {
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
  } else {
    console.log('[Orchestrator] ROG_ENABLED=false — skipping heavy scout crons (TikTok, Amazon, AliExpress)');
  }

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

  // Daily report: 9 AM Pacific (4 PM UTC / 16:00 UTC)
  cron.schedule('0 16 * * *', async () => {
    try {
      const report = await generateDailyReport();
      await sendTelegram(report);
      logEvent('orchestrator', 'health_check', 'info', 'Daily report sent to Telegram');
    } catch (e) {
      console.error('[Orchestrator] Daily report failed:', e);
    }
  });

  // Weekly report: Monday 9 AM Pacific (4 PM UTC)
  cron.schedule('0 16 * * 1', async () => {
    try {
      // Trigger learning cycle first
      eventBus.emit('agent:learn');
      // Wait a moment for learning to start, then send report
      setTimeout(async () => {
        try {
          const report = await generateWeeklyReport();
          await sendTelegram(report);
          logEvent('orchestrator', 'health_check', 'info', 'Weekly report sent to Telegram');
        } catch (e) {
          console.error('[Orchestrator] Weekly report send failed:', e);
        }
      }, 5000);
    } catch (e) {
      console.error('[Orchestrator] Weekly report failed:', e);
    }
  });

  console.log('[Orchestrator] Cron schedules initialized (incl. daily 9AM + weekly Monday reports)');
}

// ============================================================
// Logging helper
// ============================================================

// Sanitize sensitive data from log messages
function sanitize(text: string): string {
  return text
    .replace(/vcp_[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/r8_[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/nvapi-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/AIzaSy[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer [a-zA-Z0-9_-]+/g, 'Bearer [REDACTED]')
    .replace(/token=[a-zA-Z0-9_-]+/g, 'token=[REDACTED]');
}

function logEvent(agent: string, eventType: string, severity: string, message: string, metadata?: Record<string, unknown>): void {
  const db = getDb();
  const safeMessage = sanitize(message);
  const safeMeta = metadata ? sanitize(JSON.stringify(metadata)) : null;
  withRetry(() => {
    db.prepare(`
      INSERT INTO system_events (id, agent, event_type, severity, message, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid(), agent, eventType, severity, safeMessage, safeMeta);
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

  // Check ROG worker health — only if ROG is enabled
  if (ROG_ENABLED) {
    try {
      const resp = await fetch(`${ROG_WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        const recentROGLog = db.prepare(`
          SELECT 1 FROM system_events
          WHERE agent = 'orchestrator' AND message LIKE '%ROG worker%'
            AND created_at > datetime('now', '-1 hour')
        `).get();
        if (!recentROGLog) {
          logEvent('orchestrator', 'health_check', 'warning', 'ROG worker unhealthy');
        }
      }
    } catch {
      const recentROGLog = db.prepare(`
        SELECT 1 FROM system_events
        WHERE agent = 'orchestrator' AND message LIKE '%ROG worker%'
          AND created_at > datetime('now', '-1 hour')
        `).get();
      if (!recentROGLog) {
        logEvent('orchestrator', 'health_check', 'warning', 'ROG worker unreachable');
      }
    }
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
