export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, desc, gte, and, count } from 'drizzle-orm';
import { db, trendSignals, logger } from '@ghostmarket/shared';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const source = params.get('source');
    const minScore = parseInt(params.get('min_score') ?? '0', 10);
    const limit = Math.min(parseInt(params.get('limit') ?? '30', 10), 200);
    const geo = params.get('geo');

    const conditions = [];
    if (source) conditions.push(eq(trendSignals.source, source));
    if (minScore > 0) conditions.push(gte(trendSignals.interest_score, minScore));
    if (geo) conditions.push(eq(trendSignals.geo, geo));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [trends, totalResult] = await Promise.all([
      db
        .select()
        .from(trendSignals)
        .where(where)
        .orderBy(desc(trendSignals.interest_score))
        .limit(limit),
      db
        .select({ count: count() })
        .from(trendSignals)
        .where(where),
    ]);

    return NextResponse.json({
      trends,
      total: totalResult[0]?.count ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'GET /api/trends failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
