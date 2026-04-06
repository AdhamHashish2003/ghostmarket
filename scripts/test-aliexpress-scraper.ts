import { scrapeAliexpress } from '../packages/scrapers/src/scrapers/aliexpress.js';

const batchId = `aliexpress-test-${Date.now()}`;

console.log(`\nStarting AliExpress scraper test (batch: ${batchId})\n`);

const result = await scrapeAliexpress(batchId, {
  max_pages: 1,
  categories: ['electronics', 'home'],
});

console.log(`\nDone! Products found: ${result.productsFound}`);
console.log(`Batch ID: ${batchId}`);
process.exit(0);
