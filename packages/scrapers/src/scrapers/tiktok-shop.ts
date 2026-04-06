import { chromium, type Browser, type Page } from 'playwright';
import { desc, eq } from 'drizzle-orm';
import { db, rawProducts, trendSignals, logger } from '@ghostmarket/shared';
import type { ScraperJobConfig } from '../queue.js';
import { mkdir } from 'node:fs/promises';

// --- Helpers ---

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
];

function randomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }
function randomDelay(min: number, max: number) { return new Promise<void>(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min)); }

async function screenshot(page: Page, label: string) {
  try {
    await mkdir('/tmp/scraper-errors', { recursive: true });
    const f = `/tmp/scraper-errors/tiktok-${label}-${Date.now()}.png`;
    await page.screenshot({ path: f, fullPage: false });
    logger.info({ filename: f }, 'Screenshot saved');
  } catch { /* ignore */ }
}

function parsePrice(t: string): number | null {
  if (!t) return null;
  const m = t.replace(/,/g, '').match(/\$?\s*(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

function parseSoldCount(t: string): number {
  if (!t) return 0;
  const c = t.toLowerCase().replace(/,/g, '');
  const k = c.match(/([\d.]+)\s*k/); if (k) return Math.round(parseFloat(k[1]) * 1000);
  const m = c.match(/([\d.]+)\s*m/); if (m) return Math.round(parseFloat(m[1]) * 1_000_000);
  const n = c.match(/(\d+)/); return n ? parseInt(n[1], 10) : 0;
}

function parseViewCount(t: string): number {
  if (!t) return 0;
  const c = t.toLowerCase().replace(/,/g, '').trim();
  const b = c.match(/([\d.]+)\s*b/); if (b) return Math.round(parseFloat(b[1]) * 1_000_000_000);
  const m = c.match(/([\d.]+)\s*m/); if (m) return Math.round(parseFloat(m[1]) * 1_000_000);
  const k = c.match(/([\d.]+)\s*k/); if (k) return Math.round(parseFloat(k[1]) * 1_000);
  const n = c.match(/(\d+)/); return n ? parseInt(n[1], 10) : 0;
}

function extractProductId(url: string): string | null {
  const p = url.match(/\/product(?:-detail)?\/(\d+)/); if (p) return p[1];
  const q = url.match(/[?&]product_id=(\d+)/); if (q) return q[1];
  // TikTok shop URLs with long numeric IDs
  const l = url.match(/(\d{10,})/); if (l) return l[1];
  // Fallback: generate a hash from the URL for dedup
  if (url.includes('shop.tiktok.com') || url.includes('tiktok.com/shop')) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
    return `tt${Math.abs(hash)}`;
  }
  return null;
}

// --- Navigate with block detection ---

async function navigateSafely(page: Page, url: string): Promise<'ok' | 'blocked' | 'failed'> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (resp && resp.status() === 404) return 'failed';

      await page.waitForTimeout(3000);

      const blocked = await page.evaluate(`(() => {
        var body = (document.body.textContent || '').toLowerCase();
        var url = location.href.toLowerCase();
        if (body.indexOf('verify to continue') >= 0 || body.indexOf('slide to verify') >= 0 || document.querySelector('#captcha-verify-container')) return 'captcha';
        if (url.indexOf('/login') >= 0 || (body.indexOf('log in to continue') >= 0)) return 'login';
        return false;
      })()`);

      if (blocked) {
        logger.warn({ url, blocked, attempt }, 'TikTok blocked');
        await screenshot(page, `${blocked}-${attempt}`);
        if (attempt < 2) { await page.waitForTimeout(15_000); continue; }
        return 'blocked';
      }
      return 'ok';
    } catch (err) {
      logger.warn({ url, attempt, err: err instanceof Error ? err.message : String(err) }, 'TikTok nav error');
      if (attempt < 2) await page.waitForTimeout(10_000);
    }
  }
  return 'failed';
}

// --- Google search fallback for TikTok Shop products ---

const GOOGLE_EXTRACT_SCRIPT = `(() => {
  var results = [];
  var junkTitles = ['ai mode', 'shopping', 'images', 'videos', 'news', 'maps', 'past hour', 'past day', 'past week', 'past month', 'past year', 'all', 'verbatim'];

  // Only match absolute TikTok Shop URLs — not Google internal /search links
  var isTikTokProduct = function(href) {
    return (href.indexOf('https://shop.tiktok.com') === 0 || href.indexOf('https://www.tiktok.com/shop') === 0 || href.indexOf('https://www.tiktok.com/view/product') === 0) && href.indexOf('/search') === -1;
  };

  // Search through Google result blocks with h3 titles
  var resultBlocks = document.querySelectorAll('.g');
  resultBlocks.forEach(function(block) {
    var titleEl = block.querySelector('h3');
    if (!titleEl) return;
    var title = titleEl.textContent.trim();
    if (title.length < 10 || junkTitles.indexOf(title.toLowerCase()) >= 0) return;

    var links = block.querySelectorAll('a[href]');
    links.forEach(function(a) {
      var href = a.getAttribute('href') || '';
      if (!isTikTokProduct(href)) return;
      var descEl = block.querySelector('[class*="VwiC3b"]');
      var desc = descEl ? descEl.textContent.trim() : '';
      var priceMatch = (title + ' ' + desc).match(/\\$(\\d+\\.?\\d*)/);
      var price = priceMatch ? '$' + priceMatch[1] : '';
      results.push({ title: title.substring(0, 300), price: price, productUrl: href, desc: desc.substring(0, 200) });
    });
  });

  var seen = {};
  return results.filter(function(r) { if (seen[r.title]) return false; seen[r.title] = true; return true; });
})()`;

// --- TikTok hashtag trend_signals extraction ---

const TRENDING_HASHTAGS = [
  'tiktokmademebuyit', 'amazonfinds', 'tiktokshop', 'viralproducts',
  'trendingproducts', 'shopfinds', 'musthaves', 'bestfinds',
  'tiktokfinds', 'homefinds', 'beautyfinds', 'techfinds',
];

// --- Main scraper ---

export async function scrapeTiktokShop(
  batchId: string,
  config: ScraperJobConfig,
): Promise<{ productsFound: number }> {
  const maxPages = config.max_pages ?? 3;
  let totalInserted = 0;
  const collectedHashtags: string[] = [];

  logger.info({ batchId, maxPages }, 'TikTok Shop scraper starting');

  let browser: Browser | null = null;

  try {
    const isHeaded = process.env.SCRAPER_HEADED === 'true';
    browser = await chromium.launch({
      headless: !isHeaded,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      userAgent: randomUA(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    });

    // Hide webdriver
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(45_000);

    // Block heavy resources
    await page.route('**/*.{woff,woff2,ttf,otf}', r => r.abort());
    await page.route('**/analytics*', r => r.abort());

    // ============================================================
    // Phase 1: Try TikTok Shop direct pages
    // ============================================================

    const shopUrls = [
      'https://shop.tiktok.com/',
      'https://shop.tiktok.com/bestsellers',
    ];

    for (const url of shopUrls) {
      logger.info({ url, batchId }, 'Trying TikTok Shop direct URL');
      const status = await navigateSafely(page, url);
      if (status !== 'ok') {
        logger.warn({ url, status, batchId }, 'TikTok Shop blocked — trying next');
        continue;
      }

      // Scroll for lazy load
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(1000);
      }

      // Extract using raw JS
      const products = await page.evaluate(`(() => {
        var selectors = ['[class*="ProductCard"]', '[class*="product-card"]', '[data-e2e="product-card"]', '[class*="GoodsCard"]', 'a[href*="/product"]'];
        var cards = [];
        for (var i = 0; i < selectors.length; i++) {
          var found = document.querySelectorAll(selectors[i]);
          if (found.length > 0) { cards = Array.from(found); break; }
        }
        if (cards.length === 0) return [];
        return cards.map(function(card) {
          var titleEl = card.querySelector('[class*="title"], [class*="name"], h3, h2');
          var title = titleEl ? titleEl.textContent.trim() : '';
          var priceEl = card.querySelector('[class*="price"], [class*="Price"]');
          var price = priceEl ? priceEl.textContent.trim() : '';
          var soldEl = card.querySelector('[class*="sold"], [class*="sale"]');
          var sold = soldEl ? soldEl.textContent.trim() : '';
          var linkEl = card.querySelector('a[href*="/product"]') || card.closest('a');
          var href = linkEl ? (linkEl.getAttribute('href') || '') : '';
          var productUrl = href.startsWith('http') ? href : href.startsWith('//') ? 'https:' + href : href.startsWith('/') ? 'https://shop.tiktok.com' + href : '';
          var imgEl = card.querySelector('img');
          var imageUrl = imgEl ? (imgEl.getAttribute('src') || '') : '';
          return { title: title, price: price, sold: sold, productUrl: productUrl, imageUrl: imageUrl };
        }).filter(function(p) { return p.title && p.title.length > 3 && p.productUrl; });
      })()`) as any[];

      if (products.length > 0) {
        logger.info({ url, count: products.length, batchId }, 'TikTok Shop products found!');
        for (const raw of products) {
          try {
            const externalId = extractProductId(raw.productUrl);
            if (!externalId) continue;
            const priceUsd = parsePrice(raw.price);
            const soldCount = parseSoldCount(raw.sold);
            await db.insert(rawProducts).values({
              source: 'tiktok_shop', external_id: externalId,
              title: raw.title.slice(0, 500), price_usd: (priceUsd ?? 0).toFixed(2),
              currency: 'USD', estimated_monthly_sales: soldCount || null,
              category: 'TikTok Shop', product_url: raw.productUrl,
              image_urls: raw.imageUrl ? [raw.imageUrl] : [], tags: ['tiktok_shop', 'tiktok_viral'],
              batch_id: batchId,
            });
            totalInserted++;
          } catch { /* skip */ }
        }
      } else {
        logger.warn({ url, batchId }, 'No TikTok Shop products found');
        await screenshot(page, 'shop-empty');
      }

      await randomDelay(5000, 10_000);
    }

    // ============================================================
    // Phase 2: Google search fallback — find TikTok Shop products via Google
    // ============================================================

    if (totalInserted < 20) {
      logger.info({ batchId }, 'Phase 2: Google search for TikTok Shop products');

      const googleQueries = [
        'site:shop.tiktok.com trending products',
        'site:shop.tiktok.com bestseller 2025',
        'tiktokmademebuyit products shop buy',
        'tiktok shop bestselling products price',
        '"shop.tiktok.com" product buy',
      ];

      for (const query of googleQueries) {
        const gUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=30`;
        logger.info({ query, batchId }, 'Searching Google for TikTok products');

        const status = await navigateSafely(page, gUrl);
        if (status !== 'ok') {
          logger.warn({ query, status }, 'Google search blocked');
          continue;
        }

        await page.waitForTimeout(3000);

        const gResults = await page.evaluate(GOOGLE_EXTRACT_SCRIPT) as any[];

        if (gResults.length > 0) {
          logger.info({ query, count: gResults.length, samples: gResults.slice(0, 3).map((r: any) => ({ title: r.title?.slice(0, 60), url: r.productUrl?.slice(0, 80), price: r.price })), batchId }, 'Google found TikTok Shop links');
          for (const raw of gResults) {
            try {
              const externalId = extractProductId(raw.productUrl);
              if (!externalId) {
                logger.debug({ url: raw.productUrl?.slice(0, 80) }, 'Skipped: no product ID');
                continue;
              }
              const priceUsd = parsePrice(raw.price);
              await db.insert(rawProducts).values({
                source: 'tiktok_shop', external_id: externalId,
                title: raw.title.slice(0, 500), price_usd: (priceUsd ?? 0).toFixed(2),
                currency: 'USD', category: 'TikTok Viral',
                product_url: raw.productUrl, image_urls: [], tags: ['tiktok_viral', 'google_discovery'],
                batch_id: batchId,
              });
              totalInserted++;
            } catch { /* skip dupes */ }
          }
        } else {
          logger.warn({ query, batchId }, 'No TikTok product links in Google results');
        }

        await randomDelay(5000, 10_000);
        if (totalInserted >= 30) break;
      }
    }

    // ============================================================
    // Phase 3: Capture TikTok hashtag trends as trend_signals
    // ============================================================

    logger.info({ batchId }, 'Phase 3: Capturing TikTok hashtag trends');

    const allTags = new Set([
      ...TRENDING_HASHTAGS,
      ...collectedHashtags.map(h => h.replace(/^#/, '').toLowerCase()).filter(h => h.length > 2),
    ]);

    let trendsCaptured = 0;
    let consecutiveBlocks = 0;

    for (const tag of allTags) {
      // Stop trying if TikTok is consistently blocking
      if (consecutiveBlocks >= 3) {
        logger.warn({ batchId, consecutiveBlocks }, 'TikTok consistently blocking hashtag pages — stopping Phase 3');
        break;
      }

      try {
        const url = `https://www.tiktok.com/tag/${tag}`;
        const status = await navigateSafely(page, url);
        if (status !== 'ok') { consecutiveBlocks++; continue; }

        await page.waitForTimeout(3000);

        const viewText = await page.evaluate(`(() => {
          var el = document.querySelector('[class*="StatsCount"], [data-e2e="challenge-vvcount"], [class*="view-count"], h2 + h3, [class*="stats"] strong');
          return el ? el.textContent.trim() : '';
        })()`) as string;

        const viewCount = parseViewCount(viewText);
        if (viewCount <= 0) continue;

        // Scale to interest score
        let interestScore: number;
        if (viewCount >= 1_000_000_000) interestScore = 100;
        else if (viewCount >= 100_000_000) interestScore = 80;
        else if (viewCount >= 10_000_000) interestScore = 60;
        else if (viewCount >= 1_000_000) interestScore = 40;
        else if (viewCount >= 100_000) interestScore = 20;
        else interestScore = 10;

        // Calculate velocity from previous capture
        const prevRows = await db
          .select({ interest_score: trendSignals.interest_score, captured_at: trendSignals.captured_at })
          .from(trendSignals)
          .where(eq(trendSignals.keyword, `#${tag}`))
          .orderBy(desc(trendSignals.captured_at))
          .limit(1);

        let velocity = interestScore;
        if (prevRows.length > 0 && prevRows[0].captured_at) {
          const hoursElapsed = (Date.now() - prevRows[0].captured_at.getTime()) / (1000 * 60 * 60);
          if (hoursElapsed > 0.01) velocity = (interestScore - prevRows[0].interest_score) / hoursElapsed;
        }

        await db.insert(trendSignals).values({
          keyword: `#${tag}`, source: 'tiktok', interest_score: interestScore,
          velocity: velocity.toFixed(4),
          related_queries: [...allTags].filter(t => t !== tag).slice(0, 10),
          geo: 'US', captured_at: new Date(),
        });

        trendsCaptured++;
        consecutiveBlocks = 0;
        logger.info({ tag, views: viewCount, interestScore }, 'TikTok hashtag trend captured');

        await randomDelay(3000, 6000);
      } catch (err) {
        logger.error({ err, tag }, 'Failed to capture hashtag trend');
      }
    }

    logger.info({ trendsCaptured, batchId }, 'Hashtag trend capture complete');

    await context.close();
  } catch (err) {
    logger.error({ err, batchId }, 'TikTok Shop scraper crashed');
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  logger.info({ batchId, totalInserted }, 'TikTok Shop scraper finished');
  return { productsFound: totalInserted };
}
