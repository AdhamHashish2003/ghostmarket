import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { db, scrapeJobs, logger } from '@ghostmarket/shared';
import { addScraperJob, type ScraperName, type ScraperJobConfig } from './queue.js';

interface ScheduleEntry {
  scraperName: ScraperName;
  cron: string;
  config: ScraperJobConfig;
}

const SCHEDULE: ScheduleEntry[] = [
  {
    scraperName: 'scrape:google-trends',
    cron: '0 */2 * * *',
    config: { geo: 'US' },
  },
  {
    scraperName: 'scrape:aliexpress',
    cron: '0 */12 * * *',
    config: { max_pages: 10, categories: ['electronics', 'home', 'fashion'] },
  },
  {
    scraperName: 'scrape:amazon-trending',
    cron: '0 */6 * * *',
    config: { max_pages: 5, categories: ['movers-and-shakers', 'new-releases'] },
  },
  {
    scraperName: 'scrape:tiktok-shop',
    cron: '0 */4 * * *',
    config: { max_pages: 8, categories: ['trending'] },
  },
];

const cronJobs: CronJob[] = [];

async function enqueueScraperJob(entry: ScheduleEntry): Promise<void> {
  const { jobId, batchId } = await addScraperJob(entry.scraperName, entry.config);

  await db.insert(scrapeJobs).values({
    scraper_name: entry.scraperName,
    status: 'queued',
    batch_id: batchId,
  });

  logger.info(
    { scraperName: entry.scraperName, batchId, jobId },
    'Scheduled scraper job enqueued and DB record created',
  );
}

export function startScheduler(): void {
  for (const entry of SCHEDULE) {
    const job = new CronJob(entry.cron, () => {
      enqueueScraperJob(entry).catch((err) => {
        logger.error({ err, scraperName: entry.scraperName }, 'Failed to enqueue scheduled job');
      });
    });

    job.start();
    cronJobs.push(job);

    logger.info(
      { scraperName: entry.scraperName, cron: entry.cron },
      'Cron job registered',
    );
  }

  logger.info({ count: SCHEDULE.length }, 'Scheduler started — all cron jobs registered');
}

export async function runNow(scraperName: ScraperName, config?: ScraperJobConfig): Promise<string> {
  const entry = SCHEDULE.find((s) => s.scraperName === scraperName);
  const mergedConfig = { ...entry?.config, ...config };

  const { batchId } = await addScraperJob(scraperName, mergedConfig);

  await db.insert(scrapeJobs).values({
    scraper_name: scraperName,
    status: 'queued',
    batch_id: batchId,
  });

  logger.info({ scraperName, batchId }, 'Manual scraper run triggered');
  return batchId;
}

export function stopScheduler(): void {
  for (const job of cronJobs) {
    job.stop();
  }
  cronJobs.length = 0;
  logger.info('Scheduler stopped — all cron jobs cleared');
}
