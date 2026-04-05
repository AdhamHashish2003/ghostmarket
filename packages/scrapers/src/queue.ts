import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { logger } from '@ghostmarket/shared';

export const SCRAPER_NAMES = [
  'scrape:google-trends',
  'scrape:aliexpress',
  'scrape:amazon-trending',
  'scrape:tiktok-shop',
] as const;

export type ScraperName = (typeof SCRAPER_NAMES)[number];

export interface ScraperJobConfig {
  max_pages?: number;
  categories?: string[];
  geo?: string;
}

export interface ScraperJobPayload {
  scraper_name: ScraperName;
  batch_id: string;
  config: ScraperJobConfig;
}

export const connection = new IORedis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  { maxRetriesPerRequest: null },
);

export const scraperQueue = new Queue<ScraperJobPayload>('scraper-jobs', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export async function addScraperJob(
  scraperName: ScraperName,
  config: ScraperJobConfig = {},
): Promise<{ jobId: string; batchId: string }> {
  const batchId = `${scraperName}-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const job = await scraperQueue.add(scraperName, {
    scraper_name: scraperName,
    batch_id: batchId,
    config,
  });

  logger.info({ jobId: job.id, scraperName, batchId }, 'Scraper job added to queue');

  return { jobId: job.id!, batchId };
}
