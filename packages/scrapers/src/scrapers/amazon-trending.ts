import { chromium, type Browser, type Page } from 'playwright';
import { db, rawProducts, logger } from '@ghostmarket/shared';
import type { ScraperJobConfig } from '../queue.js';
import { mkdir } from 'node:fs/promises';

// --- User-agent rotation ---

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/110.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// --- Constants ---

const BASE_URL = 'https://www.amazon.com';

interface AmazonTarget {
  slug: string;
  name: string;
  url: string;
  type: 'bestsellers' | 'movers' | 'new-releases';
}

const BESTSELLER_CATEGORIES: AmazonTarget[] = [
  { slug: 'overall',     name: 'Overall Best Sellers',  url: `${BASE_URL}/gp/bestsellers/`,              type: 'bestsellers' },
  { slug: 'electronics', name: 'Electronics',           url: `${BASE_URL}/gp/bestsellers/electronics/`,  type: 'bestsellers' },
  { slug: 'home',        name: 'Home & Kitchen',        url: `${BASE_URL}/gp/bestsellers/home-garden/`,  type: 'bestsellers' },
  { slug: 'sports',      name: 'Sports & Outdoors',     url: `${BASE_URL}/gp/bestsellers/sporting-goods/`, type: 'bestsellers' },
  { slug: 'toys',        name: 'Toys & Games',          url: `${BASE_URL}/gp/bestsellers/toys-and-games/`, type: 'bestsellers' },
  { slug: 'beauty',      name: 'Beauty & Personal Care', url: `${BASE_URL}/gp/bestsellers/beauty/`,       type: 'bestsellers' },
  { slug: 'fashion',     name: 'Fashion',               url: `${BASE_URL}/gp/bestsellers/fashion/`,      type: 'bestsellers' },
];

const MOVERS_TARGETS: AmazonTarget[] = [
  { slug: 'movers',       name: 'Movers & Shakers',     url: `${BASE_URL}/gp/moversandshakers/`,         type: 'movers' },
];

const NEW_RELEASES_TARGETS: AmazonTarget[] = [
  { slug: 'new-releases', name: 'New Releases',         url: `${BASE_URL}/gp/new-releases/`,             type: 'new-releases' },
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
    const filename = `${dir}/amazon-${label}-${Date.now()}.png`;
    await page.screenshot({ path: filename, fullPage: false });
    logger.info({ filename }, 'Error screenshot saved');
  } catch {
    // Don't let screenshot failures cascade
  }
}

// --- CAPTCHA detection ---

async function isCaptchaPage(page: Page): Promise<boolean> {
  const indicators = await page.evaluate(() => {
    // Check for CAPTCHA form elements (most reliable signal)
    const hasCaptchaForm =
      !!document.querySelector('form[action*="validateCaptcha"]') ||
      !!document.querySelector('#captchacharacters') ||
      !!document.querySelector('input[name="field-keywords"][placeholder*="characters"]');

    // Only check page title / h4 text — NOT full body text (too many false positives from product names containing "robot")
    const title = document.title?.toLowerCase() ?? '';
    const headings = Array.from(document.querySelectorAll('h4, p.a-last')).map(el => el.textContent?.toLowerCase() ?? '');
    const headerText = headings.join(' ');

    const hasCaptchaText =
      title.includes('robot check') ||
      headerText.includes('enter the characters you see below') ||
      headerText.includes('type the characters') ||
      headerText.includes('sorry, we just need to make sure you\'re not a robot');

    return hasCaptchaForm || hasCaptchaText;
  });
  return indicators;
}

// --- Navigate with CAPTCHA handling ---

async function navigateSafely(page: Page, url: string): Promise<'ok' | 'captcha' | 'failed'> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ url, err: msg }, 'Amazon navigation failed');
    return 'failed';
  }

  // Wait for JS rendering after initial load
  await page.waitForTimeout(3000);

  if (await isCaptchaPage(page)) {
    logger.warn({ url }, 'CAPTCHA detected — waiting 30s and retrying once');
    await screenshotOnError(page, 'captcha-first');
    await page.waitForTimeout(30_000);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch {
      return 'failed';
    }

    if (await isCaptchaPage(page)) {
      logger.error({ url }, 'CAPTCHA persists after retry — skipping');
      await screenshotOnError(page, 'captcha-persist');
      return 'captcha';
    }
  }

  return 'ok';
}

// --- Dismiss popups ---

async function dismissPopups(page: Page): Promise<void> {
  const selectors = [
    '#sp-cc-accept',                       // Cookie consent
    'input[data-action-type="DISMISS"]',   // "Continue shopping" overlay
    '[data-action="a-popover-close"]',     // Generic popover close
    '#nav-main .nav-a[data-nav-role="popup-close"]',
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await page.waitForTimeout(500);
      }
    } catch {
      // Fine
    }
  }
}

// --- Parsing helpers ---

function parsePrice(text: string): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/\$?\s*(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

function parseReviewCount(text: string): number {
  if (!text) return 0;
  const match = text.replace(/,/g, '').match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseRating(text: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d.]+)\s*out\s*of\s*5/);
  if (match) return parseFloat(match[1]);
  const simple = text.match(/^([\d.]+)$/);
  if (simple) {
    const v = parseFloat(simple[1]);
    return v >= 0 && v <= 5 ? v : null;
  }
  return null;
}

function extractAsin(url: string): string | null {
  // ASIN is a 10-character alphanumeric code in the URL
  // Patterns: /dp/B0XXXXXXXX, /gp/product/B0XXXXXXXX, /product-reviews/B0XXXXXXXX
  const match = url.match(/\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

function stripRefTag(url: string): string {
  const idx = url.indexOf('/ref=');
  if (idx !== -1) return url.slice(0, idx);
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) return url.slice(0, qIdx);
  return url;
}

function estimateMonthlySales(rank: number): number {
  if (rank <= 0) return 0;
  if (rank <= 10) return 15_000;
  if (rank <= 25) return 8_000;
  if (rank <= 50) return 4_000;
  if (rank <= 100) return 1_500;
  return Math.max(100, Math.round(1000 / Math.log10(rank)));
}

function parseRankChange(text: string): number | null {
  if (!text) return null;
  // Patterns: "250% ▲", "+250%", "250"
  const match = text.replace(/,/g, '').match(/(\d+)\s*%/);
  return match ? parseInt(match[1], 10) : null;
}

// --- Product extraction ---

interface AmazonExtract {
  title: string;
  price: string;
  rating: string;
  reviewCount: string;
  productUrl: string;
  imageUrl: string;
  rank: number;
  rankChange: string;
}

const GRID_WAIT_SELECTOR = '[data-testid="grid-asin-group"], .zg-grid-general-faceout, .p13n-sc-uncoverable-faceout, #gridItemRoot, [data-asin], .a-carousel-card';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Extraction script run inside the browser via page.evaluate().
// IMPORTANT: Must be a plain string — tsx/esbuild __name decorators break
// function declarations inside evaluate(). We use eval() with a raw string
// to bypass the transformer entirely.
const EXTRACT_SCRIPT = `(() => {
  function extractFromCards(cards) {
    return cards.map(function(card, idx) {
      var titleEl = card.querySelector(
        '.p13n-sc-truncate, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, ._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y, [class*="truncate"], .a-link-normal span, a.a-link-normal[href*="/dp/"] span'
      );
      var title = titleEl ? titleEl.textContent.trim() : '';
      var priceEl = card.querySelector(
        '.p13n-sc-price, ._cDEzb_p13n-sc-price_3mJ9Z, .a-price .a-offscreen, span.a-price span'
      );
      var price = priceEl ? priceEl.textContent.trim() : '';
      var ratingEl = card.querySelector('.a-icon-alt, [class*="a-icon-alt"], span[class*="star"]');
      var rating = ratingEl ? ratingEl.textContent.trim() : '';
      var reviewEl = card.querySelector('.a-size-small .a-link-normal, .a-size-small span:last-child, span[class*="a-size-small"]');
      var reviewCount = reviewEl ? reviewEl.textContent.trim() : '';
      var linkEl = card.querySelector('a.a-link-normal[href*="/dp/"], a[href*="/dp/"]');
      var href = linkEl ? linkEl.getAttribute('href') || '' : '';
      var productUrl = href.startsWith('http') ? href : href.startsWith('/') ? 'https://www.amazon.com' + href : '';
      var imgEl = card.querySelector('img');
      var imageUrl = imgEl ? imgEl.getAttribute('src') || '' : '';
      var rankEl = card.querySelector('.zg-badge-text, [class*="zg-badge-text"], .p13n-sc-shoveler-rank');
      var rankText = rankEl ? rankEl.textContent.trim() : '';
      var rankMatch = rankText.replace(/[#,]/g, '').match(/(\\d+)/);
      var rank = rankMatch ? parseInt(rankMatch[1], 10) : idx + 1;
      var changeEl = card.querySelector('.zg-percent-change, [class*="percent-change"], [class*="salesRank"]');
      var rankChange = changeEl ? changeEl.textContent.trim() : '';
      return { title: title, price: price, rating: rating, reviewCount: reviewCount, productUrl: productUrl, imageUrl: imageUrl, rank: rank, rankChange: rankChange };
    });
  }

  var strategyASelectors = ['[data-testid="grid-asin-group"]', '.zg-grid-general-faceout', '.p13n-sc-uncoverable-faceout', '#gridItemRoot', '[data-asin]'];
  var stratA = [];
  for (var i = 0; i < strategyASelectors.length; i++) {
    var found = document.querySelectorAll(strategyASelectors[i]);
    if (found.length > 0) { stratA = extractFromCards(Array.from(found)); break; }
  }

  var strategyBSelectors = ['.a-carousel-card', '.a-list-item', '.s-result-item', 'li[class*="zg"]'];
  var stratB = [];
  for (var j = 0; j < strategyBSelectors.length; j++) {
    var foundB = document.querySelectorAll(strategyBSelectors[j]);
    if (foundB.length > 3) { stratB = extractFromCards(Array.from(foundB)); break; }
  }

  var allDpLinks = document.querySelectorAll('a[href*="/dp/"]');
  var seenAsins = {};
  var stratC = [];
  allDpLinks.forEach(function(link, idx) {
    var href = link.getAttribute('href') || '';
    var asinMatch = href.match(/\\/dp\\/([A-Z0-9]{10})/i);
    if (!asinMatch || seenAsins[asinMatch[1]]) return;
    seenAsins[asinMatch[1]] = true;
    var card = link;
    for (var k = 0; k < 6; k++) { if (card.parentElement) card = card.parentElement; }
    var title = link.textContent.trim() || (card.querySelector('span') ? card.querySelector('span').textContent.trim() : '');
    var priceEl = card.querySelector('.a-price .a-offscreen, .p13n-sc-price, span.a-price span');
    var price = priceEl ? priceEl.textContent.trim() : '';
    var imgEl = card.querySelector('img');
    var imageUrl = imgEl ? imgEl.getAttribute('src') || '' : '';
    var productUrl = href.startsWith('http') ? href : 'https://www.amazon.com' + href;
    stratC.push({ title: title, price: price, rating: '', reviewCount: '', productUrl: productUrl, imageUrl: imageUrl, rank: idx + 1, rankChange: '' });
  });

  // Filter: must have a real title (not just "#1" rank badges) and a product URL
  var isRealTitle = function(t) { return t && t.length > 3 && !/^#\\d+$/.test(t); };
  var aWithTitle = stratA.filter(function(p) { return isRealTitle(p.title) && p.productUrl; });
  var bWithTitle = stratB.filter(function(p) { return isRealTitle(p.title) && p.productUrl; });
  var cWithTitle = stratC.filter(function(p) { return isRealTitle(p.title) && p.productUrl; });

  // Prefer Strategy A (specific selectors = better quality), then B, then C as fallback
  var products, winner;
  if (aWithTitle.length > 0) {
    products = aWithTitle; winner = 'A';
  } else if (bWithTitle.length > 0) {
    products = bWithTitle; winner = 'B';
  } else {
    products = cWithTitle; winner = 'C';
  }

  return { stratA: aWithTitle.length, stratB: bWithTitle.length, stratC: cWithTitle.length, products: products, winner: winner };
})()`;

async function extractAmazonProducts(page: Page): Promise<AmazonExtract[]> {
  let results: any;
  try {
    results = await page.evaluate(EXTRACT_SCRIPT);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Extraction evaluate failed');
    await screenshotOnError(page, 'extract-error');
    return [];
  }

  logger.info(
    { stratA: results.stratA, stratB: results.stratB, stratC: results.stratC, winner: results.winner, total: results.products.length },
    'Extraction strategy results',
  );

  return results.products;
}

// --- Pagination ---

async function goToNextPage(page: Page): Promise<boolean> {
  const selectors = [
    'li.a-last a',
    'ul.a-pagination li.a-last a',
    'a:has-text("Next")',
  ];

  for (const sel of selectors) {
    try {
      const link = page.locator(sel).first();
      if (await link.isVisible({ timeout: 2000 })) {
        await link.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
        await page.waitForTimeout(2000);
        return true;
      }
    } catch {
      // Not found
    }
  }

  return false;
}

// --- Main scraper ---

export async function scrapeAmazonTrending(
  batchId: string,
  config: ScraperJobConfig,
): Promise<{ productsFound: number }> {
  const maxPages = config.max_pages ?? 2;
  const allowedCategories = config.categories;
  const includeMovers = (config as Record<string, unknown>).include_movers !== false;
  let totalInserted = 0;

  // Build target list
  let targets: AmazonTarget[] = [];

  for (const cat of BESTSELLER_CATEGORIES) {
    if (!allowedCategories || allowedCategories.includes(cat.slug)) {
      targets.push(cat);
    }
  }

  if (includeMovers) {
    targets.push(...MOVERS_TARGETS);
  }

  targets.push(...NEW_RELEASES_TARGETS);

  logger.info(
    { batchId, targetCount: targets.length, maxPages, includeMovers },
    'Amazon Trending scraper starting',
  );

  let browser: Browser | null = null;

  try {
    const isHeaded = process.env.SCRAPER_HEADED === 'true';
    browser = await chromium.launch({
      headless: !isHeaded,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const ua = randomUA();
    const context = await browser.newContext({
      userAgent: ua,
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
        'Cache-Control': 'max-age=0',
      },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(45_000);

    // Warm up session: visit Amazon homepage first to get cookies
    logger.info({ batchId }, 'Warming up Amazon session with homepage visit');
    try {
      await page.goto(`${BASE_URL}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(3000);
      await dismissPopups(page);
      await randomDelay(2000, 4000);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Homepage warmup failed — continuing');
    }

    for (const target of targets) {
      logger.info(
        { url: target.url, category: target.name, type: target.type, batchId },
        'Scraping Amazon target',
      );

      const navResult = await navigateSafely(page, target.url);
      if (navResult !== 'ok') {
        logger.warn(
          { url: target.url, result: navResult, batchId },
          'Skipping target due to navigation failure',
        );
        continue;
      }

      await dismissPopups(page);

      // Wait for product grid to appear
      try {
        await page.waitForSelector(
          GRID_WAIT_SELECTOR,
          { state: 'attached', timeout: 10_000 },
        );
      } catch {
        logger.warn({ url: target.url, batchId }, 'Product grid did not load — extracting anyway');
      }

      let pageNum = 1;
      let categoryInserted = 0;

      while (pageNum <= maxPages) {
        logger.info(
          { category: target.name, pageNum, batchId },
          'Extracting products from page',
        );

        // Scroll slowly to load lazy images (600px every 1s, 10 times)
        for (let i = 0; i < 10; i++) {
          await page.evaluate(() => window.scrollBy(0, 600));
          await page.waitForTimeout(1000);
        }

        const extracts = await extractAmazonProducts(page);

        if (extracts.length === 0) {
          logger.warn({ category: target.name, pageNum, batchId }, 'No products found on page');
          await screenshotOnError(page, `empty-${target.slug}-p${pageNum}`);
          break;
        }

        logger.info(
          { category: target.name, pageNum, extractCount: extracts.length, batchId },
          'Products extracted',
        );

        for (const raw of extracts) {
          try {
            if (!raw.title || !raw.productUrl) continue;

            const asin = extractAsin(raw.productUrl);
            if (!asin) continue;

            const priceUsd = parsePrice(raw.price);
            // Some bestseller items may not show price — insert with 0
            const finalPrice = priceUsd ?? 0;

            const rating = parseRating(raw.rating);
            const reviewCount = parseReviewCount(raw.reviewCount);
            const monthlySales = estimateMonthlySales(raw.rank);

            const cleanUrl = stripRefTag(raw.productUrl);
            const productUrl = cleanUrl.startsWith('http')
              ? cleanUrl
              : `${BASE_URL}${cleanUrl}`;

            // Build tags
            const tags: string[] = [target.type, `rank_${raw.rank}`];

            if (target.type === 'movers') {
              const pctChange = parseRankChange(raw.rankChange);
              if (pctChange !== null) {
                tags.push(`rising_${pctChange}%`);
              }
            }

            if (target.type === 'new-releases') {
              tags.push('new_release');
            }

            await db.insert(rawProducts).values({
              source: 'amazon',
              external_id: asin,
              title: raw.title.slice(0, 500),
              price_usd: finalPrice.toFixed(2),
              currency: 'USD',
              estimated_monthly_sales: monthlySales,
              review_count: reviewCount,
              rating: rating?.toFixed(2) ?? null,
              category: target.name,
              product_url: productUrl,
              image_urls: raw.imageUrl ? [raw.imageUrl] : [],
              tags,
              batch_id: batchId,
            });

            categoryInserted++;
            totalInserted++;
          } catch (err) {
            logger.error(
              { err, title: raw.title?.slice(0, 60), batchId },
              'Failed to insert Amazon product',
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

        // Check for CAPTCHA after pagination
        if (await isCaptchaPage(page)) {
          logger.warn({ category: target.name, pageNum, batchId }, 'CAPTCHA on pagination — stopping category');
          await screenshotOnError(page, `captcha-page-${target.slug}`);
          break;
        }

        await randomDelay(5000, 12_000);
      }

      logger.info(
        { category: target.name, categoryInserted, batchId },
        'Amazon target complete',
      );

      // Delay between targets
      await randomDelay(5000, 12_000);
    }

    await context.close();
  } catch (err) {
    logger.error({ err, batchId }, 'Amazon Trending scraper crashed');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  logger.info({ batchId, totalInserted }, 'Amazon Trending scraper finished');
  return { productsFound: totalInserted };
}
