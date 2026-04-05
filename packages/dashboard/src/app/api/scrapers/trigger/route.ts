export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@ghostmarket/shared';

const SCRAPER_FLEET_URL = process.env.SCRAPER_FLEET_URL ?? 'http://localhost:3007';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scraper_name, config } = body;

    if (!scraper_name) {
      return NextResponse.json({ error: 'scraper_name is required' }, { status: 400 });
    }

    // Strip "scrape:" prefix if present for the API call
    const shortName = scraper_name.replace('scrape:', '');

    const res = await fetch(`${SCRAPER_FLEET_URL}/api/trigger/${shortName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: config ?? {} }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error ?? 'Trigger failed' },
        { status: res.status },
      );
    }

    return NextResponse.json({
      success: true,
      job_id: data.batchId,
      scraper_name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'POST /api/scrapers/trigger failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
