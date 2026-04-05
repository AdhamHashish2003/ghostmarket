import { chromium, type Browser, type Page } from 'playwright';
import { desc, eq } from 'drizzle-orm';
import { db, rawProducts, trendSignals, logger } from '@ghostmarket/shared';
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

// --- Helpers ---

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

async function screenshotOnError(page: Page, label: string): Promise<void> {
  try {
    const dir = '/tmp/scraper-errors';
    await mkdir(dir, { recursive: true });
    const filename = `${dir}/tiktok-${label}-${Date.now()}.png`;
    await page.screenshot({ path: filename, fullPage: false });
    logger.info({ filename }, 'Error screenshot saved');
  } catch {
    // Don't cascade
  }
}

// --- Bot detection checks ---

async function isBlocked(page: Page): Promise<'captcha' | 'login' | false> {
  const result = await page.evaluate(() => {
    const body = document.body?.textContent?.toLowerCase() ?? '';
    const url = window.location.href.toLowerCase();

    // CAPTCHA indicators
    if (
      body.includes('verify to continue') ||
      body.includes('verify your identity') ||
      body.includes('slide to verify') ||
      !!document.querySelector('[class*="captcha"]') ||
      !!document.querySelector('#captcha-verify-container')
    ) {
      return 'captcha';
    }

    // Login wall
    if (
      url.includes('/login') ||
      body.includes('log in to continue') ||
      body.includes('sign in to tiktok') ||
      (!!document.querySelector('[class*="login"]') && body.length < 2000)
    ) {
      return 'login';
    }

    return false;
  });

  return result as 'captcha' | 'login' | false;
}

// --- Navigate with retry + block detection ---

async function navigateSafely(
  page: Page,
  url: string,
): Promise<'ok' | 'blocked' | 'failed'> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      if (resp && resp.status() === 404) {
        logger.warn({ url }, 'Page returned 404 — skipping');
        return 'failed';
      }

      const blockStatus = await isBlocked(page);
      if (blockStatus) {
        logger.warn({ url, blockStatus, attempt }, 'TikTok blocked access');
        if (attempt < 2) {
          await screenshotOnError(page, `${blockStatus}-attempt${attempt}`);
          await page.waitForTimeout(15_000);
          continue;
        }
        await screenshotOnError(page, `${blockStatus}-final`);
        return 'blocked';
      }

      return 'ok';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ url, attempt, err: msg }, 'TikTok navigation error');
      if (attempt < 2) {
        await page.waitForTimeout(10_000);
      }
    }
  }
  return 'failed';
}

// --- Parsing helpers ---

function parsePrice(text: string): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/\$?\s*(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

function parseSoldCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.toLowerCase().replace(/,/g, '');

  const kMatch = cleaned.match(/([\d.]+)\s*k/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000);

  const mMatch = cleaned.match(/([\d.]+)\s*m/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);

  const numMatch = cleaned.match(/(\d+)/);
  return numMatch ? parseInt(numMatch[1], 10) : 0;
}

function parseViewCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.toLowerCase().replace(/,/g, '').trim();

  const bMatch = cleaned.match(/([\d.]+)\s*b/);
  if (bMatch) return Math.round(parseFloat(bMatch[1]) * 1_000_000_000);

  const mMatch = cleaned.match(/([\d.]+)\s*m/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);

  const kMatch = cleaned.match(/([\d.]+)\s*k/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000);

  const numMatch = cleaned.match(/(\d+)/);
  return numMatch ? parseInt(numMatch[1], 10) : 0;
}

function extractProductId(url: string): string | null {
  // TikTok Shop product URLs vary; try common patterns
  // /product/1234567890, /product-detail/1234567890, ?product_id=123
  const pathMatch = url.match(/\/product(?:-detail)?\/(\d+)/);
  if (pathMatch) return pathMatch[1];

  const paramMatch = url.match(/[?&]product_id=(\d+)/);
  if (paramMatch) return paramMatch[1];

  // Fallback: grab any long numeric ID from the URL
  const longId = url.match(/(\d{10,})/);
  return longId ? longId[1] : null;
}

function parseRating(text: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d.]+)/);
  if (!match) return null;
  const v = parseFloat(match[1]);
  return v >= 0 && v <= 5 ? v : null;
}

// --- TikTok Shop direct page extraction ---

interface ShopProductExtract {
  title: string;
  price: string;
  soldText: string;
  reviewCount: string;
  rating: string;
  productUrl: string;
  imageUrl: string;
}

const SHOP_CARD_SELECTORS = [
  '[class*="ProductCard"]',
  '[class*="product-card"]',
  '[class*="ProductItem"]',
  '[class*="product-item"]',
  '[data-e2e="product-card"]',
  '[class*="GoodsCard"]',
];

async function extractShopProducts(page: Page): Promise<ShopProductExtract[]> {
  return page.evaluate((selectors: string[]) => {
    let cards: Element[] = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        cards = Array.from(found);
        break;
      }
    }

    // Fallback: any link to a product detail page
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/product"]');
      cards = Array.from(links).map(
        (a) => a.closest('[class*="card"], [class*="item"], li, article') ?? a,
      );
    }

    if (cards.length === 0) return [];

    return cards.map((card) => {
      const titleEl = card.querySelector(
        '[class*="title"], [class*="name"], h3, h2, [class*="Title"]',
      );
      const title = titleEl?.textContent?.trim() ?? '';

      const priceEl = card.querySelector(
        '[class*="price"], [class*="Price"]',
      );
      const price = priceEl?.textContent?.trim() ?? '';

      const soldEl = card.querySelector(
        '[class*="sold"], [class*="sale"], [class*="Sold"]',
      );
      const soldText = soldEl?.textContent?.trim() ?? '';

      const reviewEl = card.querySelector(
        '[class*="review"], [class*="Review"]',
      );
      const reviewCount = reviewEl?.textContent?.trim() ?? '';

      const ratingEl = card.querySelector(
        '[class*="star"], [class*="rating"], [class*="Rating"]',
      );
      const rating = ratingEl?.textContent?.trim() ?? '';

      const linkEl = card.querySelector('a[href*="/product"]') ?? card.closest('a');
      const href = linkEl?.getAttribute('href') ?? '';
      const productUrl = href.startsWith('http')
        ? href
        : href.startsWith('//')
          ? `https:${href}`
          : href.startsWith('/')
            ? `https://shop.tiktok.com${href}`
            : '';

      const imgEl = card.querySelector('img');
      const imageUrl = imgEl?.getAttribute('src') ?? imgEl?.getAttribute('data-src') ?? '';

      return { title, price, soldText, reviewCount, rating, productUrl, imageUrl };
    });
  }, SHOP_CARD_SELECTORS);
}

// --- TikTok search extraction (fallback) ---

interface TikTokSearchExtract {
  videoDesc: string;
  productLinks: string[];
  hashtags: string[];
  viewCount: string;
}

async function extractSearchResults(page: Page): Promise<TikTokSearchExtract[]> {
  return page.evaluate(() => {
    const items: { videoDesc: string; productLinks: string[]; hashtags: string[]; viewCount: string }[] = [];

    // Video cards on search results
    const videoCards = document.querySelectorAll(
      '[class*="DivItemContainerV2"], [data-e2e="search-card-item"], [class*="video-feed-item"], [class*="VideoCard"]',
    );

    for (const card of Array.from(videoCards)) {
      const descEl = card.querySelector(
        '[class*="SpanText"], [data-e2e="search-card-desc"], [class*="video-desc"], [class*="desc"]',
      );
      const videoDesc = descEl?.textContent?.trim() ?? '';

      // Extract any product/shop links
      const allLinks = card.querySelectorAll('a[href]');
      const productLinks: string[] = [];
      for (const a of Array.from(allLinks)) {
        const href = a.getAttribute('href') ?? '';
        if (
          href.includes('/product') ||
          href.includes('shop.tiktok') ||
          href.includes('/shop/')
        ) {
          productLinks.push(href.startsWith('http') ? href : `https://www.tiktok.com${href}`);
        }
      }

      // Extract hashtags
      const hashtagEls = card.querySelectorAll('a[href*="/tag/"], [class*="HashTag"], [class*="hashtag"]');
      const hashtags = Array.from(hashtagEls)
        .map((el) => el.textContent?.trim() ?? '')
        .filter(Boolean);

      // View count
      const viewEl = card.querySelector(
        '[class*="video-count"], [data-e2e="search-card-like-count"], [class*="view"], strong',
      );
      const viewCount = viewEl?.textContent?.trim() ?? '';

      items.push({ videoDesc, productLinks, hashtags, viewCount });
    }

    return items;
  });
}

// --- Hashtag trend extraction ---

interface HashtagData {
  tag: string;
  viewCount: number;
}

const TRENDING_HASHTAGS = [
  'tiktokmademebuyit',
  'amazonfinds',
  'shopfinds',
  'tiktokshop',
  'viralproducts',
  'trendingproducts',
];

async function extractHashtagViews(page: Page, tag: string): Promise<HashtagData | null> {
  const url = `https://www.tiktok.com/tag/${tag}`;
  const status = await navigateSafely(page, url);
  if (status !== 'ok') return null;

  await page.waitForTimeout(3000);

  const viewText = await page.evaluate(() => {
    // View count usually in the header section of the tag page
    const viewEl = document.querySelector(
      '[class*="StatsCount"], [data-e2e="challenge-vvcount"], [class*="view-count"], h2 + h3, [class*="stats"] strong',
    );
    return viewEl?.textContent?.trim() ?? '';
  });

  if (!viewText) return null;

  const viewCount = parseViewCount(viewText);
  return viewCount > 0 ? { tag, viewCount } : null;
}

async function captureHashtagTrends(
  page: Page,
  collectedHashtags: string[],
): Promise<number> {
  // Merge default trending hashtags with any collected from videos
  const allTags = new Set([
    ...TRENDING_HASHTAGS,
    ...collectedHashtags
      .map((h) => h.replace(/^#/, '').toLowerCase())
      .filter((h) => h.length > 2),
  ]);

  let captured = 0;

  for (const tag of allTags) {
    try {
      const data = await extractHashtagViews(page, tag);
      if (!data) continue;

      // Calculate interest_score: normalize view count to 0-100
      // Rough scale: 1B+ views = 100, 100M = 80, 10M = 60, 1M = 40, 100K = 20
      let interestScore: number;
      if (data.viewCount >= 1_000_000_000) interestScore = 100;
      else if (data.viewCount >= 100_000_000) interestScore = 80;
      else if (data.viewCount >= 10_000_000) interestScore = 60;
      else if (data.viewCount >= 1_000_000) interestScore = 40;
      else if (data.viewCount >= 100_000) interestScore = 20;
      else interestScore = 10;

      // Calculate velocity from previous capture
      const prevRows = await db
        .select({
          interest_score: trendSignals.interest_score,
          captured_at: trendSignals.captured_at,
        })
        .from(trendSignals)
        .where(eq(trendSignals.keyword, `#${data.tag}`))
        .orderBy(desc(trendSignals.captured_at))
        .limit(1);

      let velocity = interestScore; // default: treat as new
      if (prevRows.length > 0 && prevRows[0].captured_at) {
        const hoursElapsed =
          (Date.now() - prevRows[0].captured_at.getTime()) / (1000 * 60 * 60);
        if (hoursElapsed > 0.01) {
          velocity = (interestScore - prevRows[0].interest_score) / hoursElapsed;
        }
      }

      await db.insert(trendSignals).values({
        keyword: `#${data.tag}`,
        source: 'tiktok',
        interest_score: interestScore,
        velocity: velocity.toFixed(4),
        related_queries: [...allTags].filter((t) => t !== data.tag).slice(0, 10),
        geo: 'US',
        captured_at: new Date(),
      });

      captured++;
      logger.info(
        { tag: data.tag, views: data.viewCount, interestScore },
        'TikTok hashtag trend captured',
      );

      await randomDelay(3000, 6000);
    } catch (err) {
      logger.error({ err, tag }, 'Failed to capture hashtag trend');
    }
  }

  return captured;
}

// --- Scroll for lazy loading ---

async function scrollForContent(page: Page, scrolls: number): Promise<void> {
  for (let i = 0; i < scrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);
}

// --- Main scraper ---

export async function scrapeTiktokShop(
  batchId: string,
  config: ScraperJobConfig,
): Promise<{ productsFound: number }> {
  const maxPages = config.max_pages ?? 3;
  const customQueries = (config as Record<string, unknown>).search_queries as string[] | undefined;
  let totalInserted = 0;
  const collectedHashtags: string[] = [];

  logger.info({ batchId, maxPages }, 'TikTok Shop scraper starting');

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
    page.setDefaultTimeout(45_000);

    // ============================================================
    // Phase 1: Try TikTok Shop direct pages
    // ============================================================

    const shopUrls = [
      'https://shop.tiktok.com/bestsellers',
      'https://shop.tiktok.com/',
      'https://shop.tiktok.com/browse',
    ];

    let shopSucceeded = false;

    for (const url of shopUrls) {
      logger.info({ url, batchId }, 'Trying TikTok Shop direct URL');

      const status = await navigateSafely(page, url);
      if (status !== 'ok') {
        logger.warn({ url, status, batchId }, 'TikTok Shop URL not accessible — trying next');
        continue;
      }

      await scrollForContent(page, 10);

      const products = await extractShopProducts(page);
      if (products.length === 0) {
        logger.warn({ url, batchId }, 'No products found on TikTok Shop page');
        await screenshotOnError(page, `shop-empty-${Date.now()}`);
        continue;
      }

      shopSucceeded = true;
      logger.info({ url, count: products.length, batchId }, 'TikTok Shop products extracted');

      for (const raw of products) {
        try {
          if (!raw.title || !raw.productUrl) continue;

          const externalId = extractProductId(raw.productUrl);
          if (!externalId) continue;

          const priceUsd = parsePrice(raw.price);
          const soldCount = parseSoldCount(raw.soldText);
          const rating = parseRating(raw.rating);
          const reviewCount = parseSoldCount(raw.reviewCount);

          let imageUrl = raw.imageUrl;
          if (imageUrl.startsWith('//')) imageUrl = `https:${imageUrl}`;

          await db.insert(rawProducts).values({
            source: 'tiktok_shop',
            external_id: externalId,
            title: raw.title.slice(0, 500),
            price_usd: (priceUsd ?? 0).toFixed(2),
            currency: 'USD',
            estimated_monthly_sales: soldCount || null,
            review_count: reviewCount,
            rating: rating?.toFixed(2) ?? null,
            category: 'TikTok Shop',
            product_url: raw.productUrl,
            image_urls: imageUrl ? [imageUrl] : [],
            tags: ['tiktok_shop'],
            batch_id: batchId,
          });

          totalInserted++;
        } catch (err) {
          logger.error({ err, title: raw.title?.slice(0, 60), batchId }, 'Failed to insert TikTok Shop product');
        }
      }

      await randomDelay(5000, 8000);
    }

    // ============================================================
    // Phase 2: Fallback — search TikTok for trending products
    // ============================================================

    const searchQueries = [
      'tiktokmademebuyit',
      'trending products 2025',
      'viral products',
      ...(customQueries ?? []),
    ];

    for (const query of searchQueries) {
      const searchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`;
      logger.info({ query, batchId }, 'Searching TikTok for product trends');

      const status = await navigateSafely(page, searchUrl);
      if (status !== 'ok') {
        logger.warn({ query, status, batchId }, 'TikTok search blocked — skipping query');
        continue;
      }

      await scrollForContent(page, 8);

      const results = await extractSearchResults(page);
      logger.info(
        { query, resultCount: results.length, batchId },
        'TikTok search results extracted',
      );

      for (const result of results) {
        // Collect hashtags for Phase 3
        for (const tag of result.hashtags) {
          collectedHashtags.push(tag);
        }

        // Process any direct product links found in video descriptions
        for (const productUrl of result.productLinks) {
          try {
            const externalId = extractProductId(productUrl);
            if (!externalId) continue;

            // Use the video description as a rough product title
            const title = result.videoDesc.slice(0, 200) || `TikTok viral product ${externalId}`;

            await db.insert(rawProducts).values({
              source: 'tiktok_shop',
              external_id: externalId,
              title,
              price_usd: '0.00', // Price unknown from search — will be enriched later
              currency: 'USD',
              category: 'TikTok Viral',
              product_url: productUrl,
              image_urls: [],
              tags: ['tiktok_viral', `search:${query}`],
              batch_id: batchId,
            });

            totalInserted++;
          } catch (err) {
            logger.error({ err, batchId }, 'Failed to insert product from TikTok search');
          }
        }
      }

      await randomDelay(5000, 10_000);
    }

    // ============================================================
    // Phase 3: Capture hashtag trends as trend_signals
    // ============================================================

    logger.info({ hashtagCount: collectedHashtags.length, batchId }, 'Capturing TikTok hashtag trends');
    const trendsCaptured = await captureHashtagTrends(page, collectedHashtags);
    logger.info({ trendsCaptured, batchId }, 'Hashtag trend capture complete');

    await context.close();
  } catch (err) {
    logger.error({ err, batchId }, 'TikTok Shop scraper crashed');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  logger.info({ batchId, totalInserted }, 'TikTok Shop scraper finished');
  return { productsFound: totalInserted };
}
