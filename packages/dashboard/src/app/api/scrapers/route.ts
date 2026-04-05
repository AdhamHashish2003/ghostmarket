export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { eq, desc, gte, and, count, sql } from 'drizzle-orm';
import { db, scrapeJobs, rawProducts, scoredProducts, logger } from '@ghostmarket/shared';

const SCRAPER_NAMES = [
  'scrape:google-trends',
  'scrape:aliexpress',
  'scrape:amazon-trending',
  'scrape:tiktok-shop',
];

const SCHEDULE_MAP: Record<string, string> = {
  'scrape:google-trends': '0 */2 * * *',
  'scrape:aliexpress': '0 */12 * * *',
  'scrape:amazon-trending': '0 */6 * * *',
  'scrape:tiktok-shop': '0 */4 * * *',
};

function cronToHumanReadable(cron: string): string {
  const parts = cron.split(' ');
  const hours = parts[1];
  if (hours?.startsWith('*/')) {
    const interval = hours.slice(2);
    return `Every ${interval} hours`;
  }
  return cron;
}

export async function GET() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const scrapers = await Promise.all(
      SCRAPER_NAMES.map(async (name) => {
        const [lastRunRows, last24hRows] = await Promise.all([
          db
            .select()
            .from(scrapeJobs)
            .where(eq(scrapeJobs.scraper_name, name))
            .orderBy(desc(scrapeJobs.created_at))
            .limit(1),
          db
            .select({
              total_found: sql<number>`coalesce(sum(${scrapeJobs.products_found}), 0)::int`,
              run_count: count(),
            })
            .from(scrapeJobs)
            .where(
              and(
                eq(scrapeJobs.scraper_name, name),
                gte(scrapeJobs.created_at, twentyFourHoursAgo),
              ),
            ),
        ]);

        const lastRun = lastRunRows[0] ?? null;
        const stats24h = last24hRows[0];

        return {
          name,
          schedule: cronToHumanReadable(SCHEDULE_MAP[name] ?? ''),
          last_run: lastRun?.completed_at ?? lastRun?.started_at ?? null,
          last_status: lastRun?.status ?? 'never',
          products_found_last_run: lastRun?.products_found ?? 0,
          products_found_24h: stats24h?.total_found ?? 0,
          runs_24h: stats24h?.run_count ?? 0,
        };
      }),
    );

    // Overall stats
    const [totalProducts, totalScored, pendingReview] = await Promise.all([
      db.select({ count: count() }).from(rawProducts),
      db.select({ count: count() }).from(scoredProducts),
      db
        .select({ count: count() })
        .from(scoredProducts)
        .where(eq(scoredProducts.status, 'pending')),
    ]);

    return NextResponse.json({
      scrapers,
      overall: {
        total_products: totalProducts[0]?.count ?? 0,
        total_scored: totalScored[0]?.count ?? 0,
        pending_review: pendingReview[0]?.count ?? 0,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'GET /api/scrapers failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
