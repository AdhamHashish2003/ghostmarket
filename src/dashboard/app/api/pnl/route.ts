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

export async function GET() {
  if (!isLocal()) return proxyToOrchestrator('/api/pnl');
  let db: Database.Database | null = null;
  try {
    db = getDb();

    // Per-product P&L
    const perProduct = db.prepare(`
      SELECT
        p.id, p.keyword, p.category, p.stage, p.outcome_label,
        p.total_revenue, p.total_ad_spend, p.total_orders, p.roas,
        (p.total_revenue - p.total_ad_spend) as profit,
        s.landed_cost,
        s.unit_cost,
        p.created_at
      FROM products p
      LEFT JOIN suppliers s ON s.product_id = p.id AND s.is_best = 1
      WHERE p.total_revenue > 0 OR p.total_ad_spend > 0
      ORDER BY (p.total_revenue - p.total_ad_spend) DESC
    `).all();

    // Aggregate totals
    const aggregates = db.prepare(`
      SELECT
        COALESCE(SUM(total_revenue), 0) as total_revenue,
        COALESCE(SUM(total_ad_spend), 0) as total_ad_spend,
        COALESCE(SUM(total_revenue - total_ad_spend), 0) as total_profit,
        COALESCE(SUM(total_orders), 0) as total_orders,
        CASE WHEN SUM(total_ad_spend) > 0
          THEN SUM(total_revenue) / SUM(total_ad_spend)
          ELSE 0
        END as overall_roas,
        COUNT(*) as total_products,
        COUNT(CASE WHEN outcome_label = 'win' THEN 1 END) as wins,
        COUNT(CASE WHEN outcome_label = 'loss' THEN 1 END) as losses,
        COUNT(CASE WHEN outcome_label = 'breakeven' THEN 1 END) as breakevens
      FROM products
      WHERE total_revenue > 0 OR total_ad_spend > 0
    `).get();

    // ROAS distribution (bucketed)
    const roasDistribution = db.prepare(`
      SELECT
        CASE
          WHEN roas IS NULL THEN 'N/A'
          WHEN roas < 0.5 THEN '< 0.5x'
          WHEN roas < 1.0 THEN '0.5-1x'
          WHEN roas < 1.5 THEN '1-1.5x'
          WHEN roas < 2.0 THEN '1.5-2x'
          WHEN roas < 3.0 THEN '2-3x'
          WHEN roas < 5.0 THEN '3-5x'
          ELSE '5x+'
        END as bucket,
        COUNT(*) as count
      FROM products
      WHERE total_revenue > 0 OR total_ad_spend > 0
      GROUP BY bucket
      ORDER BY
        CASE bucket
          WHEN '< 0.5x' THEN 1
          WHEN '0.5-1x' THEN 2
          WHEN '1-1.5x' THEN 3
          WHEN '1.5-2x' THEN 4
          WHEN '2-3x' THEN 5
          WHEN '3-5x' THEN 6
          WHEN '5x+' THEN 7
          ELSE 8
        END
    `).all();

    // Daily metrics from campaign_metrics
    const dailyMetrics = db.prepare(`
      SELECT
        date,
        SUM(revenue) as revenue,
        SUM(ad_spend) as ad_spend,
        SUM(revenue - ad_spend) as profit,
        SUM(conversions) as conversions,
        SUM(visits) as visits,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        CASE WHEN SUM(ad_spend) > 0
          THEN SUM(revenue) / SUM(ad_spend)
          ELSE 0
        END as roas
      FROM campaign_metrics
      GROUP BY date
      ORDER BY date DESC
      LIMIT 90
    `).all();

    // Top performers
    const topPerformers = db.prepare(`
      SELECT id, keyword, total_revenue, total_ad_spend,
             (total_revenue - total_ad_spend) as profit, roas
      FROM products
      WHERE total_revenue > 0
      ORDER BY (total_revenue - total_ad_spend) DESC
      LIMIT 10
    `).all();

    // Worst performers
    const worstPerformers = db.prepare(`
      SELECT id, keyword, total_revenue, total_ad_spend,
             (total_revenue - total_ad_spend) as profit, roas
      FROM products
      WHERE total_ad_spend > 0
      ORDER BY (total_revenue - total_ad_spend) ASC
      LIMIT 10
    `).all();

    return NextResponse.json({
      perProduct,
      aggregates,
      roasDistribution,
      dailyMetrics,
      topPerformers,
      worstPerformers,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
