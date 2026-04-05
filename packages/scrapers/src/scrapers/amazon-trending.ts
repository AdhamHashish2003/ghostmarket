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
    const body = document.body?.textContent?.toLowerCase() ?? '';
    const hasCaptchaText =
      body.includes('enter the characters you see below') ||
      body.includes('type the characters') ||
      body.includes('sorry, we just need to make sure') ||
      body.includes('robot');
    const hasCaptchaForm =
      !!document.querySelector('form[action*="validateCaptcha"]') ||
      !!document.querySelector('#captchacharacters');
    return hasCaptchaText || hasCaptchaForm;
  });
  return indicators;
}

// --- Navigate with CAPTCHA handling ---

async function navigateSafely(page: Page, url: string): Promise<'ok' | 'captcha' | 'failed'> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ url, err: msg }, 'Amazon navigation failed');
    return 'failed';
  }

  if (await isCaptchaPage(page)) {
    logger.warn({ url }, 'CAPTCHA detected — waiting 30s and retrying once');
    await screenshotOnError(page, 'captcha-first');
    await page.waitForTimeout(30_000);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
  if (rank <= 10) return 10_000;
  if (rank <= 50) return Math.round(10_000 - ((rank - 10) / 40) * 7_000); // 10000 → 3000
  if (rank <= 100) return Math.round(3_000 - ((rank - 50) / 50) * 2_000); // 3000 → 1000
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

const CARD_SELECTORS = [
  '[data-testid="grid-asin-group"]',
  '.zg-grid-general-faceout',
  '.p13n-sc-uncoverable-faceout',
  '#gridItemRoot',
  '.a-carousel-card',
  '[data-asin]',
];

async function extractAmazonProducts(page: Page): Promise<AmazonExtract[]> {
  return page.evaluate((selectors: string[]) => {
    let cards: Element[] = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        cards = Array.from(found);
        break;
      }
    }

    if (cards.length === 0) return [];

    return cards.map((card, idx) => {
      // Title
      const titleEl = card.querySelector(
        '.p13n-sc-truncate, [class*="p13n-sc-truncate"], .a-link-normal span, ._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y, a.a-link-normal[href*="/dp/"] span',
      );
      const title = titleEl?.textContent?.trim() ?? '';

      // Price
      const priceEl = card.querySelector(
        '.p13n-sc-price, ._cDEzb_p13n-sc-price_3mJ9Z, .a-price .a-offscreen, span.a-price span',
      );
      const price = priceEl?.textContent?.trim() ?? '';

      // Rating text (e.g. "4.5 out of 5 stars")
      const ratingEl = card.querySelector(
        '.a-icon-alt, [class*="a-icon-alt"], span[class*="star"]',
      );
      const rating = ratingEl?.textContent?.trim() ?? '';

      // Review count
      const reviewEl = card.querySelector(
        '.a-size-small span:last-child, span[class*="a-size-small"]',
      );
      const reviewCount = reviewEl?.textContent?.trim() ?? '';

      // Product link
      const linkEl = card.querySelector(
        'a.a-link-normal[href*="/dp/"], a[href*="/dp/"]',
      );
      const href = linkEl?.getAttribute('href') ?? '';
      const productUrl = href.startsWith('http')
        ? href
        : href.startsWith('/')
          ? `https://www.amazon.com${href}`
          : '';

      // Image
      const imgEl = card.querySelector('img');
      const imageUrl = imgEl?.getAttribute('src') ?? '';

      // Rank — either from a badge or from position
      const rankEl = card.querySelector(
        '.zg-badge-text, [class*="zg-badge-text"], .p13n-sc-shoveler-rank',
      );
      const rankText = rankEl?.textContent?.trim() ?? '';
      const rankMatch = rankText.replace(/[#,]/g, '').match(/(\d+)/);
      const rank = rankMatch ? parseInt(rankMatch[1], 10) : idx + 1;

      // Rank change (Movers & Shakers pages)
      const changeEl = card.querySelector(
        '.zg-percent-change, [class*="percent-change"], [class*="salesRank"]',
      );
      const rankChange = changeEl?.textContent?.trim() ?? '';

      return { title, price, rating, reviewCount, productUrl, imageUrl, rank, rankChange };
    });
  }, CARD_SELECTORS);
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
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      userAgent: randomUA(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30_000);

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
          CARD_SELECTORS.join(', '),
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

        // Scroll to load lazy images
        for (let i = 0; i < 10; i++) {
          await page.evaluate(() => window.scrollBy(0, 600));
          await page.waitForTimeout(400);
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

        await randomDelay(5000, 10_000);
      }

      logger.info(
        { category: target.name, categoryInserted, batchId },
        'Amazon target complete',
      );

      // Delay between targets
      await randomDelay(5000, 10_000);
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
