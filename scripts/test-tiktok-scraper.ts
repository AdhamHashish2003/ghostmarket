import { scrapeTiktokShop } from '../packages/scrapers/src/scrapers/tiktok-shop.js';

const batchId = `tiktok-test-${Date.now()}`;
console.log(`\nStarting TikTok Shop scraper test (batch: ${batchId})\n`);

const result = await scrapeTiktokShop(batchId, { max_pages: 1 });

console.log(`\nDone! Products found: ${result.productsFound}`);
console.log(`Batch ID: ${batchId}`);
process.exit(0);
