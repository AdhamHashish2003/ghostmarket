import { Worker, Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, scrapeJobs, logger } from '@ghostmarket/shared';
import { connection, type ScraperJobPayload, type ScraperJobConfig } from './queue.js';
import { scoringQueue } from '@ghostmarket/scoring';
import { scrapeGoogleTrends } from './scrapers/google-trends.js';
import { scrapeAliexpress } from './scrapers/aliexpress.js';
import { scrapeAmazonTrending } from './scrapers/amazon-trending.js';
import { scrapeTiktokShop } from './scrapers/tiktok-shop.js';

async function runScraper(
  scraperName: string,
  batchId: string,
  config: ScraperJobConfig,
): Promise<{ productsFound: number }> {
  switch (scraperName) {
    case 'scrape:google-trends':
      return scrapeGoogleTrends(batchId, config);
    case 'scrape:aliexpress':
      return scrapeAliexpress(batchId, config);
    case 'scrape:amazon-trending':
      return scrapeAmazonTrending(batchId, config);
    case 'scrape:tiktok-shop':
      return scrapeTiktokShop(batchId, config);
    default:
      throw new Error(`Unknown scraper: "${scraperName}"`);
  }
}

async function processJob(job: Job<ScraperJobPayload>): Promise<void> {
  const { scraper_name, batch_id, config } = job.data;

  logger.info(
    { jobId: job.id, scraperName: scraper_name, batchId: batch_id },
    'Processing scraper job',
  );

  // Mark running in DB
  await db
    .update(scrapeJobs)
    .set({ status: 'running', started_at: new Date() })
    .where(eq(scrapeJobs.batch_id, batch_id));

  try {
    const result = await runScraper(scraper_name, batch_id, config);

    // Mark completed in DB
    await db
      .update(scrapeJobs)
      .set({
        status: 'completed',
        completed_at: new Date(),
        products_found: result.productsFound,
      })
      .where(eq(scrapeJobs.batch_id, batch_id));

    logger.info(
      { jobId: job.id, scraperName: scraper_name, batchId: batch_id, productsFound: result.productsFound },
      'Scraper job completed successfully',
    );

    // Enqueue scoring job so ScoringAgent picks up the new batch
    if (result.productsFound > 0) {
      await scoringQueue.add(`score:${batch_id}`, {
        batch_id,
        scraper_name,
        products_found: result.productsFound,
      });
      logger.info(
        { batchId: batch_id, productsFound: result.productsFound },
        'Scoring job enqueued',
      );
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db
      .update(scrapeJobs)
      .set({
        status: 'failed',
        completed_at: new Date(),
        error_message: errorMessage,
      })
      .where(eq(scrapeJobs.batch_id, batch_id));

    logger.error(
      { jobId: job.id, scraperName: scraper_name, batchId: batch_id, err: errorMessage },
      'Scraper job failed',
    );

    throw err;
  }
}

let worker: Worker<ScraperJobPayload> | null = null;

export function startWorker(): Worker<ScraperJobPayload> {
  worker = new Worker<ScraperJobPayload>('scraper-jobs', processJob, {
    connection,
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, scraperName: job.data.scraper_name }, 'Job marked complete by BullMQ');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, scraperName: job?.data.scraper_name, err: err.message },
      'Job marked failed by BullMQ',
    );
  });

  logger.info({ concurrency: 2 }, 'Worker started on "scraper-jobs" queue');
  return worker;
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Worker stopped');
  }
}
