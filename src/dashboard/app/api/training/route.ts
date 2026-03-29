import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = process.env.GHOSTMARKET_DB || path.resolve(process.cwd(), '../../data/ghostmarket.db');

function getDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

export async function GET() {
  let db: Database.Database | null = null;
  try {
    db = getDb();

    // LLM calls stats by task type
    const llmCallsByTask = db.prepare(`
      SELECT
        task_type,
        COUNT(*) as total_calls,
        AVG(tokens_in) as avg_tokens_in,
        AVG(tokens_out) as avg_tokens_out,
        AVG(latency_ms) as avg_latency_ms,
        SUM(tokens_in) as total_tokens_in,
        SUM(tokens_out) as total_tokens_out
      FROM llm_calls
      GROUP BY task_type
      ORDER BY total_calls DESC
    `).all();

    // LLM calls stats by model
    const llmCallsByModel = db.prepare(`
      SELECT
        model_used,
        COUNT(*) as total_calls,
        AVG(tokens_in) as avg_tokens_in,
        AVG(tokens_out) as avg_tokens_out,
        AVG(latency_ms) as avg_latency_ms
      FROM llm_calls
      GROUP BY model_used
      ORDER BY total_calls DESC
    `).all();

    // Label distribution (outcome labels on products with training data)
    const labelDistribution = db.prepare(`
      SELECT outcome_label, COUNT(*) as count
      FROM products
      WHERE outcome_label IS NOT NULL
      GROUP BY outcome_label
    `).all();

    // QLoRA training pair counts
    const qloraPairs = db.prepare(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(CASE WHEN outcome_quality = 'keep' THEN 1 END) as keep_count,
        COUNT(CASE WHEN outcome_quality = 'discard' THEN 1 END) as discard_count,
        COUNT(CASE WHEN outcome_quality = 'flip' THEN 1 END) as flip_count,
        COUNT(CASE WHEN included_in_training = 1 THEN 1 END) as included_in_training,
        COUNT(CASE WHEN eventual_outcome IS NOT NULL THEN 1 END) as with_outcome
      FROM llm_calls
    `).get();

    // QLoRA pairs by task type
    const qloraPairsByTask = db.prepare(`
      SELECT
        task_type,
        COUNT(CASE WHEN outcome_quality = 'keep' THEN 1 END) as keep_pairs,
        COUNT(CASE WHEN outcome_quality = 'discard' THEN 1 END) as discard_pairs,
        COUNT(CASE WHEN outcome_quality = 'flip' THEN 1 END) as flip_pairs,
        COUNT(CASE WHEN included_in_training = 1 THEN 1 END) as in_training
      FROM llm_calls
      WHERE outcome_quality IS NOT NULL
      GROUP BY task_type
      ORDER BY keep_pairs DESC
    `).all();

    // Training versions
    const trainingVersions = db.prepare(`
      SELECT
        training_version,
        COUNT(*) as sample_count,
        MIN(created_at) as first_sample,
        MAX(created_at) as last_sample
      FROM llm_calls
      WHERE training_version IS NOT NULL
      GROUP BY training_version
      ORDER BY last_sample DESC
    `).all();

    // Data quality: products with complete training data
    const dataQuality = db.prepare(`
      SELECT
        COUNT(*) as total_products,
        COUNT(CASE WHEN outcome_label IS NOT NULL THEN 1 END) as with_outcome,
        COUNT(CASE WHEN score IS NOT NULL THEN 1 END) as with_score,
        COUNT(CASE WHEN score_breakdown IS NOT NULL THEN 1 END) as with_breakdown,
        COUNT(CASE WHEN total_revenue > 0 OR total_ad_spend > 0 THEN 1 END) as with_financials,
        COUNT(CASE WHEN outcome_label IS NOT NULL AND score IS NOT NULL AND total_revenue > 0 THEN 1 END) as fully_labeled
      FROM products
    `).get();

    // Trend signal coverage (how many labeled products have signals)
    const signalCoverage = db.prepare(`
      SELECT
        ts.source,
        COUNT(DISTINCT ts.product_id) as products_with_signal,
        COUNT(DISTINCT CASE WHEN p.outcome_label IS NOT NULL THEN ts.product_id END) as labeled_with_signal,
        AVG(ts.raw_signal_strength) as avg_signal_strength
      FROM trend_signals ts
      LEFT JOIN products p ON p.id = ts.product_id
      GROUP BY ts.source
    `).all();

    // Recent LLM calls (last 10)
    const recentCalls = db.prepare(`
      SELECT id, task_type, model_used, tokens_in, tokens_out,
             latency_ms, outcome_quality, included_in_training, created_at
      FROM llm_calls
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    return NextResponse.json({
      llmCallsByTask,
      llmCallsByModel,
      labelDistribution,
      qloraPairs,
      qloraPairsByTask,
      trainingVersions,
      dataQuality,
      signalCoverage,
      recentCalls,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
