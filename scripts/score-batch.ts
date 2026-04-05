import 'dotenv/config';
import { eq, and, sql, count } from 'drizzle-orm';
import { db, rawProducts, scoredProducts, pool } from '@ghostmarket/shared';
import { scoreProduct } from '../packages/scoring/src/scorer.js';
import { deduplicateProducts } from '../packages/scoring/src/deduplicator.js';
import { rankAndStore } from '../packages/scoring/src/ranker.js';

const batchId = process.argv[2];
if (!batchId) {
  // Find the most recent batch
  const latest = await db
    .select({ batch_id: rawProducts.batch_id, cnt: count() })
    .from(rawProducts)
    .groupBy(rawProducts.batch_id)
    .orderBy(sql`max(${rawProducts.scraped_at}) DESC`)
    .limit(1);

  if (latest.length === 0) {
    console.error('No batches found');
    process.exit(1);
  }
  console.log(`Using latest batch: ${latest[0].batch_id} (${latest[0].cnt} products)`);
  await run(latest[0].batch_id);
} else {
  await run(batchId);
}

async function run(batch: string) {
  console.log(`\n1. Deduplicating batch: ${batch}`);
  const dupes = await deduplicateProducts(batch);
  console.log(`   Duplicates found: ${dupes}`);

  console.log('\n2. Fetching non-duplicate products...');
  const products = await db
    .select()
    .from(rawProducts)
    .where(
      and(
        eq(rawProducts.batch_id, batch),
        sql`NOT (${rawProducts.tags}::jsonb ? 'duplicate')`,
      ),
    );
  console.log(`   Products to score: ${products.length}`);

  console.log('\n3. Scoring products...');
  const scored = [];
  for (const p of products) {
    const s = await scoreProduct(p);
    scored.push(s);
    console.log(`   ${p.title.slice(0, 50).padEnd(50)} → ${parseFloat(s.score).toFixed(1)} (sales=${s.sales_velocity_score} margin=${s.margin_score} trend=${s.trend_score} comp=${s.competition_score})`);
  }

  console.log('\n4. Ranking and storing top 50...');
  const stored = await rankAndStore(batch, scored);
  console.log(`   Stored: ${stored}`);

  // Show top 5
  const top = scored.sort((a, b) => parseFloat(b.score) - parseFloat(a.score)).slice(0, 5);
  console.log('\n=== TOP 5 PRODUCTS ===');
  for (const s of top) {
    const prod = products.find((p) => p.id === s.raw_product_id);
    console.log(`  Score: ${parseFloat(s.score).toFixed(1)} | ${prod?.title.slice(0, 60)} | $${prod?.price_usd} | ${s.fulfillment_type}`);
  }

  await pool.end();
  console.log('\nDone.');
}
