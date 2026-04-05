import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';

export interface ScoringJobPayload {
  batch_id: string;
  scraper_name: string;
  products_found: number;
}

export const scoringConnection = new IORedis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  { maxRetriesPerRequest: null },
);

export const scoringQueue = new Queue<ScoringJobPayload>('scoring-jobs', {
  connection: scoringConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});
