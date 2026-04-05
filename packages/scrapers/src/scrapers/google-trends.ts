import { desc, eq } from 'drizzle-orm';
import { db, trendSignals, logger } from '@ghostmarket/shared';
import type { ScraperJobConfig } from '../queue.js';

// --- User-agent rotation ---

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// --- Commercial intent detection ---

const COMMERCIAL_MODIFIERS = [
  'buy', 'cheap', 'best', 'price', 'deal',
  'sale', 'discount', 'review', 'vs', 'alternative',
];

function hasCommercialIntent(texts: string[]): boolean {
  const joined = texts.join(' ').toLowerCase();
  return COMMERCIAL_MODIFIERS.some((mod) => joined.includes(mod));
}

// --- Traffic parsing ---

function parseTrafficVolume(formatted: string): number {
  if (!formatted) return 0;
  const cleaned = formatted.replace(/[+,]/g, '').trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!match) {
    // Try plain number
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }
  const num = parseFloat(match[1]);
  const suffix = (match[2] ?? '').toUpperCase();
  if (suffix === 'B') return num * 1_000_000_000;
  if (suffix === 'M') return num * 1_000_000;
  if (suffix === 'K') return num * 1_000;
  return num;
}

function trafficToScore(volume: number, maxVolume: number): number {
  if (maxVolume <= 0) return 50;
  return Math.min(100, Math.round((volume / maxVolume) * 100));
}

// --- HTTP fetch with retry on 429 ---

async function fetchWithRetry(url: string, maxRetries = 3): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': randomUA(),
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (res.status === 429) {
      if (attempt < maxRetries) {
        logger.warn({ url, attempt }, 'Google Trends 429 rate limit — waiting 60s');
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      throw new Error(`Google Trends rate limited after ${maxRetries} attempts`);
    }

    if (!res.ok) {
      throw new Error(`Google Trends HTTP ${res.status}: ${res.statusText}`);
    }

    return res.text();
  }

  throw new Error('Unreachable');
}

// --- RSS feed parsing ---

interface RssTrend {
  keyword: string;
  traffic: number;
  newsSources: string[];
  newsHeadlines: string[];
}

function parseRssFeed(xml: string): RssTrend[] {
  const trends: RssTrend[] = [];

  // Split on <item> tags
  const items = xml.split('<item>').slice(1); // first split is the preamble

  for (const item of items) {
    const titleMatch = item.match(/<title>([^<]+)<\/title>/);
    const trafficMatch = item.match(/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/);

    if (!titleMatch) continue;

    const keyword = titleMatch[1].trim();
    const traffic = parseTrafficVolume(trafficMatch?.[1] ?? '0');

    // Extract news headlines and sources
    const headlines: string[] = [];
    const sources: string[] = [];
    const newsItemTitles = item.matchAll(/<ht:news_item_title>([^<]+)<\/ht:news_item_title>/g);
    for (const m of newsItemTitles) {
      headlines.push(m[1]);
    }
    const newsItemSources = item.matchAll(/<ht:news_item_source>([^<]+)<\/ht:news_item_source>/g);
    for (const m of newsItemSources) {
      sources.push(m[1]);
    }

    trends.push({
      keyword,
      traffic,
      newsSources: sources,
      newsHeadlines: headlines,
    });
  }

  return trends;
}

// --- Velocity calculation ---

async function getPreviousScore(keyword: string): Promise<{ score: number; capturedAt: Date } | null> {
  const rows = await db
    .select({
      interest_score: trendSignals.interest_score,
      captured_at: trendSignals.captured_at,
    })
    .from(trendSignals)
    .where(eq(trendSignals.keyword, keyword))
    .orderBy(desc(trendSignals.captured_at))
    .limit(1);

  if (rows.length === 0 || !rows[0].captured_at) return null;
  return { score: rows[0].interest_score, capturedAt: rows[0].captured_at };
}

function calculateVelocity(
  currentScore: number,
  previous: { score: number; capturedAt: Date } | null,
): number {
  if (!previous) return currentScore;
  const hoursElapsed = (Date.now() - previous.capturedAt.getTime()) / (1000 * 60 * 60);
  if (hoursElapsed < 0.01) return 0;
  return (currentScore - previous.score) / hoursElapsed;
}

// --- Main scraper ---

export async function scrapeGoogleTrends(
  batchId: string,
  config: ScraperJobConfig,
): Promise<{ productsFound: number }> {
  const geo = config.geo ?? 'US';
  let captured = 0;

  logger.info({ batchId, geo }, 'Google Trends scraper starting');

  // --- Fetch RSS feed (the working endpoint) ---
  let rssTrends: RssTrend[] = [];
  try {
    const rssUrl = `https://trends.google.com/trending/rss?geo=${geo}`;
    const rssRaw = await fetchWithRetry(rssUrl);
    rssTrends = parseRssFeed(rssRaw);
    logger.info({ count: rssTrends.length, batchId }, 'RSS trends fetched');
  } catch (err) {
    logger.error({ err, batchId }, 'Failed to fetch Google Trends RSS');
  }

  // --- Fallback: try legacy JSON endpoints ---
  if (rssTrends.length === 0) {
    try {
      const dailyUrl = `https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=-300&geo=${geo}&ns=15`;
      const dailyRaw = await fetchWithRetry(dailyUrl);
      // Strip )]}' prefix
      const jsonStr = dailyRaw.slice(dailyRaw.indexOf('{'));
      const json = JSON.parse(jsonStr);
      const days = json?.default?.trendingSearchesDays ?? [];
      for (const day of days) {
        for (const item of day.trendingSearches ?? []) {
          if (item?.title?.query) {
            rssTrends.push({
              keyword: item.title.query,
              traffic: parseTrafficVolume(item.formattedTraffic ?? '0'),
              newsSources: (item.articles ?? []).map((a: { source?: string }) => a.source ?? '').filter(Boolean),
              newsHeadlines: [],
            });
          }
        }
      }
      logger.info({ count: rssTrends.length, batchId }, 'Legacy daily trends fetched');
    } catch (err) {
      logger.warn({ err, batchId }, 'Legacy daily trends endpoint also failed');
    }
  }

  if (rssTrends.length === 0) {
    logger.warn({ batchId }, 'No trends from any source — returning 0');
    return { productsFound: 0 };
  }

  // --- Process trends ---
  const maxTraffic = rssTrends.reduce((max, t) => Math.max(max, t.traffic), 1);

  for (const trend of rssTrends) {
    try {
      const interestScore = trafficToScore(trend.traffic, maxTraffic);
      const previous = await getPreviousScore(trend.keyword);
      const velocity = calculateVelocity(interestScore, previous);
      const relatedQueries = [...trend.newsHeadlines.slice(0, 3), ...trend.newsSources.slice(0, 3)];

      await db.insert(trendSignals).values({
        keyword: trend.keyword,
        source: 'google_trends',
        interest_score: interestScore,
        velocity: velocity.toFixed(4),
        related_queries: relatedQueries,
        geo,
        captured_at: new Date(),
      });

      captured++;
      logger.info({ keyword: trend.keyword, score: interestScore, traffic: trend.traffic }, 'Trend captured');
    } catch (err) {
      logger.error({ err, keyword: trend.keyword, batchId }, 'Failed to insert trend');
    }
  }

  logger.info({ batchId, captured, geo }, 'Google Trends scraper finished');
  return { productsFound: captured };
}
