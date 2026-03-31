import { NextResponse } from 'next/server';
import { isLocal, proxyToOrchestrator } from '@/lib/api-proxy';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';

function getDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

function tryParseJson(str: string | null): unknown {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

export async function GET() {
  if (!isLocal()) return proxyToOrchestrator('/api/learning');
  let db: Database.Database | null = null;
  try {
    db = getDb();

    // Learning cycles history (last 50)
    const cycles = db.prepare(`
      SELECT
        id, cycle_number, cycle_type,
        model_version_before, model_version_after,
        accuracy_before, accuracy_after,
        training_samples, holdout_samples,
        feature_importance, source_hit_rates,
        strategy_summary, weight_adjustments,
        deployed, error_log, created_at
      FROM learning_cycles
      ORDER BY cycle_number DESC
      LIMIT 50
    `).all() as Record<string, unknown>[];

    const enrichedCycles = cycles.map((c) => ({
      ...c,
      feature_importance: tryParseJson(c.feature_importance as string | null),
      source_hit_rates: tryParseJson(c.source_hit_rates as string | null),
      weight_adjustments: tryParseJson(c.weight_adjustments as string | null),
    }));

    // Feature importance from latest deployed cycle
    const latestDeployed = db.prepare(`
      SELECT feature_importance
      FROM learning_cycles
      WHERE deployed = 1 AND feature_importance IS NOT NULL
      ORDER BY cycle_number DESC
      LIMIT 1
    `).get() as { feature_importance: string } | undefined;

    const featureImportance = latestDeployed
      ? tryParseJson(latestDeployed.feature_importance)
      : null;

    // Source hit rates from latest cycle
    const latestSourceRates = db.prepare(`
      SELECT source_hit_rates
      FROM learning_cycles
      WHERE source_hit_rates IS NOT NULL
      ORDER BY cycle_number DESC
      LIMIT 1
    `).get() as { source_hit_rates: string } | undefined;

    const sourceHitRates = latestSourceRates
      ? tryParseJson(latestSourceRates.source_hit_rates)
      : null;

    // Latest strategy reflection
    const latestReflection = db.prepare(`
      SELECT strategy_summary, weight_adjustments, created_at
      FROM learning_cycles
      WHERE cycle_type = 'reflection' AND strategy_summary IS NOT NULL
      ORDER BY cycle_number DESC
      LIMIT 1
    `).get() as { strategy_summary: string; weight_adjustments: string; created_at: string } | undefined;

    const strategyReflection = latestReflection
      ? {
          summary: latestReflection.strategy_summary,
          weightAdjustments: tryParseJson(latestReflection.weight_adjustments),
          createdAt: latestReflection.created_at,
        }
      : null;

    // Label distribution
    const labelDistribution = db.prepare(`
      SELECT outcome_label, COUNT(*) as count
      FROM products
      WHERE outcome_label IS NOT NULL
      GROUP BY outcome_label
    `).all();

    // Accuracy trend over cycles
    const accuracyTrend = db.prepare(`
      SELECT cycle_number, cycle_type, accuracy_before, accuracy_after, created_at
      FROM learning_cycles
      WHERE accuracy_after IS NOT NULL
      ORDER BY cycle_number ASC
    `).all();

    // Training samples over time
    const samplesTrend = db.prepare(`
      SELECT cycle_number, training_samples, holdout_samples, created_at
      FROM learning_cycles
      WHERE training_samples IS NOT NULL
      ORDER BY cycle_number ASC
    `).all();

    return NextResponse.json({
      cycles: enrichedCycles,
      featureImportance,
      sourceHitRates,
      strategyReflection,
      labelDistribution,
      accuracyTrend,
      samplesTrend,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
