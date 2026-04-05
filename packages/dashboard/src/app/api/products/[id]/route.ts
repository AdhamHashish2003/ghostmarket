export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { eq, desc, and } from 'drizzle-orm';
import { db, scoredProducts, rawProducts, logger } from '@ghostmarket/shared';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const rows = await db
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
        scored_at: scoredProducts.scored_at,
        status: scoredProducts.status,
        title: rawProducts.title,
        source: rawProducts.source,
        external_id: rawProducts.external_id,
        price_usd: rawProducts.price_usd,
        original_price_usd: rawProducts.original_price_usd,
        currency: rawProducts.currency,
        estimated_monthly_sales: rawProducts.estimated_monthly_sales,
        review_count: rawProducts.review_count,
        rating: rawProducts.rating,
        category: rawProducts.category,
        sub_category: rawProducts.sub_category,
        supplier_name: rawProducts.supplier_name,
        supplier_url: rawProducts.supplier_url,
        product_url: rawProducts.product_url,
        image_urls: rawProducts.image_urls,
        tags: rawProducts.tags,
        scraped_at: rawProducts.scraped_at,
      })
      .from(scoredProducts)
      .innerJoin(rawProducts, eq(scoredProducts.raw_product_id, rawProducts.id))
      .where(eq(scoredProducts.id, params.id))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const product = rows[0];

    // Price history: same source + external_id
    const priceHistory = await db
      .select({
        date: rawProducts.scraped_at,
        price: rawProducts.price_usd,
      })
      .from(rawProducts)
      .where(
        and(
          eq(rawProducts.source, product.source),
          eq(rawProducts.external_id, product.external_id),
        ),
      )
      .orderBy(desc(rawProducts.scraped_at))
      .limit(30);

    return NextResponse.json({
      product,
      priceHistory: priceHistory.map((p) => ({
        date: p.date?.toISOString() ?? '',
        price: parseFloat(p.price),
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, id: params.id }, 'GET /api/products/[id] failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await request.json();
    const { status } = body;

    if (!status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json(
        { error: 'status must be "approved" or "rejected"' },
        { status: 400 },
      );
    }

    const updated = await db
      .update(scoredProducts)
      .set({ status })
      .where(eq(scoredProducts.id, params.id))
      .returning();

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, product: updated[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, id: params.id }, 'PATCH /api/products/[id] failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
