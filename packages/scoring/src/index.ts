import { Worker, Job } from 'bullmq';
import { eq, and, not, sql } from 'drizzle-orm';
import { db, rawProducts, logger } from '@ghostmarket/shared';
import {
  scoringQueue,
  scoringConnection,
  type ScoringJobPayload,
} from './queue.js';
import { scoreProduct, type ScoredProductInsert } from './scorer.js';
import { deduplicateProducts } from './deduplicator.js';
import { rankAndStore } from './ranker.js';

export { scoringQueue, scoringConnection, type ScoringJobPayload } from './queue.js';

// --- Pipeline ---

async function runScoringPipeline(job: Job<ScoringJobPayload>): Promise<void> {
  const { batch_id, scraper_name, products_found } = job.data;

  logger.info(
    { batchId: batch_id, scraperName: scraper_name, productsFound: products_found },
    'Scoring pipeline starting',
  );

  // Step 1: Deduplicate
  const dupes = await deduplicateProducts(batch_id);

  // Step 2: Get all non-duplicate products from the batch
  const products = await db
    .select()
    .from(rawProducts)
    .where(
      and(
        eq(rawProducts.batch_id, batch_id),
        sql`NOT (${rawProducts.tags}::jsonb ? 'duplicate')`,
      ),
    );

  if (products.length === 0) {
    logger.warn({ batchId: batch_id }, 'No products to score after deduplication');
    return;
  }

  logger.info(
    { batchId: batch_id, toScore: products.length },
    'Scoring products',
  );

  // Step 3: Score each product
  const scoredInserts: ScoredProductInsert[] = [];

  for (const product of products) {
    try {
      const scored = await scoreProduct(product);
      scoredInserts.push(scored);
    } catch (err) {
      logger.error(
        { err, productId: product.id, title: product.title.slice(0, 60) },
        'Failed to score product',
      );
    }
  }

  // Step 4: Rank and store top 50
  const stored = await rankAndStore(batch_id, scoredInserts);

  // Find top score
  const topScore = scoredInserts.length > 0
    ? Math.max(...scoredInserts.map((s) => parseFloat(s.score)))
    : 0;

  logger.info(
    {
      batchId: batch_id,
      scored: scoredInserts.length,
      duplicatesRemoved: dupes,
      stored,
      topScore: topScore.toFixed(3),
    },
    `Scored ${scoredInserts.length} products, ${dupes} duplicates removed, top score: ${topScore.toFixed(3)}`,
  );
}

// --- Worker ---

let worker: Worker<ScoringJobPayload> | null = null;

export function startScoringWorker(): Worker<ScoringJobPayload> {
  worker = new Worker<ScoringJobPayload>('scoring-jobs', runScoringPipeline, {
    connection: scoringConnection,
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, batchId: job.data.batch_id },
      'Scoring job completed',
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, batchId: job?.data.batch_id, err: err.message },
      'Scoring job failed',
    );
  });

  logger.info('ScoringAgent worker started on "scoring-jobs" queue');
  return worker;
}

export async function stopScoringWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('ScoringAgent worker stopped');
  }
}

// --- Entry point ---

async function main() {
  logger.info('ScoringAgent starting...');

  startScoringWorker();

  logger.info('ScoringAgent online — listening for scoring jobs');

  const shutdown = async () => {
    logger.info('Shutting down ScoringAgent...');
    await stopScoringWorker();
    await scoringQueue.close();
    await scoringConnection.quit();
    logger.info('ScoringAgent shut down cleanly');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'ScoringAgent fatal error');
  process.exit(1);
});
