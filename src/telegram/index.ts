// GhostMarket Telegram War Room Bot
// Operator command center with inline keyboards for all approval flows

import TelegramBot from 'node-telegram-bot-api';
import { getDb, uuid, withRetry } from '../shared/db.js';
import type {
  Product, Supplier, TrendSignal,
} from '../shared/types.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const ROG_WORKER_URL = process.env.ROG_WORKER_URL || '';
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://orchestrator:4000';
const MAX_TELEGRAM_PER_DAY = 10;

if (!BOT_TOKEN) {
  console.error('[Telegram] TELEGRAM_BOT_TOKEN not set');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: { interval: 2000, params: { timeout: 10 } },
});

bot.on('polling_error', (err) => {
  console.error('[Telegram] Polling error (will retry):', err.message?.substring(0, 100));
});

console.log('[Telegram] Bot starting...');

// ============================================================
// Persistent Telegram state (survives restarts)
// ============================================================

function initTelegramState(): void {
  const db = getDb();
  withRetry(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_state (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS telegram_sent_products (product_id TEXT PRIMARY KEY, sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
    `);
  });
}

function getTelegramSentToday(): number {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const dateRow = db.prepare("SELECT value FROM telegram_state WHERE key = 'cards_date'").get() as { value: string } | undefined;
  if (!dateRow || dateRow.value !== today) {
    // New day — reset counter
    withRetry(() => {
      db.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES ('cards_date', ?)").run(today);
      db.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES ('cards_sent_today', '0')").run();
    });
    return 0;
  }
  const countRow = db.prepare("SELECT value FROM telegram_state WHERE key = 'cards_sent_today'").get() as { value: string } | undefined;
  return parseInt(countRow?.value || '0', 10);
}

function incrementTelegramSent(): void {
  const db = getDb();
  const current = getTelegramSentToday();
  withRetry(() => {
    db.prepare("INSERT OR REPLACE INTO telegram_state (key, value) VALUES ('cards_sent_today', ?)").run(String(current + 1));
  });
}

function isProductAlreadySent(productId: string): boolean {
  const db = getDb();
  return !!db.prepare("SELECT 1 FROM telegram_sent_products WHERE product_id = ?").get(productId);
}

function markProductSent(productId: string): void {
  const db = getDb();
  withRetry(() => {
    db.prepare("INSERT OR IGNORE INTO telegram_sent_products (product_id) VALUES (?)").run(productId);
  });
}

initTelegramState();

// ============================================================
// Product Card Formatting
// ============================================================

function formatProductCard(product: Product, supplier: Supplier | null, signals: TrendSignal[]): string {
  const score = product.score || 0;
  const isHighPriority = score >= 90;
  const sourceChecks = [...new Set(signals.map(s => s.source))]
    .map(s => `${s.replace('_', ' ')} ✓`)
    .join(' · ');

  const marginStr = supplier
    ? `~${supplier.margin_pct?.toFixed(0)}% ($${supplier.unit_cost} → $${supplier.estimated_retail})`
    : 'N/A';

  const shippingStr = supplier
    ? `${supplier.shipping_days_min || '?'}-${supplier.shipping_days_max || '?'} days · ${(supplier.total_orders || 0).toLocaleString()} orders`
    : 'N/A';

  const warehouseStr = supplier?.warehouse || 'Unknown';
  const ratingStr = supplier?.seller_rating ? `${supplier.seller_rating}★` : '';
  const platformStr = supplier?.platform?.replace('_', ' ') || 'Unknown';

  // Trend velocity from signals
  const velocities = signals.map(s => s.raw_signal_strength || 0);
  const avgStrength = velocities.length > 0 ? (velocities.reduce((a, b) => a + b, 0) / velocities.length * 100).toFixed(0) : '?';

  const trendLabel = signals[0]?.trend_velocity || 'unknown';

  return `${isHighPriority ? '🔥 HIGH PRIORITY — ' : '🎯 '}PRODUCT #${product.id.slice(0, 6)} — Score: ${score}/100 (${product.model_version || 'rule_v1'})
━━━━━━━━━━━━━━━━━━━━━━
${product.keyword}
━━━━━━━━━━━━━━━━━━━━━━
📈 Trend: ${trendLabel} (strength ${avgStrength}%)
💰 Margin: ${marginStr}
🏭 ${platformStr} · ${warehouseStr} warehouse · ${ratingStr}
🚚 ${shippingStr}
⚔️ Competition: ${signals.find(s => s.competing_ads_count)?.competing_ads_count || '?'} ads
📊 Sources: ${sourceChecks}
━━━━━━━━━━━━━━━━━━━━━━
Method: ${product.fulfillment_method || 'TBD'}
━━━━━━━━━━━━━━━━━━━━━━`;
}

// ============================================================
// Send product card with inline keyboard
// ============================================================

async function sendProductCard(productId: string): Promise<void> {
  // Skip if already sent (persisted across restarts)
  if (isProductAlreadySent(productId)) return;

  // Check daily limit from DB (persisted across restarts)
  const sentToday = getTelegramSentToday();
  if (sentToday >= MAX_TELEGRAM_PER_DAY) return;

  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Product | undefined;
  if (!product) return;

  const supplier = db.prepare(
    'SELECT * FROM suppliers WHERE product_id = ? AND is_best = 1 LIMIT 1'
  ).get(productId) as Supplier | undefined ?? null;

  const signals = db.prepare(
    'SELECT * FROM trend_signals WHERE product_id = ?'
  ).all(productId) as TrendSignal[];

  const text = formatProductCard(product, supplier, signals);

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve:${productId}` },
        { text: '✏️ Modify', callback_data: `modify:${productId}` },
        { text: '⏭️ Skip', callback_data: `skip:${productId}` },
      ],
      [
        { text: '🔍 Details', callback_data: `details:${productId}` },
        { text: '🔄 Rescore', callback_data: `rescore:${productId}` },
      ],
    ],
  };

  try {
    await bot.sendMessage(CHAT_ID, text, {
      reply_markup: keyboard,
      parse_mode: undefined, // Plain text for reliable formatting
    });
    incrementTelegramSent();
    markProductSent(productId);
  } catch (err) {
    console.error('[Telegram] Failed to send card:', err);
  }
}

// ============================================================
// Callback query handler (inline keyboard presses)
// ============================================================

bot.on('callback_query', async (query) => {
  if (!query.data) return;
  const [action, productId] = query.data.split(':');
  const msgId = query.message?.message_id?.toString() || '';

  const db = getDb();

  switch (action) {
    case 'approve': {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Product | undefined;
      withRetry(() => {
        db.prepare('UPDATE products SET stage = ? WHERE id = ?').run('approved', productId);
        db.prepare(`INSERT INTO operator_decisions (id, product_id, decision, product_score, product_context, telegram_message_id)
          VALUES (?, ?, 'approve', ?, ?, ?)`).run(
          uuid(), productId, product?.score || 0,
          JSON.stringify(product), msgId,
        );
      });
      await bot.answerCallbackQuery(query.id, { text: '✅ Approved! Builder will start.' });
      await bot.editMessageText(
        `✅ APPROVED — ${product?.keyword}\nBuilder agent activated.`,
        { chat_id: CHAT_ID, message_id: query.message?.message_id },
      );
      // Trigger builder via orchestrator
      try {
        await fetch(`${ORCHESTRATOR_URL}/trigger/build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: productId }),
        });
      } catch (e) { console.error('[Telegram] Trigger build failed:', e); }
      break;
    }

    case 'skip': {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Product | undefined;
      withRetry(() => {
        db.prepare('UPDATE products SET stage = ? WHERE id = ?').run('skipped', productId);
        db.prepare(`INSERT INTO operator_decisions (id, product_id, decision, product_score, product_context, telegram_message_id)
          VALUES (?, ?, 'skip', ?, ?, ?)`).run(
          uuid(), productId, product?.score || 0,
          JSON.stringify(product), msgId,
        );
      });
      await bot.answerCallbackQuery(query.id, { text: '⏭️ Skipped' });
      await bot.editMessageText(
        `⏭️ SKIPPED — ${product?.keyword}`,
        { chat_id: CHAT_ID, message_id: query.message?.message_id },
      );
      break;
    }

    case 'modify': {
      await bot.answerCallbackQuery(query.id, { text: 'Reply to this message with modification notes' });
      await bot.sendMessage(CHAT_ID, `✏️ What would you like to modify for this product?\nReply with your notes.`);
      break;
    }

    case 'details': {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Product | undefined;
      const signals = db.prepare('SELECT * FROM trend_signals WHERE product_id = ?').all(productId) as TrendSignal[];
      const suppliers = db.prepare('SELECT * FROM suppliers WHERE product_id = ? ORDER BY landed_cost').all(productId) as Supplier[];

      let details = `📋 DETAILS — ${product?.keyword}\n\n`;
      details += `Score Breakdown:\n${JSON.stringify(product?.score_breakdown ? JSON.parse(product.score_breakdown as unknown as string) : {}, null, 2)}\n\n`;
      details += `Signals (${signals.length}):\n`;
      for (const s of signals) {
        details += `  ${s.source}: strength=${s.raw_signal_strength}, velocity=${s.trend_velocity}\n`;
      }
      details += `\nSuppliers (${suppliers.length}):\n`;
      for (const s of suppliers) {
        details += `  ${s.platform}: $${s.landed_cost} (${s.margin_pct?.toFixed(0)}% margin) ${s.is_best ? '← BEST' : ''}\n`;
      }
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(CHAT_ID, details);
      break;
    }

    case 'rescore': {
      try {
        await fetch(`${ORCHESTRATOR_URL}/trigger/score`, { method: 'POST' });
        await bot.answerCallbackQuery(query.id, { text: '🔄 Rescoring triggered' });
      } catch (e) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Rescore failed' });
      }
      break;
    }

    default:
      await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
  }
});

// ============================================================
// Command handlers
// ============================================================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(chatId, `👻 GhostMarket War Room — Online
━━━━━━━━━━━━━━━━━━━━━━
Initiating full pipeline scan...
━━━━━━━━━━━━━━━━━━━━━━`);

  // Phase 1: Trigger Scout (non-blocking — orchestrator responds immediately)
  let scoutTriggered = false;
  try {
    await bot.sendMessage(chatId, '🔍 Phase 1: Triggering Scout agent...');
    const scoutResp = await fetch(`${ORCHESTRATOR_URL}/trigger/scout`, { method: 'POST', signal: AbortSignal.timeout(10000) });
    const scoutData = await scoutResp.json() as { skipped?: string; status?: string; signals_before?: number };
    if (scoutData.skipped) {
      await bot.sendMessage(chatId, '⏸️ Pipeline is paused. Resume with /resume first.');
      return;
    }
    scoutTriggered = true;
    await bot.sendMessage(chatId, `✅ Scout running in background (${scoutData.signals_before || 0} signals in DB)`);
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ Scout unavailable — continuing with existing data`);
  }

  // Phase 2: Trigger Scorer (non-blocking)
  try {
    await bot.sendMessage(chatId, '🧠 Phase 2: Triggering Scorer agent...');
    const scorerResp = await fetch(`${ORCHESTRATOR_URL}/trigger/scorer`, { method: 'POST', signal: AbortSignal.timeout(10000) });
    const scorerData = await scorerResp.json() as { skipped?: string; status?: string; scored_before?: number };
    if (!scorerData.skipped) {
      await bot.sendMessage(chatId, `✅ Scorer running in background (${scorerData.scored_before || 0} products scored so far)`);
    }
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ Scorer unavailable — using existing scores`);
  }

  // Wait briefly for agents to process (they run async in background)
  await bot.sendMessage(chatId, '⏳ Agents running in background...');
  await new Promise(r => setTimeout(r, 5000));

  // Phase 3: Surface top products from DB (always works, no blocking)
  try {
    const db = getDb();
    const topProducts = db.prepare(`
      SELECT p.id, p.keyword, p.score, p.stage, p.category
      FROM products p
      WHERE p.score >= 55 AND p.stage IN ('scored', 'discovered')
      ORDER BY p.score DESC
      LIMIT 5
    `).all() as Array<{ id: string; keyword: string; score: number; stage: string; category: string | null }>;

    if (topProducts.length === 0) {
      const anyProducts = db.prepare(`
        SELECT COUNT(*) as c FROM products WHERE score IS NOT NULL
      `).get() as { c: number };
      await bot.sendMessage(chatId, `📭 No products with score >= 55 found (${anyProducts.c} products scored total).\nRun more scout cycles.`);
      return;
    }

    await bot.sendMessage(chatId, `🎯 Phase 3: Top ${topProducts.length} products (score >= 65)\n━━━━━━━━━━━━━━━━━━━━━━`);

    for (const product of topProducts) {
      await sendProductCard(product.id);
    }

    const pendingActions = db.prepare("SELECT COUNT(*) as c FROM human_actions WHERE status = 'pending'").get() as { c: number };
    let footer = `━━━━━━━━━━━━━━━━━━━━━━\n✅ Pipeline complete. Use /status for overview.`;
    if (pendingActions.c > 0) {
      footer += `\n⚠️ ${pendingActions.c} pending action(s) — use /actions`;
    }
    await bot.sendMessage(chatId, footer);
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Failed to fetch products: ${e instanceof Error ? e.message : e}`);
  }
});

bot.onText(/\/status/, async (msg) => {
  const db = getDb();
  const stages = db.prepare('SELECT stage, COUNT(*) as count FROM products GROUP BY stage').all() as Array<{ stage: string; count: number }>;
  const total = stages.reduce((sum, s) => sum + s.count, 0);
  let text = `📊 Pipeline Status (${total} total)\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  for (const s of stages) {
    text += `${s.stage}: ${s.count}\n`;
  }
  text += `\n📬 Telegram cards today: ${getTelegramSentToday()}/${MAX_TELEGRAM_PER_DAY}`;
  await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/leaderboard/, async (msg) => {
  const db = getDb();
  const products = db.prepare(`
    SELECT keyword, score, total_revenue, total_ad_spend, roas, outcome_label
    FROM products WHERE outcome_label IS NOT NULL
    ORDER BY roas DESC LIMIT 10
  `).all() as Array<{ keyword: string; score: number; total_revenue: number; total_ad_spend: number; roas: number; outcome_label: string }>;

  let text = '🏆 Leaderboard (by ROAS)\n━━━━━━━━━━━━━━━━━━━━━━\n';
  for (const [i, p] of products.entries()) {
    const emoji = p.outcome_label === 'win' ? '✅' : p.outcome_label === 'loss' ? '❌' : '➖';
    text += `${i + 1}. ${emoji} ${p.keyword} — ROAS: ${p.roas?.toFixed(1) || 'N/A'} | Rev: $${p.total_revenue} | Spend: $${p.total_ad_spend}\n`;
  }
  if (!products.length) text += 'No labeled products yet.';
  await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/revenue (\S+) (\d+\.?\d*)/, async (msg, match) => {
  if (!match) return;
  const [, productId, amount] = match;
  const db = getDb();
  withRetry(() => {
    db.prepare('UPDATE products SET total_revenue = total_revenue + ? WHERE id LIKE ?')
      .run(parseFloat(amount), `${productId}%`);
  });
  await bot.sendMessage(msg.chat.id, `💰 Revenue $${amount} logged for ${productId}`);
});

bot.onText(/\/adspend (\S+) (\d+\.?\d*)/, async (msg, match) => {
  if (!match) return;
  const [, productId, amount] = match;
  const db = getDb();
  withRetry(() => {
    db.prepare('UPDATE products SET total_ad_spend = total_ad_spend + ? WHERE id LIKE ?')
      .run(parseFloat(amount), `${productId}%`);
  });
  await bot.sendMessage(msg.chat.id, `📢 Ad spend $${amount} logged for ${productId}`);
});

bot.onText(/\/result (\S+) (win|loss|breakeven)/, async (msg, match) => {
  if (!match) return;
  const [, productId, outcome] = match;
  const db = getDb();

  // Find full product ID
  const product = db.prepare('SELECT id FROM products WHERE id LIKE ? LIMIT 1').get(`${productId}%`) as { id: string } | undefined;
  if (!product) {
    await bot.sendMessage(msg.chat.id, `❌ Product ${productId} not found`);
    return;
  }

  // Use the cascade labeling function
  // We need to do it inline since training.py is Python
  const fullId = product.id;
  withRetry(() => {
    db.prepare('UPDATE products SET outcome_label = ?, stage = ? WHERE id = ?').run(outcome, 'completed', fullId);
    db.prepare('UPDATE trend_signals SET eventual_outcome = ? WHERE product_id = ?').run(outcome, fullId);
    db.prepare('UPDATE suppliers SET eventual_outcome = ? WHERE product_id = ?').run(outcome, fullId);
    db.prepare('UPDATE brand_kits SET eventual_outcome = ? WHERE product_id = ?').run(outcome, fullId);
    db.prepare('UPDATE landing_pages SET eventual_outcome = ? WHERE product_id = ?').run(outcome, fullId);
    db.prepare('UPDATE ad_creatives SET eventual_outcome = ? WHERE product_id = ?').run(outcome, fullId);
    db.prepare('UPDATE content_posts SET eventual_outcome = ? WHERE product_id = ?').run(outcome, fullId);
    db.prepare('UPDATE operator_decisions SET eventual_outcome = ? WHERE product_id = ?').run(outcome, fullId);

    // Label llm_calls
    if (outcome === 'win') {
      db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'keep' WHERE product_id = ?").run(outcome, fullId);
    } else if (outcome === 'loss') {
      db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'flip' WHERE product_id = ? AND task_type = 'product_evaluation'").run(outcome, fullId);
      db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'discard' WHERE product_id = ? AND task_type != 'product_evaluation'").run(outcome, fullId);
    } else {
      db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'keep' WHERE product_id = ? AND task_type = 'product_evaluation'").run(outcome, fullId);
      db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'discard' WHERE product_id = ? AND task_type != 'product_evaluation'").run(outcome, fullId);
    }

    // Create outcome record
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(fullId) as Product;
    db.prepare(`INSERT INTO outcomes (id, product_id, outcome_label, total_revenue, total_ad_spend, total_orders, roas)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuid(), fullId, outcome, p.total_revenue, p.total_ad_spend, p.total_orders,
      p.total_ad_spend > 0 ? p.total_revenue / p.total_ad_spend : null,
    );
  });

  const emoji = outcome === 'win' ? '✅' : outcome === 'loss' ? '❌' : '➖';
  await bot.sendMessage(msg.chat.id, `${emoji} Outcome "${outcome}" recorded for ${productId}. All training data labeled.`);
});

bot.onText(/\/learn/, async (msg) => {
  try {
    await fetch(`${ORCHESTRATOR_URL}/trigger/learn`, { method: 'POST' });
    await bot.sendMessage(msg.chat.id, '🧠 Learning cycle triggered. Results will be posted here.');
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Failed to trigger learning: ${e}`);
  }
});

bot.onText(/\/train/, async (msg) => {
  if (!ROG_WORKER_URL) {
    await bot.sendMessage(msg.chat.id, '❌ ROG_WORKER_URL not configured');
    return;
  }
  try {
    await fetch(`${ROG_WORKER_URL}/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: uuid(), train_type: 'qlora', callback_url: `${ORCHESTRATOR_URL}/callback` }),
    });
    await bot.sendMessage(msg.chat.id, '🔧 QLoRA fine-tuning triggered on ROG. This takes 1-2 hours.');
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Failed to trigger training: ${e}`);
  }
});

bot.onText(/\/model/, async (msg) => {
  const db = getDb();
  const latest = db.prepare(`
    SELECT * FROM learning_cycles ORDER BY created_at DESC LIMIT 1
  `).get() as Record<string, unknown> | undefined;

  const labeledCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM products WHERE outcome_label IS NOT NULL"
  ).get() as { cnt: number };

  const llmPairs = db.prepare(
    "SELECT COUNT(*) as cnt FROM llm_calls WHERE outcome_quality IN ('keep', 'flip')"
  ).get() as { cnt: number };

  let text = '🤖 Model Status\n━━━━━━━━━━━━━━━━━━━━━━\n';
  if (latest) {
    text += `Version: ${latest.model_version_after || latest.model_version_before || 'rule_v1'}\n`;
    text += `Type: ${latest.cycle_type}\n`;
    text += `Accuracy: ${latest.accuracy_after || 'N/A'}\n`;
    text += `Training samples: ${latest.training_samples || 'N/A'}\n`;
    if (latest.feature_importance) {
      text += `\nTop features:\n`;
      const features = JSON.parse(latest.feature_importance as string) as Array<[string, number]>;
      for (const [name, weight] of features.slice(0, 5)) {
        text += `  ${name}: ${(weight * 100).toFixed(1)}%\n`;
      }
    }
  } else {
    text += 'No training cycles completed yet.\n';
  }
  text += `\nLabeled products: ${labeledCount.cnt}`;
  text += `\nQLoRA training pairs: ${llmPairs.cnt}`;
  text += `\nXGBoost threshold: ${labeledCount.cnt >= 50 ? '✅ Met (50+)' : `${labeledCount.cnt}/50`}`;
  text += `\nQLoRA threshold: ${llmPairs.cnt >= 50 ? '✅ Met (50+)' : `${llmPairs.cnt}/50`}`;

  await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/sources/, async (msg) => {
  const db = getDb();
  const rates = db.prepare(`
    SELECT ts.source,
           COUNT(*) as total,
           SUM(CASE WHEN ts.eventual_outcome = 'win' THEN 1 ELSE 0 END) as wins
    FROM trend_signals ts WHERE ts.eventual_outcome IS NOT NULL GROUP BY ts.source
  `).all() as Array<{ source: string; total: number; wins: number }>;

  let text = '📡 Source Hit Rates\n━━━━━━━━━━━━━━━━━━━━━━\n';
  if (rates.length) {
    for (const r of rates.sort((a, b) => (b.wins / b.total) - (a.wins / a.total))) {
      const rate = ((r.wins / r.total) * 100).toFixed(0);
      text += `${r.source}: ${rate}% win rate (${r.wins}/${r.total})\n`;
    }
  } else {
    text += 'No labeled data yet.';
  }
  await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/insights/, async (msg) => {
  const db = getDb();
  const latest = db.prepare(`
    SELECT strategy_summary FROM learning_cycles
    WHERE cycle_type = 'reflection' AND strategy_summary IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `).get() as { strategy_summary: string } | undefined;

  if (latest?.strategy_summary) {
    await bot.sendMessage(msg.chat.id, `🧠 Latest Strategy Insights\n━━━━━━━━━━━━━━━━━━━━━━\n${latest.strategy_summary}`);
  } else {
    await bot.sendMessage(msg.chat.id, 'No strategy insights yet. Run /learn after labeling some outcomes.');
  }
});

bot.onText(/\/pause/, async (msg) => {
  try {
    await fetch(`${ORCHESTRATOR_URL}/control/pause`, { method: 'POST' });
    await bot.sendMessage(msg.chat.id, '⏸️ All agents paused.');
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Pause failed: ${e}`);
  }
});

bot.onText(/\/resume/, async (msg) => {
  try {
    await fetch(`${ORCHESTRATOR_URL}/control/resume`, { method: 'POST' });
    await bot.sendMessage(msg.chat.id, '▶️ All agents resumed.');
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Resume failed: ${e}`);
  }
});

bot.onText(/\/budget (\d+\.?\d*)/, async (msg, match) => {
  if (!match) return;
  const amount = parseFloat(match[1]);
  try {
    await fetch(`${ORCHESTRATOR_URL}/control/budget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    await bot.sendMessage(msg.chat.id, `💵 Daily budget set to $${amount}`);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Budget update failed: ${e}`);
  }
});

// ============================================================
// Human Action handlers: DONE / SKIP / /actions
// ============================================================

import {
  HUMAN_ACTIONS,
  getLatestPendingAction,
  getPendingActions,
  completeHumanAction,
  skipHumanAction,
} from '../shared/human-actions.js';

bot.onText(/^DONE\b/i, async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const pending = getLatestPendingAction();

  if (!pending) {
    await bot.sendMessage(chatId, '✅ No pending actions to complete.');
    return;
  }

  const userData = text.substring(4).trim();
  const action = completeHumanAction(pending.id, userData || undefined);
  if (!action) {
    await bot.sendMessage(chatId, '❌ Could not find the pending action.');
    return;
  }

  const def = HUMAN_ACTIONS[action.action_type];
  let response = `✅ Action completed: ${def?.emoji || '✓'} ${def?.title || action.action_type}`;
  if (userData) response += `\nData: ${userData}`;
  response += '\n\n▶️ Pipeline RESUMED.';

  await bot.sendMessage(chatId, response);

  // Re-trigger the builder for this product
  if (action.product_id) {
    try {
      await fetch(`${ORCHESTRATOR_URL}/trigger/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: action.product_id }),
      });
    } catch { /* orchestrator might not be running */ }
  }
});

bot.onText(/^SKIP$/i, async (msg) => {
  const chatId = msg.chat.id;
  const pending = getLatestPendingAction();

  if (!pending) {
    await bot.sendMessage(chatId, '⏭️ No pending actions to skip.');
    return;
  }

  const action = skipHumanAction(pending.id);
  if (!action) {
    await bot.sendMessage(chatId, '❌ Could not find the pending action.');
    return;
  }

  const def = HUMAN_ACTIONS[action.action_type];
  await bot.sendMessage(chatId, `⏭️ Action skipped: ${def?.emoji || '?'} ${def?.title || action.action_type}\n\n▶️ Pipeline RESUMED (action skipped).`);

  // Re-trigger the builder
  if (action.product_id) {
    try {
      await fetch(`${ORCHESTRATOR_URL}/trigger/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: action.product_id }),
      });
    } catch { /* orchestrator might not be running */ }
  }
});

bot.onText(/\/actions/, async (msg) => {
  const chatId = msg.chat.id;
  const pending = getPendingActions();

  if (pending.length === 0) {
    await bot.sendMessage(chatId, '✅ No pending actions. Pipeline is flowing freely.');
    return;
  }

  let text = `⏸️ PENDING ACTIONS (${pending.length})\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  for (const a of pending) {
    const def = HUMAN_ACTIONS[a.action_type];
    const age = Math.round((Date.now() - new Date(a.created_at).getTime()) / 60000);
    const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    text += `\n${def?.emoji || '❓'} ${def?.title || a.action_type}\n   ${a.action_description}\n   ${ageStr} | ID: ${a.id.substring(0, 8)}\n`;
  }
  text += '\n━━━━━━━━━━━━━━━━━━━━━━\nReply DONE or SKIP to handle the latest action.';
  await bot.sendMessage(chatId, text);
});

bot.onText(/\/kill (\S+)/, async (msg, match) => {
  if (!match) return;
  const productId = match[1];
  const db = getDb();
  const product = db.prepare('SELECT id, keyword FROM products WHERE id LIKE ? LIMIT 1').get(`${productId}%`) as { id: string; keyword: string } | undefined;
  if (!product) {
    await bot.sendMessage(msg.chat.id, `❌ Product ${productId} not found`);
    return;
  }
  withRetry(() => {
    db.prepare('UPDATE products SET stage = ? WHERE id = ?').run('killed', product.id);
    db.prepare(`INSERT INTO operator_decisions (id, product_id, decision, telegram_message_id) VALUES (?, ?, 'kill', ?)`)
      .run(uuid(), product.id, msg.message_id.toString());
  });
  await bot.sendMessage(msg.chat.id, `☠️ ${product.keyword} killed. All activity stopped.`);
});

// ============================================================
// Claude Code integration: /build, /fix, /improve
// ============================================================

bot.onText(/\/(build|fix|improve) (.+)/, async (msg, match) => {
  if (!match) return;
  const [, command, description] = match;

  if (!ROG_WORKER_URL) {
    await bot.sendMessage(msg.chat.id, '❌ ROG_WORKER_URL not configured for Claude Code');
    return;
  }

  await bot.sendMessage(msg.chat.id, `🤖 Sending to Claude Code on ROG: ${command} — "${description}"\nThis may take a few minutes.`);

  const prompt = buildClaudeCodePrompt(command, description);

  try {
    const resp = await fetch(`${ROG_WORKER_URL}/claude-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: uuid(),
        prompt,
        callback_url: `${ORCHESTRATOR_URL}/callback`,
      }),
    });

    if (resp.ok) {
      await bot.sendMessage(msg.chat.id, '✅ Job submitted to ROG. Will notify when complete.');
    } else {
      await bot.sendMessage(msg.chat.id, `❌ ROG rejected job: ${resp.status}`);
    }
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `❌ Failed to reach ROG: ${e}`);
  }
});

function buildClaudeCodePrompt(command: string, description: string): string {
  const actionVerb = { build: 'Build', fix: 'Fix', improve: 'Improve' }[command] || 'Execute';
  return `You are working on GhostMarket, an autonomous e-commerce discovery system.

Read the file ghostmarket_claude_context.md for full system context before making changes.

TASK: ${actionVerb} the following:
${description}

RULES:
- Read existing code before modifying anything
- Follow patterns established in existing files
- All Python code must have type hints
- All TypeScript code must be strict mode
- Log all outputs to the appropriate SQLite training data tables
- Commit with a descriptive message when done
- Do not modify unrelated code`;
}

// ============================================================
// Polling for new scored products
// ============================================================

async function checkForNewCards(): Promise<void> {
  // Skip entirely if daily limit already reached
  if (getTelegramSentToday() >= MAX_TELEGRAM_PER_DAY) return;

  const db = getDb();
  const products = db.prepare(`
    SELECT id FROM products
    WHERE stage = 'scored'
      AND decision = 'recommend'
      AND score >= 65
      AND id NOT IN (SELECT product_id FROM telegram_sent_products)
    ORDER BY score DESC
    LIMIT 5
  `).all() as Array<{ id: string }>;

  for (const p of products) {
    await sendProductCard(p.id);
  }
}


// ============================================================
// Start
// ============================================================

console.log('[Telegram] War room bot online');

const db = getDb();
withRetry(() => {
  db.prepare(`INSERT INTO system_events (id, agent, event_type, severity, message) VALUES (?, 'telegram', 'startup', 'info', 'Telegram bot started')`)
    .run(uuid());
});

// Poll for new cards every 2 minutes
setInterval(() => {
  checkForNewCards().catch(err => console.error('[Telegram] Card check failed:', err));
}, 120000);

// Initial check
checkForNewCards().catch(console.error);

export { sendProductCard, bot };
