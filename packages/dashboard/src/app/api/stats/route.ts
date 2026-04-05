export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { eq, gte, and, desc, count, avg, sql } from 'drizzle-orm';
import {
  db,
  rawProducts,
  scoredProducts,
  trendSignals,
  scrapeJobs,
  logger,
} from '@ghostmarket/shared';

export async function GET() {
  try {
    const now = Date.now();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      totalAllTime,
      total24h,
      total7d,
      totalScored,
      pendingCount,
      approvedCount,
      avgApprovedScore,
      topCategories,
      topKeywords,
      scraperSuccess24h,
      scraperTotal24h,
    ] = await Promise.all([
      db.select({ count: count() }).from(rawProducts),
      db
        .select({ count: count() })
        .from(rawProducts)
        .where(gte(rawProducts.scraped_at, twentyFourHoursAgo)),
      db
        .select({ count: count() })
        .from(rawProducts)
        .where(gte(rawProducts.scraped_at, sevenDaysAgo)),
      db.select({ count: count() }).from(scoredProducts),
      db
        .select({ count: count() })
        .from(scoredProducts)
        .where(eq(scoredProducts.status, 'pending')),
      db
        .select({ count: count() })
        .from(scoredProducts)
        .where(eq(scoredProducts.status, 'approved')),
      db
        .select({ avg: avg(scoredProducts.score) })
        .from(scoredProducts)
        .where(eq(scoredProducts.status, 'approved')),
      db
        .select({
          category: rawProducts.category,
          count: count(),
        })
        .from(rawProducts)
        .where(gte(rawProducts.scraped_at, sevenDaysAgo))
        .groupBy(rawProducts.category)
        .orderBy(desc(count()))
        .limit(5),
      db
        .select({
          keyword: trendSignals.keyword,
          interest_score: trendSignals.interest_score,
        })
        .from(trendSignals)
        .where(gte(trendSignals.captured_at, sevenDaysAgo))
        .orderBy(desc(trendSignals.interest_score))
        .limit(5),
      db
        .select({ count: count() })
        .from(scrapeJobs)
        .where(
          and(
            eq(scrapeJobs.status, 'completed'),
            gte(scrapeJobs.created_at, twentyFourHoursAgo),
          ),
        ),
      db
        .select({ count: count() })
        .from(scrapeJobs)
        .where(gte(scrapeJobs.created_at, twentyFourHoursAgo)),
    ]);

    const totalRuns = scraperTotal24h[0]?.count ?? 0;
    const successRuns = scraperSuccess24h[0]?.count ?? 0;
    const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 100;

    return NextResponse.json({
      products: {
        total: totalAllTime[0]?.count ?? 0,
        last_24h: total24h[0]?.count ?? 0,
        last_7d: total7d[0]?.count ?? 0,
      },
      scoring: {
        total_scored: totalScored[0]?.count ?? 0,
        pending_review: pendingCount[0]?.count ?? 0,
        approved: approvedCount[0]?.count ?? 0,
        avg_approved_score: avgApprovedScore[0]?.avg
          ? parseFloat(String(avgApprovedScore[0].avg))
          : 0,
      },
      top_categories: topCategories.map((c) => ({
        category: c.category,
        count: c.count,
      })),
      top_keywords: topKeywords.map((k) => ({
        keyword: k.keyword,
        interest_score: k.interest_score,
      })),
      scraper_health: {
        success_rate_24h: successRate,
        total_runs_24h: totalRuns,
        successful_runs_24h: successRuns,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'GET /api/stats failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
