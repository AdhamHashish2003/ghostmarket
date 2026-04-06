import 'dotenv/config';
import { db, rawProducts, pool } from '@ghostmarket/shared';
import { scoreProduct } from '../packages/scoring/src/scorer.js';

const products = await db.select().from(rawProducts).limit(3);
for (const p of products) {
  console.log(`\n--- ${p.title.slice(0, 60)} ---`);
  const result = await scoreProduct(p);
  if (result) {
    console.log(`Score: ${result.score}`);
    console.log(`Trend KW: ${result.trend_keywords}`);
    console.log(`Reason: "${result.opportunity_reason}"`);
  } else {
    console.log('FILTERED OUT');
  }
}
await pool.end();
process.exit(0);
