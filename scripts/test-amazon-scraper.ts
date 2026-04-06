import { scrapeAmazonTrending } from '../packages/scrapers/src/scrapers/amazon-trending.js';

const batchId = `amazon-test-${Date.now()}`;

console.log(`\nStarting Amazon scraper test (batch: ${batchId})\n`);
console.log('Browser will open — watch it scrape!\n');

const result = await scrapeAmazonTrending(batchId, {
  max_pages: 1,
  categories: ['overall', 'electronics', 'home'],
});

console.log(`\nDone! Products found: ${result.productsFound}`);
console.log(`Batch ID: ${batchId}`);
process.exit(0);
