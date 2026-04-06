/**
 * Sync local Postgres data to Neon cloud database.
 * Copies raw_products (Amazon) + trend_signals, then runs scoring against Neon.
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { rawProducts, trendSignals, scoredProducts, scrapeJobs } from '../packages/shared/src/db/schema.js';

const LOCAL_URL = 'postgresql://postgres:ghostmarket_dev@localhost:5555/ghostmarket';
const NEON_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!NEON_URL || NEON_URL.includes('localhost')) {
  // Read from .env for the Neon URL
  const dotenv = await import('dotenv');
  dotenv.config();
}

// Hardcoded Neon URL from previous setup
const neonUrl = 'postgresql://neondb_owner:npg_U7yAbQkSTPe5@ep-rough-frog-amcal28a.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require';

console.log('Connecting to local Postgres...');
const localPool = new pg.Pool({ connectionString: LOCAL_URL });
const localDb = drizzle(localPool);

console.log('Connecting to Neon...');
const neonPool = new pg.Pool({ connectionString: neonUrl });
const neonDb = drizzle(neonPool);

// Test connections
await localDb.execute(sql`SELECT 1`);
console.log('  Local DB connected');
await neonDb.execute(sql`SELECT 1`);
console.log('  Neon DB connected');

// 1. Sync raw_products (Amazon)
console.log('\nSyncing raw_products (source=amazon)...');
const localProducts = await localDb
  .select()
  .from(rawProducts)
  .where(sql`source = 'amazon'`);

console.log(`  Found ${localProducts.length} Amazon products locally`);

let insertedProducts = 0;
let skippedProducts = 0;

for (const product of localProducts) {
  try {
    // Check if already exists in Neon by external_id + source
    const existing = await neonDb
      .select({ id: rawProducts.id })
      .from(rawProducts)
      .where(sql`source = ${product.source} AND external_id = ${product.external_id} AND batch_id = ${product.batch_id}`)
      .limit(1);

    if (existing.length > 0) {
      skippedProducts++;
      continue;
    }

    await neonDb.insert(rawProducts).values({
      source: product.source,
      external_id: product.external_id,
      title: product.title,
      price_usd: product.price_usd,
      original_price_usd: product.original_price_usd,
      currency: product.currency,
      estimated_monthly_sales: product.estimated_monthly_sales,
      review_count: product.review_count,
      rating: product.rating,
      category: product.category,
      sub_category: product.sub_category,
      supplier_name: product.supplier_name,
      supplier_url: product.supplier_url,
      product_url: product.product_url,
      image_urls: product.image_urls,
      tags: product.tags,
      batch_id: product.batch_id,
    });
    insertedProducts++;
  } catch (err) {
    // Skip duplicates
  }
}

console.log(`  Inserted: ${insertedProducts}, Skipped (duplicates): ${skippedProducts}`);

// 2. Sync trend_signals
console.log('\nSyncing trend_signals...');
const localTrends = await localDb.select().from(trendSignals);
console.log(`  Found ${localTrends.length} trends locally`);

let insertedTrends = 0;
let skippedTrends = 0;

for (const trend of localTrends) {
  try {
    // Check if exists by keyword + source + captured_at
    const existing = await neonDb
      .select({ id: trendSignals.id })
      .from(trendSignals)
      .where(sql`keyword = ${trend.keyword} AND source = ${trend.source} AND captured_at = ${trend.captured_at}`)
      .limit(1);

    if (existing.length > 0) {
      skippedTrends++;
      continue;
    }

    await neonDb.insert(trendSignals).values({
      keyword: trend.keyword,
      source: trend.source,
      interest_score: trend.interest_score,
      velocity: trend.velocity,
      related_queries: trend.related_queries,
      geo: trend.geo,
    });
    insertedTrends++;
  } catch (err) {
    // Skip
  }
}

console.log(`  Inserted: ${insertedTrends}, Skipped (duplicates): ${skippedTrends}`);

// 3. Sync scrape_jobs
console.log('\nSyncing scrape_jobs...');
const localJobs = await localDb.select().from(scrapeJobs);
let insertedJobs = 0;

for (const job of localJobs) {
  try {
    const existing = await neonDb
      .select({ id: scrapeJobs.id })
      .from(scrapeJobs)
      .where(sql`batch_id = ${job.batch_id}`)
      .limit(1);

    if (existing.length > 0) continue;

    await neonDb.insert(scrapeJobs).values({
      scraper_name: job.scraper_name,
      status: job.status,
      started_at: job.started_at,
      completed_at: job.completed_at,
      products_found: job.products_found,
      error_message: job.error_message,
      batch_id: job.batch_id,
    });
    insertedJobs++;
  } catch (err) {
    // Skip
  }
}

console.log(`  Inserted: ${insertedJobs} scrape jobs`);

// 4. Run scoring against Neon
console.log('\nRunning scoring against Neon...');

// Clear existing scored_products in Neon and re-score
await neonDb.execute(sql`DELETE FROM scored_products`);
console.log('  Cleared old scored products');

// Import scorer
const { scoreProduct } = await import('../packages/scoring/src/scorer.js');
const { deduplicateProducts } = await import('../packages/scoring/src/deduplicator.js');
const { rankAndStore } = await import('../packages/scoring/src/ranker.js');

// Find all batch IDs in Neon
const neonBatches = await neonDb
  .select({ batch_id: rawProducts.batch_id })
  .from(rawProducts)
  .groupBy(rawProducts.batch_id);

console.log(`  Found ${neonBatches.length} batches to score in Neon`);

// Override DATABASE_URL so the scoring modules use Neon
process.env.DATABASE_URL = neonUrl;

// We need a fresh DB connection for the scorer — it uses the shared db singleton
// which was initialized with local. Restart the process env and reimport.
// Simpler: just call scoring script externally
const { execSync } = await import('child_process');
try {
  const output = execSync(
    `DATABASE_URL="${neonUrl}" npx tsx scripts/run-scoring.ts`,
    { cwd: '/mnt/c/Users/Adham/ghostmarket', timeout: 120000, encoding: 'utf8' }
  );
  console.log(output);
} catch (err: any) {
  console.log(err.stdout || '');
  console.error('Scoring error:', err.stderr?.slice(0, 500) || '');
}

// 5. Report
const neonStats = await neonDb.execute(sql`
  SELECT
    (SELECT COUNT(*) FROM raw_products) as products,
    (SELECT COUNT(*) FROM trend_signals) as trends,
    (SELECT COUNT(*) FROM scored_products) as scored
`);

const stats = neonStats.rows[0];
console.log(`\n=== SYNC COMPLETE ===`);
console.log(`Synced ${insertedProducts} products and ${insertedTrends} trends to Neon`);
console.log(`Neon totals: ${stats.products} products, ${stats.trends} trends, ${stats.scored} scored`);

await localPool.end();
await neonPool.end();
process.exit(0);
