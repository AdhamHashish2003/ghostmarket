import { chromium, type Browser, type Page } from 'playwright';
import { db, rawProducts, logger } from '@ghostmarket/shared';
import type { ScraperJobConfig } from '../queue.js';
import { mkdir } from 'node:fs/promises';

// --- User-agent rotation (10 common browsers) ---

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

// --- Category mapping ---

interface CategoryTarget {
  slug: string;
  name: string;
  path: string;
}

const CATEGORIES: CategoryTarget[] = [
  { slug: 'electronics',  name: 'Consumer Electronics', path: '/category/44/consumer-electronics.html' },
  { slug: 'home',         name: 'Home & Garden',        path: '/category/15/home-and-garden.html' },
  { slug: 'fashion',      name: 'Apparel & Accessories', path: '/category/3/apparel-accessories.html' },
  { slug: 'sports',       name: 'Sports & Entertainment', path: '/category/18/sports-entertainment.html' },
  { slug: 'toys',         name: 'Toys & Hobbies',       path: '/category/26/toys-hobbies.html' },
  { slug: 'beauty',       name: 'Beauty & Health',      path: '/category/66/beauty-health.html' },
  { slug: 'auto',         name: 'Automobiles & Motorcycles', path: '/category/34/automobiles-motorcycles.html' },
];

const BESTSELLERS_URL = 'https://www.aliexpress.com/popular.html';
const BASE_URL = 'https://www.aliexpress.com';

// --- Parsing helpers ---

function parsePrice(text: string): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

function parseOrderCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.toLowerCase().replace(/,/g, '');
  // Handle patterns: "10000+ sold", "500+ orders", "1k+ sold", "2.5k sold"
  const kMatch = cleaned.match(/([\d.]+)\s*k\+?\s*(?:sold|orders|bought)/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);

  const numMatch = cleaned.match(/([\d]+)\+?\s*(?:sold|orders|bought)/);
  if (numMatch) return parseInt(numMatch[1], 10);

  // Just a bare number
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
  // AliExpress URLs: /item/1234567890.html or /item/1234567890
  const match = url.match(/\/item\/(\d+)/);
  if (match) return match[1];
  // Also try: /_(\d+)\.html or /(\d+)\.html
  const altMatch = url.match(/[/_](\d{8,})(?:\.html)?/);
  return altMatch ? altMatch[1] : null;
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

// --- Screenshot on error ---

async function screenshotOnError(page: Page, label: string): Promise<void> {
  try {
    const dir = '/tmp/scraper-errors';
    await mkdir(dir, { recursive: true });
    const filename = `${dir}/aliexpress-${label}-${Date.now()}.png`;
    await page.screenshot({ path: filename, fullPage: false });
    logger.info({ filename }, 'Error screenshot saved');
  } catch {
    // Don't let screenshot failures cascade
  }
}

// --- Dismiss popups/dialogs ---

async function dismissPopups(page: Page): Promise<void> {
  const dismissSelectors = [
    // Cookie consent
    'button[data-role="close-btn"]',
    '.btn-close',
    '[class*="popup"] [class*="close"]',
    '[class*="dialog"] [class*="close"]',
    // "Ship to" popup
    '.ship-to-btn-close',
    '[class*="country"] button[class*="close"]',
    // Generic overlays
    '.next-dialog-close',
    '.next-overlay-close',
    // Cookie accept
    'button[data-spm="accept"]',
    '#gdpr-accept',
  ];

  for (const sel of dismissSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    } catch {
      // Element not found or not clickable — fine
    }
  }
}

// --- Scroll for lazy loading ---

async function scrollForLazyLoad(page: Page): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(2000);
}

// --- Product extraction from page ---

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

const PRODUCT_CARD_SELECTORS = [
  '.search-item-card-wrapper-gallery',
  '.product-snippet_ProductSnippet',
  '[class*="SearchResultItem"]',
  '[class*="product-card"]',
  '[class*="ProductSnippet"]',
  '[class*="list--gallery"]',
  'a[href*="/item/"]',
];

async function extractProducts(page: Page): Promise<RawExtract[]> {
  return page.evaluate((selectors: string[]) => {
    // Find product cards using the first selector that matches
    let cards: Element[] = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        cards = Array.from(found);
        break;
      }
    }

    if (cards.length === 0) return [];

    return cards.map((card) => {
      // Title — try multiple approaches
      const titleEl =
        card.querySelector('h1, h3, [class*="title"] a, [class*="Title"] a, a[title]');
      const title =
        titleEl?.getAttribute('title') ??
        titleEl?.textContent?.trim() ??
        card.querySelector('a')?.getAttribute('title') ??
        '';

      // Price — look for price elements
      const priceEl = card.querySelector(
        '[class*="price"] [class*="current"], [class*="Price"] span, [class*="sale-price"], [class*="price-current"]',
      );
      const price = priceEl?.textContent?.trim() ?? '';

      // Original price — strikethrough or discount price
      const origEl = card.querySelector(
        '[class*="price"] del, [class*="Price"] del, [class*="origin"], [class*="price-original"], s',
      );
      const originalPrice = origEl?.textContent?.trim() ?? '';

      // Image
      const imgEl = card.querySelector('img[src], img[data-src]');
      const imageUrl =
        imgEl?.getAttribute('src') ??
        imgEl?.getAttribute('data-src') ??
        '';

      // Product URL
      const linkEl = card.querySelector('a[href*="/item/"], a[href*="aliexpress"]');
      const href = linkEl?.getAttribute('href') ?? '';
      const productUrl = href.startsWith('http') ? href : href.startsWith('//') ? `https:${href}` : '';

      // Review count / orders
      const reviewEl = card.querySelector(
        '[class*="review"], [class*="Review"], [class*="star"] + span',
      );
      const reviewCount = reviewEl?.textContent?.trim() ?? '';

      // Rating
      const ratingEl = card.querySelector(
        '[class*="star"], [class*="rating"], [class*="Rating"]',
      );
      const rating = ratingEl?.textContent?.trim() ?? ratingEl?.getAttribute('title') ?? '';

      // Orders / sold text
      const ordersEl = card.querySelector(
        '[class*="sold"], [class*="order"], [class*="trade"]',
      );
      const ordersText = ordersEl?.textContent?.trim() ?? '';

      return { title, price, originalPrice, imageUrl, productUrl, reviewCount, rating, ordersText };
    });
  }, PRODUCT_CARD_SELECTORS);
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
        await page.waitForLoadState('networkidle', { timeout: 30_000 });
        await page.waitForTimeout(2000);
        return true;
      }
    } catch {
      // Selector not found
    }
  }

  return false;
}

// --- Navigate with retry ---

async function navigateWithRetry(page: Page, url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ url, attempt, err: msg }, 'Navigation failed');
      if (attempt < 2) {
        await page.waitForTimeout(10_000);
      }
    }
  }
  return false;
}

// --- Main scraper ---

export async function scrapeAliexpress(
  batchId: string,
  config: ScraperJobConfig,
): Promise<{ productsFound: number }> {
  const maxPages = config.max_pages ?? 5;
  const minOrders = 100;
  const allowedCategories = config.categories;
  let totalInserted = 0;

  // Filter categories
  let targets: { url: string; category: string }[] = [
    { url: BESTSELLERS_URL, category: 'bestsellers' },
  ];
  for (const cat of CATEGORIES) {
    if (!allowedCategories || allowedCategories.includes(cat.slug)) {
      targets.push({ url: `${BASE_URL}${cat.path}`, category: cat.name });
    }
  }

  logger.info(
    { batchId, targetCount: targets.length, maxPages, categories: allowedCategories ?? 'all' },
    'AliExpress scraper starting',
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
    page.setDefaultTimeout(60_000);

    for (const target of targets) {
      logger.info({ url: target.url, category: target.category, batchId }, 'Scraping category');

      const loaded = await navigateWithRetry(page, target.url);
      if (!loaded) {
        logger.error({ url: target.url, batchId }, 'Failed to load page after retries — skipping');
        await screenshotOnError(page, `load-${target.category}`);
        continue;
      }

      await dismissPopups(page);

      let pageNum = 1;
      let categoryInserted = 0;

      while (pageNum <= maxPages) {
        logger.info(
          { category: target.category, pageNum, batchId },
          'Scrolling and extracting page',
        );

        await scrollForLazyLoad(page);
        await dismissPopups(page);

        let extracts = await extractProducts(page);

        if (extracts.length === 0) {
          logger.warn(
            { category: target.category, pageNum, batchId },
            'No products found on page — trying broader selectors',
          );
          // Fallback: grab all links that look like product links
          extracts = await page.evaluate(() => {
            const links = document.querySelectorAll('a[href*="/item/"]');
            return Array.from(links).map((a) => {
              const parent = a.closest('[class*="card"], [class*="item"], li, article') ?? a;
              return {
                title: a.getAttribute('title') ?? a.textContent?.trim() ?? '',
                price: parent.querySelector('[class*="price"]')?.textContent?.trim() ?? '',
                originalPrice: parent.querySelector('del, s')?.textContent?.trim() ?? '',
                imageUrl: parent.querySelector('img')?.getAttribute('src') ?? '',
                productUrl: (a as HTMLAnchorElement).href,
                reviewCount: '',
                rating: '',
                ordersText: parent.querySelector('[class*="sold"], [class*="order"]')?.textContent?.trim() ?? '',
              };
            });
          });

          if (extracts.length === 0) {
            logger.warn({ category: target.category, pageNum, batchId }, 'Still no products — moving on');
            await screenshotOnError(page, `empty-${target.category}-p${pageNum}`);
            break;
          }
        }

        logger.info(
          { category: target.category, pageNum, extractCount: extracts.length, batchId },
          'Products extracted from page',
        );

        // Process and insert each product
        for (const raw of extracts) {
          try {
            if (!raw.title || !raw.productUrl) continue;

            const externalId = extractItemId(raw.productUrl);
            if (!externalId) continue;

            const priceUsd = parsePrice(raw.price);
            if (!priceUsd || priceUsd <= 0) continue;

            const orders = parseOrderCount(raw.ordersText);
            if (orders < minOrders) continue;

            const originalPriceUsd = parsePrice(raw.originalPrice);
            const rating = parseRating(raw.rating);
            const reviewCount = parseOrderCount(raw.reviewCount);

            // Normalize image URL
            let imageUrl = raw.imageUrl;
            if (imageUrl.startsWith('//')) imageUrl = `https:${imageUrl}`;

            // Make product URL absolute
            let productUrl = raw.productUrl;
            if (productUrl.startsWith('//')) productUrl = `https:${productUrl}`;
            if (productUrl.startsWith('/')) productUrl = `${BASE_URL}${productUrl}`;

            await db.insert(rawProducts).values({
              source: 'aliexpress',
              external_id: externalId,
              title: raw.title.slice(0, 500),
              price_usd: priceUsd.toFixed(2),
              original_price_usd: originalPriceUsd?.toFixed(2) ?? null,
              currency: 'USD',
              estimated_monthly_sales: orders,
              review_count: reviewCount,
              rating: rating?.toFixed(2) ?? null,
              category: target.category,
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
              'Failed to insert product',
            );
          }
        }

        // Pagination
        if (pageNum >= maxPages) break;

        const hasNext = await goToNextPage(page);
        if (!hasNext) {
          logger.info({ category: target.category, pageNum, batchId }, 'No more pages');
          break;
        }

        pageNum++;
        await randomDelay(3000, 8000);
      }

      logger.info(
        { category: target.category, categoryInserted, batchId },
        'Category scraping complete',
      );

      // Delay between categories
      await randomDelay(3000, 8000);
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
