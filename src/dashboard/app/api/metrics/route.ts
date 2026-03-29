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

    // Total products
    const totalProducts = db.prepare(`
      SELECT COUNT(*) as count FROM products
    `).get() as { count: number };

    // Products scored today
    const scoredToday = db.prepare(`
      SELECT COUNT(*) as count FROM products
      WHERE stage IN ('scored', 'approved', 'building', 'live', 'tracking', 'completed', 'skipped', 'killed')
        AND DATE(updated_at) = DATE('now')
        AND score IS NOT NULL
    `).get() as { count: number };

    // Products approved (currently approved or beyond)
    const productsApproved = db.prepare(`
      SELECT COUNT(*) as count FROM products
      WHERE stage IN ('approved', 'building', 'live', 'tracking', 'completed')
    `).get() as { count: number };

    // Products live
    const productsLive = db.prepare(`
      SELECT COUNT(*) as count FROM products
      WHERE stage = 'live'
    `).get() as { count: number };

    // Total revenue
    const totalRevenue = db.prepare(`
      SELECT COALESCE(SUM(total_revenue), 0) as total FROM products
    `).get() as { total: number };

    // Total ad spend
    const totalAdSpend = db.prepare(`
      SELECT COALESCE(SUM(total_ad_spend), 0) as total FROM products
    `).get() as { total: number };

    // Latest model version
    const modelVersion = db.prepare(`
      SELECT model_version FROM products
      WHERE model_version IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { model_version: string } | undefined;

    // Source hit rates from latest learning cycle
    const latestCycle = db.prepare(`
      SELECT source_hit_rates FROM learning_cycles
      WHERE source_hit_rates IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { source_hit_rates: string } | undefined;

    let sourceHitRates = null;
    if (latestCycle?.source_hit_rates) {
      try {
        sourceHitRates = JSON.parse(latestCycle.source_hit_rates);
      } catch {
        sourceHitRates = null;
      }
    }

    // Recent products (last 5)
    const recentProducts = db.prepare(`
      SELECT id, keyword, category, stage, score, decision,
             total_revenue, total_ad_spend, outcome_label, created_at
      FROM products
      ORDER BY created_at DESC
      LIMIT 5
    `).all();

    // Outcome distribution
    const outcomeDistribution = db.prepare(`
      SELECT outcome_label, COUNT(*) as count
      FROM products
      WHERE outcome_label IS NOT NULL
      GROUP BY outcome_label
    `).all();

    return NextResponse.json({
      totalProducts: totalProducts.count,
      scoredToday: scoredToday.count,
      productsApproved: productsApproved.count,
      productsLive: productsLive.count,
      totalRevenue: totalRevenue.total,
      totalAdSpend: totalAdSpend.total,
      netProfit: totalRevenue.total - totalAdSpend.total,
      roas: totalAdSpend.total > 0 ? totalRevenue.total / totalAdSpend.total : 0,
      modelVersion: modelVersion?.model_version || null,
      sourceHitRates,
      recentProducts,
      outcomeDistribution,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
