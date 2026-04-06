import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 }, locale: 'en-US', timezoneId: 'America/New_York',
});
await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
const page = await context.newPage();
await page.route('**/*.{woff,woff2,ttf,otf}', r => r.abort());

await page.goto('https://www.aliexpress.com/category/15/home-and-garden.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(6000);
try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}
for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(800); }
await page.waitForTimeout(3000);

// Dump FULL innerHTML of first card (up to 5000 chars)
// Wait for page to fully settle after redirect
await page.waitForTimeout(8000);
try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}
await page.screenshot({ path: '/tmp/scraper-errors/ali-debug2.png' });
console.log('URL:', page.url());
console.log('Title:', await page.title());

// Get all text on page containing $
const priceText = await page.evaluate('document.body.innerText.match(/\\$[\\d,.]+/g)?.slice(0,10) || []');
console.log('Price matches on page:', priceText);

// Count card selectors
const counts = await page.evaluate('JSON.stringify({cards: document.querySelectorAll(".search-item-card-wrapper-gallery").length, items: document.querySelectorAll("a[href*=\\"/item/\\"]").length})');
console.log('Selector counts:', counts);

await browser.close();
process.exit(0);
