export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, desc, asc, sql, count } from 'drizzle-orm';
import { db, scoredProducts, rawProducts, logger } from '@ghostmarket/shared';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const limit = Math.min(parseInt(params.get('limit') ?? '50', 10), 200);
    const offset = parseInt(params.get('offset') ?? '0', 10);
    const sort = params.get('sort') ?? 'score';

    const orderBy =
      sort === 'scored_at'
        ? desc(scoredProducts.scored_at)
        : desc(scoredProducts.score);

    const conditions = [];
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      conditions.push(eq(scoredProducts.status, status));
    }

    const where = conditions.length > 0 ? conditions[0] : undefined;

    const [products, totalResult] = await Promise.all([
      db
        .select({
          id: scoredProducts.id,
          raw_product_id: scoredProducts.raw_product_id,
          score: scoredProducts.score,
          sales_velocity_score: scoredProducts.sales_velocity_score,
          margin_score: scoredProducts.margin_score,
          trend_score: scoredProducts.trend_score,
          competition_score: scoredProducts.competition_score,
          fulfillment_type: scoredProducts.fulfillment_type,
          estimated_margin_pct: scoredProducts.estimated_margin_pct,
          trend_keywords: scoredProducts.trend_keywords,
          opportunity_reason: scoredProducts.opportunity_reason,
          fulfillment_strategy: scoredProducts.fulfillment_strategy,
          supplier_action: scoredProducts.supplier_action,
          estimated_startup_cost: scoredProducts.estimated_startup_cost,
          risk_level: scoredProducts.risk_level,
          scored_at: scoredProducts.scored_at,
          status: scoredProducts.status,
          title: rawProducts.title,
          source: rawProducts.source,
          price_usd: rawProducts.price_usd,
          original_price_usd: rawProducts.original_price_usd,
          estimated_monthly_sales: rawProducts.estimated_monthly_sales,
          review_count: rawProducts.review_count,
          rating: rawProducts.rating,
          category: rawProducts.category,
          product_url: rawProducts.product_url,
          image_urls: rawProducts.image_urls,
          tags: rawProducts.tags,
        })
        .from(scoredProducts)
        .innerJoin(rawProducts, eq(scoredProducts.raw_product_id, rawProducts.id))
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count() })
        .from(scoredProducts)
        .where(where),
    ]);

    return NextResponse.json({
      products,
      total: totalResult[0]?.count ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'GET /api/products failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
