export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db, scrapeJobs, logger } from '@ghostmarket/shared';

const FLEET_URL = process.env.SCRAPER_FLEET_URL ?? 'https://scrapers-production-e383.up.railway.app';

export async function GET() {
  try {
    // Get recent scrape jobs from DB (last 24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentJobs = await db
      .select()
      .from(scrapeJobs)
      .where(sql`created_at >= ${twentyFourHoursAgo}`)
      .orderBy(sql`created_at DESC`)
      .limit(20);

    // Try to get live queue status from Railway
    let fleetStatus = null;
    try {
      const res = await fetch(`${FLEET_URL}/api/status`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) fleetStatus = await res.json();
    } catch { /* Railway unreachable */ }

    return NextResponse.json({
      jobs: recentJobs,
      fleet: fleetStatus,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'GET /api/scrapers/status failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
