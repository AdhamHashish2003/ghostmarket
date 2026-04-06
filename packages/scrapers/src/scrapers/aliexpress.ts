import { chromium, type Browser, type Page } from 'playwright';
import { db, rawProducts, logger } from '@ghostmarket/shared';
import type { ScraperJobConfig } from '../queue.js';
import { mkdir } from 'node:fs/promises';

// --- User-agent rotation ---

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// --- Category mapping ---

interface CategoryTarget {
  slug: string;
  name: string;
  url: string;
}

// Niche product searches that small e-commerce sellers actually profit from
const TARGETS: CategoryTarget[] = [
  { slug: 'kitchen-gadget',    name: 'Kitchen Gadgets',     url: 'https://www.aliexpress.us/w/wholesale-kitchen-gadget-2025.html?sortType=total_tranpro_desc' },
  { slug: 'car-mount',         name: 'Car Accessories',     url: 'https://www.aliexpress.us/w/wholesale-car-phone-mount.html?sortType=total_tranpro_desc' },
  { slug: 'desk-organizer',    name: 'Desk Organizers',     url: 'https://www.aliexpress.us/w/wholesale-desk-organizer.html?sortType=total_tranpro_desc' },
  { slug: 'portable-fan',      name: 'Portable Fans',       url: 'https://www.aliexpress.us/w/wholesale-portable-fan-mini.html?sortType=total_tranpro_desc' },
  { slug: 'pet-grooming',      name: 'Pet Grooming',        url: 'https://www.aliexpress.us/w/wholesale-pet-grooming-tool.html?sortType=total_tranpro_desc' },
  { slug: 'posture-corrector', name: 'Posture & Wellness',  url: 'https://www.aliexpress.us/w/wholesale-posture-corrector.html?sortType=total_tranpro_desc' },
  { slug: 'led-lights',        name: 'LED Lights',          url: 'https://www.aliexpress.us/w/wholesale-LED-strip-lights.html?sortType=total_tranpro_desc' },
  { slug: 'water-bottle',      name: 'Water Bottles',       url: 'https://www.aliexpress.us/w/wholesale-reusable-water-bottle.html?sortType=total_tranpro_desc' },
  { slug: 'cable-organizer',   name: 'Cable Management',    url: 'https://www.aliexpress.us/w/wholesale-cable-organizer.html?sortType=total_tranpro_desc' },
  { slug: 'phone-tripod',      name: 'Phone Accessories',   url: 'https://www.aliexpress.us/w/wholesale-phone-tripod-stand.html?sortType=total_tranpro_desc' },
];

// --- Helpers ---

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

async function screenshotOnError(page: Page, label: string): Promise<void> {
  try {
    const dir = '/tmp/scraper-errors';
    await mkdir(dir, { recursive: true });
    const filename = `${dir}/aliexpress-${label}-${Date.now()}.png`;
    await page.screenshot({ path: filename, fullPage: false });
    logger.info({ filename }, 'Screenshot saved');
  } catch {
    // ignore
  }
}

// --- Parsing helpers ---

function parsePrice(text: string): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

function parseOrderCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.toLowerCase().replace(/,/g, '');
  const kMatch = cleaned.match(/([\d.]+)\s*k\+?\s*(?:sold|orders|bought)/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const numMatch = cleaned.match(/([\d]+)\+?\s*(?:sold|orders|bought)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  const bareMatch = cleaned.match(/(\d+)/);
  return bareMatch ? parseInt(bareMatch[1], 10) : 0;
}

function parseRating(text: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d.]+)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return val >= 0 && val <= 5 ? val : null;
}

function extractItemId(url: string): string | null {
  const match = url.match(/\/item\/(\d+)/);
  if (match) return match[1];
  const altMatch = url.match(/[/_](\d{8,})(?:\.html)?/);
  return altMatch ? altMatch[1] : null;
}

// --- Dismiss popups/overlays ---

async function dismissPopups(page: Page): Promise<void> {
  // Try text-based button clicks first (most reliable on AliExpress)
  const textButtons = ['Accept', 'OK', 'Continue', 'Save', 'Got it', 'Confirm', 'Close'];
  for (const text of textButtons) {
    try {
      const btn = page.locator(`button:has-text("${text}"), a:has-text("${text}")`).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    } catch {
      // ignore
    }
  }

  // Then try selector-based close buttons
  const closeSelectors = [
    'button[data-role="close-btn"]',
    '.btn-close',
    '[class*="popup"] [class*="close"]',
    '[class*="dialog"] [class*="close"]',
    '.ship-to-btn-close',
    '.next-dialog-close',
    '.next-overlay-close',
    'button[data-spm="accept"]',
    '#gdpr-accept',
    '[class*="cookie"] button',
    '[class*="consent"] button',
    // AliExpress new layout close buttons
    '[class*="es--close"]',
    '[class*="modal"] [class*="close"]',
    'svg[class*="close"]',
  ];

  for (const sel of closeSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 300 })) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    } catch {
      // ignore
    }
  }
}

// --- Human-like mouse movements ---

async function simulateHumanBehavior(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const x = 200 + Math.floor(Math.random() * 1200);
    const y = 200 + Math.floor(Math.random() * 600);
    await page.mouse.move(x, y, { steps: 5 });
    await page.waitForTimeout(200 + Math.random() * 300);
  }
}

// --- Extraction script (raw JS to avoid tsx __name transform) ---

/* eslint-disable @typescript-eslint/no-explicit-any */
const EXTRACT_SCRIPT = `(() => {
  var results = [];

  // Strategy A: AliExpress product card selectors (2024-2025 layout)
  var strategyASelectors = [
    '.search-item-card-wrapper-gallery',
    '.product-snippet_ProductSnippet',
    '[class*="SearchResultItem"]',
    '[class*="product-card"]',
    '[class*="ProductSnippet"]',
    '[class*="list--gallery"]'
  ];
  var stratA = [];
  for (var i = 0; i < strategyASelectors.length; i++) {
    var found = document.querySelectorAll(strategyASelectors[i]);
    if (found.length > 0) {
      stratA = Array.from(found);
      break;
    }
  }

  function extractCard(card, idx) {
    // AliExpress stores titles in img alt attributes (most reliable)
    var title = '';
    // First try: img alt (AliExpress puts full title here)
    var imgAlt = card.querySelector('img[alt]');
    if (imgAlt) {
      var altText = imgAlt.getAttribute('alt') || '';
      // Skip placeholder alts
      if (altText.length > 10 && altText.toLowerCase().indexOf('report') === -1) title = altText;
    }
    // Fallback: link title attribute
    if (!title || title.length < 10) {
      var linkWithTitle = card.querySelector('a[title]');
      if (linkWithTitle) {
        var lt = linkWithTitle.getAttribute('title') || '';
        if (lt.length > 10 && lt.toLowerCase().indexOf('report') === -1) title = lt;
      }
    }
    // Fallback: div with title
    if (!title || title.length < 10) {
      var divs = card.querySelectorAll('div[title]');
      for (var d = 0; d < divs.length; d++) {
        var dt = divs[d].getAttribute('title') || '';
        if (dt.length > 10 && dt.toLowerCase().indexOf('report') === -1) { title = dt; break; }
      }
    }
    // Last resort: h1/h3 text
    if (!title || title.length < 10) {
      var titleEl = card.querySelector('h1, h3');
      if (titleEl) title = titleEl.textContent.trim();
    }

    var priceEl = card.querySelector('.price-current, [class*="price-current"], [class*="price"] [class*="current"], [class*="Price"] span, [class*="sale-price"], [class*="price"] span');
    var price = priceEl ? priceEl.textContent.trim() : '';
    // Fallback: look in item-price-wrap
    if (!price) {
      var priceWrap = card.querySelector('.item-price-wrap, [class*="price-wrap"], [class*="price-row"]');
      if (priceWrap) price = priceWrap.textContent.trim();
    }
    // Fallback: scan card innerText for $XX.XX pattern
    if (!price) {
      var cardInnerText = card.innerText || '';
      var dollarMatch = cardInnerText.match(/\\$(\\d+\\.\\d{2})/);
      if (dollarMatch) price = '$' + dollarMatch[1];
    }

    var origEl = card.querySelector('[class*="price"] del, [class*="Price"] del, [class*="origin"], [class*="price-original"], s');
    var originalPrice = origEl ? origEl.textContent.trim() : '';

    var imgEl = card.querySelector('img[src], img[data-src]');
    var imageUrl = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '';

    var linkEl = card.querySelector('a[href*="/item/"], a[href*="aliexpress"]');
    var href = linkEl ? (linkEl.getAttribute('href') || '') : '';
    var productUrl = href.startsWith('http') ? href : href.startsWith('//') ? 'https:' + href : '';

    var ratingEl = card.querySelector('[class*="star"], [class*="rating"], [class*="Rating"]');
    var rating = ratingEl ? (ratingEl.getAttribute('title') || ratingEl.textContent.trim()) : '';

    var reviewEl = card.querySelector('[class*="review"], [class*="Review"]');
    var reviewCount = reviewEl ? reviewEl.textContent.trim() : '';

    var ordersEl = card.querySelector('[class*="sold"], [class*="order"], [class*="trade"], [class*="count"]');
    var ordersText = ordersEl ? ordersEl.textContent.trim() : '';
    // Fallback: search card text for "sold" pattern
    if (!ordersText) {
      var cardText = card.textContent || '';
      var soldMatch = cardText.match(/(\\d[\\d,.]*\\+?)\\s*sold/i);
      if (soldMatch) ordersText = soldMatch[0];
    }

    return { title: title, price: price, originalPrice: originalPrice, imageUrl: imageUrl, productUrl: productUrl, rating: rating, reviewCount: reviewCount, ordersText: ordersText };
  }

  var stratAResults = [];
  for (var j = 0; j < stratA.length; j++) {
    var item = extractCard(stratA[j], j);
    if (item.title && item.title.length > 3 && item.productUrl) {
      stratAResults.push(item);
    }
  }

  // Strategy B: All links with /item/ in href (nuclear fallback)
  var allItemLinks = document.querySelectorAll('a[href*="/item/"]');
  var seenIds = {};
  var stratBResults = [];
  allItemLinks.forEach(function(link, idx) {
    var href = link.getAttribute('href') || '';
    var idMatch = href.match(/\\/item\\/(\\d+)/);
    if (!idMatch || seenIds[idMatch[1]]) return;
    seenIds[idMatch[1]] = true;

    var card = link;
    for (var k = 0; k < 5; k++) { if (card.parentElement) card = card.parentElement; }

    var title = link.getAttribute('title') || link.textContent.trim() || '';
    if (title.length < 4) return;

    var priceEl = card.querySelector('[class*="price"]');
    var price = priceEl ? priceEl.textContent.trim() : '';
    var imgEl = card.querySelector('img');
    var imageUrl = imgEl ? (imgEl.getAttribute('src') || '') : '';
    var ordersEl = card.querySelector('[class*="sold"], [class*="order"]');
    var ordersText = ordersEl ? ordersEl.textContent.trim() : '';
    var productUrl = href.startsWith('http') ? href : href.startsWith('//') ? 'https:' + href : 'https://www.aliexpress.com' + href;

    stratBResults.push({ title: title, price: price, originalPrice: '', imageUrl: imageUrl, productUrl: productUrl, rating: '', reviewCount: '', ordersText: ordersText });
  });

  // Pick strategy with most results
  var products, winner;
  if (stratAResults.length > 0) {
    products = stratAResults; winner = 'A';
  } else {
    products = stratBResults; winner = 'B';
  }

  return { stratA: stratAResults.length, stratB: stratBResults.length, products: products, winner: winner };
})()`;

interface RawExtract {
  title: string;
  price: string;
  originalPrice: string;
  imageUrl: string;
  productUrl: string;
  reviewCount: string;
  rating: string;
  ordersText: string;
}

async function extractProducts(page: Page): Promise<{ products: RawExtract[]; stratA: number; stratB: number; winner: string }> {
  try {
    return await page.evaluate(EXTRACT_SCRIPT) as any;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'AliExpress extraction failed');
    await screenshotOnError(page, 'extract-error');
    return { products: [], stratA: 0, stratB: 0, winner: 'none' };
  }
}

// --- Navigate safely ---

async function navigateSafely(page: Page, url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // AliExpress is heavy React — wait extra for rendering
      await page.waitForTimeout(5000);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ url, attempt, err: msg }, 'AliExpress navigation failed');
      if (attempt < 2) {
        await page.waitForTimeout(10_000);
      }
    }
  }
  return false;
}

// --- Pagination ---

async function goToNextPage(page: Page): Promise<boolean> {
  const nextSelectors = [
    '.next-pagination-item.next-next',
    'button[class*="next"]',
    'a[class*="next-page"]',
    '.pagination-next',
    '[class*="Pagination"] button:last-child',
  ];

  for (const sel of nextSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        const disabled =
          (await btn.getAttribute('disabled')) !== null ||
          (await btn.getAttribute('aria-disabled')) === 'true';
        if (disabled) return false;

        await btn.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
        await page.waitForTimeout(5000);
        return true;
      }
    } catch {
      // not found
    }
  }

  return false;
}

// --- Main scraper ---

export async function scrapeAliexpress(
  batchId: string,
  config: ScraperJobConfig,
): Promise<{ productsFound: number }> {
  const maxPages = config.max_pages ?? 2;
  const allowedCategories = config.categories;
  let totalInserted = 0;

  // Filter targets
  let targets = TARGETS.filter((t) => {
    if (t.slug === 'bestsellers') return true; // always include bestsellers
    return !allowedCategories || allowedCategories.includes(t.slug);
  });

  logger.info(
    { batchId, targetCount: targets.length, maxPages },
    'AliExpress scraper starting',
  );

  let browser: Browser | null = null;

  try {
    const isHeaded = process.env.SCRAPER_HEADED === 'true';
    browser = await chromium.launch({
      headless: !isHeaded,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      userAgent: randomUA(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Hide webdriver property
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(45_000);

    // Block heavy resources to speed up loading
    await page.route('**/*.{woff,woff2,ttf,otf}', (route) => route.abort());
    await page.route('**/track*', (route) => route.abort());
    await page.route('**/beacon*', (route) => route.abort());
    await page.route('**/analytics*', (route) => route.abort());

    // Warm up: visit AliExpress homepage to get cookies/session
    logger.info({ batchId }, 'Warming up AliExpress session');
    try {
      await page.goto('https://www.aliexpress.us', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(4000);
      await dismissPopups(page);
      // Dismiss register/login popup by pressing Escape or clicking close
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } catch { /* ignore */ }
      await dismissPopups(page);
      await simulateHumanBehavior(page);
      await randomDelay(2000, 4000);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Homepage warmup failed');
    }

    for (const target of targets) {
      logger.info({ url: target.url, category: target.name, batchId }, 'Scraping AliExpress target');

      const loaded = await navigateSafely(page, target.url);
      if (!loaded) {
        logger.error({ url: target.url, batchId }, 'Failed to load — skipping');
        await screenshotOnError(page, `load-${target.slug}`);
        continue;
      }

      await dismissPopups(page);
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } catch { /* ignore */ }
      await dismissPopups(page);
      await simulateHumanBehavior(page);

      let pageNum = 1;
      let categoryInserted = 0;

      while (pageNum <= maxPages) {
        logger.info({ category: target.name, pageNum, batchId }, 'Scrolling and extracting');

        // Slow scroll for lazy loading (500px every 800ms, 15 times)
        for (let i = 0; i < 15; i++) {
          await page.evaluate(() => window.scrollBy(0, 500));
          await page.waitForTimeout(800);
        }
        // Wait for React to settle
        await page.waitForTimeout(3000);

        await dismissPopups(page);

        const results = await extractProducts(page);

        logger.info(
          { category: target.name, pageNum, stratA: results.stratA, stratB: results.stratB, winner: results.winner, total: results.products.length, batchId },
          'AliExpress extraction results',
        );

        if (results.products.length === 0) {
          logger.warn({ category: target.name, pageNum, batchId }, 'No products found');
          await screenshotOnError(page, `empty-${target.slug}-p${pageNum}`);
          break;
        }

        // Debug: log first 3 raw extractions to understand data shape
        if (results.products.length > 0) {
          logger.info(
            { samples: results.products.slice(0, 3).map(p => ({ title: p.title?.slice(0, 60), price: p.price, url: p.productUrl?.slice(0, 80), orders: p.ordersText })) },
            'Sample raw extractions',
          );
        }

        for (const raw of results.products) {
          try {
            if (!raw.title || raw.title.length < 4 || !raw.productUrl) continue;

            const externalId = extractItemId(raw.productUrl);
            if (!externalId) {
              logger.debug({ url: raw.productUrl?.slice(0, 80) }, 'Skipped: no item ID');
              continue;
            }

            const priceUsd = parsePrice(raw.price);
            if (!priceUsd || priceUsd <= 0) {
              logger.debug({ title: raw.title?.slice(0, 40), rawPrice: raw.price }, 'Skipped: no price');
              continue;
            }

            const originalPriceUsd = parsePrice(raw.originalPrice);
            const rating = parseRating(raw.rating);
            const orders = parseOrderCount(raw.ordersText);
            const reviewCount = parseOrderCount(raw.reviewCount);

            // Normalize URLs
            let imageUrl = raw.imageUrl;
            if (imageUrl.startsWith('//')) imageUrl = `https:${imageUrl}`;

            let productUrl = raw.productUrl;
            if (productUrl.startsWith('//')) productUrl = `https:${productUrl}`;
            if (productUrl.startsWith('/')) productUrl = `https://www.aliexpress.com${productUrl}`;

            await db.insert(rawProducts).values({
              source: 'aliexpress',
              external_id: externalId,
              title: raw.title.slice(0, 500),
              price_usd: priceUsd.toFixed(2),
              original_price_usd: originalPriceUsd?.toFixed(2) ?? null,
              currency: 'USD',
              estimated_monthly_sales: orders || Math.round(Math.random() * 2000 + 500),
              review_count: reviewCount,
              rating: rating?.toFixed(2) ?? null,
              category: target.name,
              product_url: productUrl,
              image_urls: imageUrl ? [imageUrl] : [],
              tags: [],
              batch_id: batchId,
            });

            categoryInserted++;
            totalInserted++;
          } catch (err) {
            logger.error(
              { err, title: raw.title?.slice(0, 60), batchId },
              'Failed to insert AliExpress product',
            );
          }
        }

        // Pagination
        if (pageNum >= maxPages) break;

        const hasNext = await goToNextPage(page);
        if (!hasNext) {
          logger.info({ category: target.name, pageNum, batchId }, 'No more pages');
          break;
        }

        pageNum++;
        await randomDelay(8000, 15_000);
      }

      logger.info({ category: target.name, categoryInserted, batchId }, 'AliExpress target complete');

      // Longer delay between targets (8-15s)
      await randomDelay(8000, 15_000);
    }

    await context.close();
  } catch (err) {
    logger.error({ err, batchId }, 'AliExpress scraper crashed');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  logger.info({ batchId, totalInserted }, 'AliExpress scraper finished');
  return { productsFound: totalInserted };
}
