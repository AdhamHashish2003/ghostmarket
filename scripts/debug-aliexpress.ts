import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = await context.newPage();
await page.route('**/*.{woff,woff2,ttf,otf}', r => r.abort());

console.log('Loading AliExpress category page...');
await page.goto('https://www.aliexpress.com/category/44/consumer-electronics.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(5000);

// Dismiss popups
try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}

// Scroll to load products
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(800);
}
await page.waitForTimeout(3000);

// Dump first product card HTML
const cardHtml = await page.evaluate(`(() => {
  // Try to find product cards
  var selectors = ['.search-item-card-wrapper-gallery', '[class*="product-card"]', '[class*="ProductSnippet"]', 'a[href*="/item/"]'];
  for (var i = 0; i < selectors.length; i++) {
    var found = document.querySelectorAll(selectors[i]);
    if (found.length > 0) {
      return {
        selector: selectors[i],
        count: found.length,
        firstCardHtml: found[0].outerHTML.substring(0, 3000),
        secondCardHtml: found.length > 1 ? found[1].outerHTML.substring(0, 3000) : '',
        // Try to find ANY price elements on the page
        priceElements: Array.from(document.querySelectorAll('[class*="price"], [class*="Price"]')).slice(0, 5).map(function(el) {
          return { tag: el.tagName, class: el.className.substring(0, 100), text: el.textContent.trim().substring(0, 50) };
        }),
      };
    }
  }
  return { error: 'No cards found', bodyLength: document.body.innerHTML.length };
})()`);

console.log('\n=== CARD HTML DEBUG ===\n');
console.log(JSON.stringify(cardHtml, null, 2));

await page.screenshot({ path: '/tmp/scraper-errors/aliexpress-debug.png' });
console.log('\nScreenshot saved to /tmp/scraper-errors/aliexpress-debug.png');

await browser.close();
process.exit(0);
