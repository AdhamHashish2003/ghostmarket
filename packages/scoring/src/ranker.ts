import { eq, and, desc, lt, sql, not, arrayContains } from 'drizzle-orm';
import { db, rawProducts, scoredProducts, logger } from '@ghostmarket/shared';
import type { ScoredProductInsert } from './scorer.js';

export async function rankAndStore(
  batchId: string,
  scoredInserts: ScoredProductInsert[],
): Promise<number> {
  if (scoredInserts.length === 0) {
    logger.info({ batchId }, 'No scored products to rank');
    return 0;
  }

  // Sort by score descending, take top 50
  const ranked = [...scoredInserts]
    .sort((a, b) => parseFloat(b.score) - parseFloat(a.score))
    .slice(0, 50);

  let stored = 0;

  for (const item of ranked) {
    try {
      // UPSERT: update if raw_product_id exists, otherwise insert
      await db
        .insert(scoredProducts)
        .values({
          raw_product_id: item.raw_product_id,
          score: item.score,
          sales_velocity_score: item.sales_velocity_score,
          margin_score: item.margin_score,
          trend_score: item.trend_score,
          competition_score: item.competition_score,
          fulfillment_type: item.fulfillment_type,
          estimated_margin_pct: item.estimated_margin_pct,
          trend_keywords: item.trend_keywords,
          opportunity_reason: item.opportunity_reason,
          scored_at: new Date(),
          status: 'pending',
        })
        .onConflictDoUpdate({
          target: scoredProducts.raw_product_id,
          set: {
            score: item.score,
            sales_velocity_score: item.sales_velocity_score,
            margin_score: item.margin_score,
            trend_score: item.trend_score,
            competition_score: item.competition_score,
            fulfillment_type: item.fulfillment_type,
            estimated_margin_pct: item.estimated_margin_pct,
            trend_keywords: item.trend_keywords,
            opportunity_reason: item.opportunity_reason,
            scored_at: new Date(),
          },
        });

      stored++;
    } catch (err) {
      logger.error(
        { err, rawProductId: item.raw_product_id },
        'Failed to upsert scored product',
      );
    }
  }

  // Clean up: delete scored_products older than 30 days with status 'rejected'
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  try {
    const deleted = await db
      .delete(scoredProducts)
      .where(
        and(
          eq(scoredProducts.status, 'rejected'),
          lt(scoredProducts.scored_at, thirtyDaysAgo),
        ),
      );

    logger.info({ batchId }, 'Cleaned up old rejected scored products');
  } catch (err) {
    logger.error({ err }, 'Failed to clean up old scored products');
  }

  logger.info(
    { batchId, ranked: ranked.length, stored },
    'Rank and store complete',
  );

  return stored;
}
