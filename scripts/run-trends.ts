import 'dotenv/config';
import { scrapeGoogleTrends } from '../packages/scrapers/src/scrapers/google-trends.js';
import { pool } from '@ghostmarket/shared';

const batchId = `trends-${Date.now()}`;

async function main() {
  console.log(`Running Google Trends scraper with batch: ${batchId}`);
  const result = await scrapeGoogleTrends(batchId, { geo: 'US' });
  console.log(`Done — captured ${result.productsFound} trend signals`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
