import 'dotenv/config';
import { eq, and, sql, desc } from 'drizzle-orm';
import { db, rawProducts, scoredProducts, pool, logger } from '@ghostmarket/shared';
import { scoreProduct } from '../packages/scoring/src/scorer.js';
import { deduplicateProducts } from '../packages/scoring/src/deduplicator.js';
import { rankAndStore } from '../packages/scoring/src/ranker.js';

async function main() {
  // Find all batch IDs
  const batches = await db
    .selectDistinct({ batch_id: rawProducts.batch_id })
    .from(rawProducts);

  console.log(`Found ${batches.length} batches to score`);

  for (const { batch_id } of batches) {
    console.log(`\nScoring batch: ${batch_id}`);

    // Step 1: Deduplicate
    const dupes = await deduplicateProducts(batch_id);
    console.log(`  Duplicates removed: ${dupes}`);

    // Step 2: Get non-duplicate products
    const products = await db
      .select()
      .from(rawProducts)
      .where(
        and(
          eq(rawProducts.batch_id, batch_id),
          sql`NOT (${rawProducts.tags}::jsonb ? 'duplicate')`,
        ),
      );

    console.log(`  Products to score: ${products.length}`);

    if (products.length === 0) continue;

    // Step 3: Score each product
    const scoredInserts = [];
    for (const product of products) {
      try {
        const scored = await scoreProduct(product);
        scoredInserts.push(scored);
      } catch (err) {
        console.error(`  Failed to score: ${product.title.slice(0, 50)}`, err);
      }
    }

    console.log(`  Scored: ${scoredInserts.length} products`);

    // Step 4: Rank and store
    const stored = await rankAndStore(batch_id, scoredInserts);
    console.log(`  Stored: ${stored} scored products`);

    if (scoredInserts.length > 0) {
      const topScore = Math.max(...scoredInserts.map((s) => parseFloat(s.score)));
      console.log(`  Top score: ${topScore.toFixed(3)}`);
    }
  }

  // Summary
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(scoredProducts);
  console.log(`\nTotal scored products: ${total[0].count}`);

  await pool.end();
  console.log('Scoring complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
