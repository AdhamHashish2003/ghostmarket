import { sql } from 'drizzle-orm';
import { gte, eq, and, desc } from 'drizzle-orm';
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { db, scrapeJobs, logger } from '@ghostmarket/shared';
import { scraperQueue, connection, SCRAPER_NAMES, type ScraperName } from './queue.js';
import { scoringQueue } from '@ghostmarket/scoring';
import { startScheduler, stopScheduler, runNow } from './scheduler.js';
import { startWorker, stopWorker } from './worker.js';

// --- Health check ---

export async function getFleetStatus() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [queueCounts, recentFailures, lastRuns] = await Promise.all([
    scraperQueue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
    db
      .select()
      .from(scrapeJobs)
      .where(
        and(
          eq(scrapeJobs.status, 'failed'),
          gte(scrapeJobs.created_at, twentyFourHoursAgo),
        ),
      ),
    db
      .select()
      .from(scrapeJobs)
      .where(eq(scrapeJobs.status, 'completed'))
      .orderBy(sql`completed_at DESC`)
      .limit(SCRAPER_NAMES.length),
  ]);

  const lastRunMap: Record<string, Date | null> = {};
  for (const name of SCRAPER_NAMES) {
    const run = lastRuns.find((r) => r.scraper_name === name);
    lastRunMap[name] = run?.completed_at ?? null;
  }

  return {
    registeredScrapers: [...SCRAPER_NAMES],
    lastRunTimes: lastRunMap,
    queueDepth: {
      active: queueCounts.active,
      waiting: queueCounts.waiting,
      delayed: queueCounts.delayed,
    },
    failedLast24h: recentFailures.length,
    failedJobs: recentFailures.map((j) => ({
      scraper: j.scraper_name,
      batchId: j.batch_id,
      error: j.error_message,
      at: j.created_at,
    })),
  };
}

// --- Bull Board dashboard ---

function startBullBoard(): number {
  const port = parseInt(process.env.PORT_BULL_BOARD ?? '3006', 10);

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/');

  createBullBoard({
    queues: [
      new BullMQAdapter(scraperQueue),
      new BullMQAdapter(scoringQueue),
    ],
    serverAdapter,
  });

  const app = express();
  app.use('/', serverAdapter.getRouter());

  app.listen(port, () => {
    logger.info({ port }, 'Bull Board dashboard running');
  });

  return port;
}

// --- API server ---

function startApiServer(): number {
  const port = parseInt(process.env.PORT_API ?? '3007', 10);
  const app = express();
  app.use(express.json());

  // POST /api/trigger/:scraperName — manually trigger a scraper
  app.post('/api/trigger/:scraperName', async (req, res) => {
    const scraperName = `scrape:${req.params.scraperName}` as ScraperName;

    if (!SCRAPER_NAMES.includes(scraperName)) {
      res.status(400).json({
        error: `Unknown scraper: "${req.params.scraperName}"`,
        available: SCRAPER_NAMES.map((n) => n.replace('scrape:', '')),
      });
      return;
    }

    try {
      const batchId = await runNow(scraperName, req.body.config);
      res.json({ ok: true, scraperName, batchId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, scraperName }, 'Manual trigger failed');
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/status — fleet status
  app.get('/api/status', async (_req, res) => {
    try {
      const status = await getFleetStatus();
      res.json(status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/jobs — recent jobs from all queues
  app.get('/api/jobs', async (_req, res) => {
    try {
      const scraperJobs = await scraperQueue.getJobs(['active', 'waiting', 'completed', 'failed', 'delayed'], 0, 50);
      const scoringJobs = await scoringQueue.getJobs(['active', 'waiting', 'completed', 'failed', 'delayed'], 0, 50);
      const dbJobs = await db
        .select()
        .from(scrapeJobs)
        .orderBy(desc(scrapeJobs.created_at))
        .limit(50);

      res.json({
        scraperQueue: scraperJobs.map((j) => ({
          id: j.id,
          name: j.name,
          data: j.data,
          state: j.returnvalue !== undefined ? 'completed' : j.failedReason ? 'failed' : 'active',
          timestamp: j.timestamp,
          processedOn: j.processedOn,
          finishedOn: j.finishedOn,
          failedReason: j.failedReason,
        })),
        scoringQueue: scoringJobs.map((j) => ({
          id: j.id,
          name: j.name,
          data: j.data,
          timestamp: j.timestamp,
          processedOn: j.processedOn,
          finishedOn: j.finishedOn,
          failedReason: j.failedReason,
        })),
        dbJobs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.listen(port, () => {
    logger.info({ port }, 'ScraperFleet API server running');
  });

  return port;
}

// --- Entry point ---

async function main() {
  logger.info('ScraperFleet starting...');

  startWorker();
  startScheduler();
  const boardPort = startBullBoard();
  const apiPort = startApiServer();

  logger.info(
    {
      scrapers: [...SCRAPER_NAMES],
      bullBoard: `:${boardPort}`,
      api: `:${apiPort}`,
    },
    'ScraperFleet online — 4 scrapers registered, Bull Board at :' +
      boardPort +
      ', API at :' +
      apiPort,
  );

  const shutdown = async () => {
    logger.info('Shutting down ScraperFleet...');
    stopScheduler();
    await stopWorker();
    await scraperQueue.close();
    await scoringQueue.close();
    await connection.quit();
    logger.info('ScraperFleet shut down cleanly');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'ScraperFleet fatal error');
  process.exit(1);
});
