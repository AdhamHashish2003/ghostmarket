import { eq, and, desc, gte, ilike, sql } from 'drizzle-orm';
import { db, rawProducts, trendSignals, logger } from '@ghostmarket/shared';
import { filterProduct } from './brand-filter.js';
import { analyzeTrend } from './trend-analyzer.js';

// --- Stopwords for trend matching ---

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
  'this', 'that', 'new', 'set', 'not', 'no', 'so', 'up', 'out', 'if',
  'do', 'has', 'had', 'its', 'my', 'all', 'can', 'get', 'got', 'one',
  'two', 'use', 'may', 'day', 'way', 'own', 'men', 'man', 'big', 'top',
  'pro', 'best', 'kit', 'pack', 'piece', 'mini', 'max', 'ultra',
  'plus', 'super', 'into', 'your', 'will', 'size', 'type', 'free',
  'inch', 'made', 'home', 'work', 'high', 'full', 'real', 'original',
  'digital', 'color', 'black', 'white', 'large', 'small', 'light',
  'premium', 'heavy', 'duty', 'extra', 'easy', 'great', 'good',
  'wireless', 'strip', 'roller', 'steel', 'stainless', 'travel',
  'point', 'water', 'fine', 'clear', 'strong', 'long', 'wide',
  'double', 'sided', 'proof', 'resistant', 'handle', 'design',
]);

function extractSignificantWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/** Count how many words from the product title appear as whole words in the trend keyword.
 *  For multi-word trends (e.g. "portable fan"), require at least 50% of trend words to match.
 *  Single-word trends (e.g. "fan") require an exact word match in the title. */
function computeRelevanceScore(titleWords: string[], trendKeyword: string): number {
  const trendWords = trendKeyword.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
  if (trendWords.length === 0) return 0;

  let matches = 0;
  for (const kw of trendWords) {
    for (const tw of titleWords) {
      // Exact word match, or stem match for 5+ char words
      if (tw === kw || (tw.length >= 5 && kw.length >= 5 && (kw.startsWith(tw) || tw.startsWith(kw)))) {
        matches++;
        break;
      }
    }
  }

  // For multi-word trends, require at least half the trend words to match
  // "portable fan" (2 words) → need at least 1 match
  // "digital picture frame" (3 words) → need at least 2 matches
  const minRequired = Math.max(1, Math.ceil(trendWords.length * 0.5));
  if (matches < minRequired) return 0;

  return matches;
}

// --- Types for the row shape returned by drizzle ---

interface RawProductRow {
  id: string;
  source: string;
  external_id: string;
  title: string;
  price_usd: string;
  original_price_usd: string | null;
  currency: string | null;
  estimated_monthly_sales: number | null;
  review_count: number | null;
  rating: string | null;
  category: string;
  sub_category: string | null;
  supplier_name: string | null;
  supplier_url: string | null;
  product_url: string;
  image_urls: unknown;
  tags: unknown;
  scraped_at: Date | null;
  batch_id: string;
}

export interface ScoredProductInsert {
  raw_product_id: string;
  score: string;
  sales_velocity_score: string;
  margin_score: string;
  trend_score: string;
  competition_score: string;
  fulfillment_type: 'pod' | 'dropship' | 'wholesale' | 'digital' | 'unknown';
  estimated_margin_pct: string;
  trend_keywords: string[];
  opportunity_reason: string;
  status: 'pending';
}

// --- 1. Sales Velocity Score (weight 0.30) ---

async function computeSalesVelocityScore(product: RawProductRow): Promise<number> {
  // Get previous scrapes of the same product
  const history = await db
    .select({
      estimated_monthly_sales: rawProducts.estimated_monthly_sales,
      scraped_at: rawProducts.scraped_at,
    })
    .from(rawProducts)
    .where(
      and(
        eq(rawProducts.source, product.source),
        eq(rawProducts.external_id, product.external_id),
      ),
    )
    .orderBy(desc(rawProducts.scraped_at))
    .limit(5);

  if (history.length >= 2) {
    const latest = history[0];
    const previous = history[1];

    if (
      latest.estimated_monthly_sales !== null &&
      previous.estimated_monthly_sales !== null &&
      latest.scraped_at &&
      previous.scraped_at
    ) {
      const daysBetween =
        (latest.scraped_at.getTime() - previous.scraped_at.getTime()) / (1000 * 60 * 60 * 24);

      if (daysBetween > 0.01) {
        const velocity =
          (latest.estimated_monthly_sales - previous.estimated_monthly_sales) / daysBetween;

        if (velocity > 1000) return 100;
        if (velocity > 500) return 80;
        if (velocity > 100) return 60;
        if (velocity > 10) return 40;
        if (velocity > 0) return 20;
        return 5;
      }
    }
  }

  // Fallback: single snapshot — use absolute sales as proxy
  const sales = product.estimated_monthly_sales ?? 0;
  if (sales > 10000) return 70;
  if (sales > 5000) return 55;
  if (sales > 1000) return 40;
  if (sales > 100) return 25;
  return 10;
}

// --- 2. Margin Score (weight 0.25) ---

function computeMarginScore(product: RawProductRow): { score: number; marginPct: number } {
  const priceUsd = parseFloat(product.price_usd);
  if (priceUsd <= 0) return { score: 10, marginPct: 0 };

  const estimatedSellingPrice = priceUsd * 2.5;
  const estimatedCogs = priceUsd;
  const estimatedShipping = 5.0;
  const estimatedMargin = estimatedSellingPrice - estimatedCogs - estimatedShipping;
  const marginPct = (estimatedMargin / estimatedSellingPrice) * 100;

  let score: number;
  if (marginPct > 70) score = 100;
  else if (marginPct > 60) score = 85;
  else if (marginPct > 50) score = 70;
  else if (marginPct > 40) score = 55;
  else if (marginPct > 30) score = 40;
  else if (marginPct > 20) score = 25;
  else score = 10;

  return { score, marginPct: Math.round(marginPct * 100) / 100 };
}

// --- 3. Trend Score (weight 0.30) ---

async function computeTrendScore(
  product: RawProductRow,
): Promise<{ score: number; trendKeywords: string[] }> {
  const titleWords = extractSignificantWords(product.title);
  if (titleWords.length === 0) return { score: 15, trendKeywords: [] };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetch ALL recent trend signals (deduplicated by keyword)
  const allTrends = await db
    .select({
      keyword: trendSignals.keyword,
      interest_score: trendSignals.interest_score,
      velocity: trendSignals.velocity,
    })
    .from(trendSignals)
    .where(gte(trendSignals.captured_at, sevenDaysAgo))
    .orderBy(desc(trendSignals.interest_score));

  // Deduplicate trends by keyword (keep highest interest score)
  const seenKeywords = new Set<string>();
  const uniqueTrends: typeof allTrends = [];
  for (const t of allTrends) {
    const k = t.keyword.toLowerCase();
    if (!seenKeywords.has(k)) {
      seenKeywords.add(k);
      uniqueTrends.push(t);
    }
  }

  // Score each trend by RELEVANCE to this product (word overlap), not just interest
  const scoredTrends: { keyword: string; interest: number; velocity: number; relevance: number; combined: number }[] = [];

  for (const trend of uniqueTrends) {
    const relevance = computeRelevanceScore(titleWords, trend.keyword);
    if (relevance === 0) continue; // No word-level match at all

    const velocity = parseFloat(trend.velocity ?? '0');
    // Combined score: relevance is king, interest is secondary
    const combined = relevance * 100 + trend.interest_score + Math.min(velocity * 2, 20);

    scoredTrends.push({
      keyword: trend.keyword,
      interest: trend.interest_score,
      velocity,
      relevance,
      combined,
    });
  }

  // Sort by combined relevance (not just interest score!)
  scoredTrends.sort((a, b) => b.combined - a.combined);

  if (scoredTrends.length === 0) {
    return { score: 15, trendKeywords: [] };
  }

  // Take top 3 most RELEVANT trends
  const topTrends = scoredTrends.slice(0, 3);
  const bestTrend = topTrends[0];

  // Score based on the best relevant trend
  let velocityMultiplier = 1.0;
  if (bestTrend.velocity > 5) velocityMultiplier = 1.5;
  else if (bestTrend.velocity > 2) velocityMultiplier = 1.2;

  const score = Math.min(100, Math.round(bestTrend.interest * velocityMultiplier));
  const trendKeywords = topTrends.map(t => t.keyword);

  return { score, trendKeywords };
}

// --- 4. Competition Score (weight 0.20) ---

async function computeCompetitionScore(product: RawProductRow): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rawProducts)
    .where(
      and(
        eq(rawProducts.category, product.category),
        gte(rawProducts.scraped_at, sevenDaysAgo),
      ),
    );

  const competitors = result[0]?.count ?? 0;

  if (competitors < 10) return 90;
  if (competitors < 50) return 70;
  if (competitors < 100) return 50;
  if (competitors < 500) return 30;
  return 15;
}

// --- 5. Fulfillment Type Detection ---

function detectFulfillmentType(product: RawProductRow): 'pod' | 'dropship' | 'wholesale' | 'digital' | 'unknown' {
  const priceUsd = parseFloat(product.price_usd);
  const category = product.category.toLowerCase();
  const tags = Array.isArray(product.tags) ? product.tags as string[] : [];
  const title = product.title.toLowerCase();

  const digitalCategories = ['digital', 'software', 'ebooks', 'e-books', 'downloads'];
  if (priceUsd < 5 && digitalCategories.some((c) => category.includes(c))) {
    return 'digital';
  }

  const podIndicators = ['customizable', 'custom', 'print', 'personalized', 'pod'];
  if (
    tags.some((t) => podIndicators.includes(String(t).toLowerCase())) ||
    podIndicators.some((p) => title.includes(p))
  ) {
    return 'pod';
  }

  if (priceUsd < 15) return 'dropship';
  if (priceUsd >= 15) return 'wholesale';
  return 'unknown';
}

// --- Main scoring function ---

export async function scoreProduct(product: RawProductRow): Promise<ScoredProductInsert | null> {
  // Brand filter — reject products small sellers can't compete on
  const filterResult = filterProduct({
    title: product.title,
    price_usd: product.price_usd,
    category: product.category,
    review_count: product.review_count,
    tags: product.tags,
  });

  if (!filterResult.allowed) {
    logger.info({ title: product.title.slice(0, 60), reason: filterResult.reason }, 'Filtered out');
    return null;
  }

  const [salesVelocity, { score: marginScore, marginPct }, { score: trendScore, trendKeywords }, competitionScore] =
    await Promise.all([
      computeSalesVelocityScore(product),
      Promise.resolve(computeMarginScore(product)),
      computeTrendScore(product),
      computeCompetitionScore(product),
    ]);

  // New weights: trend-first, margin-critical, opportunity bonus matters
  const opportunityBonus = filterResult.opportunityBonus;
  const normalizedBonus = Math.min(100, opportunityBonus * 2); // Scale 0-55 → 0-100+

  const finalScore =
    salesVelocity * 0.20 +
    marginScore * 0.25 +
    trendScore * 0.30 +
    competitionScore * 0.15 +
    normalizedBonus * 0.10;

  const fulfillmentType = detectFulfillmentType(product);

  // Get matched trend details for the analyzer
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const matchedTrends: { keyword: string; interest_score: number; velocity: string }[] = [];
  for (const kw of trendKeywords.slice(0, 3)) {
    const rows = await db
      .select({ keyword: trendSignals.keyword, interest_score: trendSignals.interest_score, velocity: trendSignals.velocity })
      .from(trendSignals)
      .where(and(eq(trendSignals.keyword, kw), gte(trendSignals.captured_at, sevenDaysAgo)))
      .orderBy(desc(trendSignals.interest_score))
      .limit(1);
    if (rows.length > 0) matchedTrends.push({ keyword: rows[0].keyword, interest_score: rows[0].interest_score, velocity: rows[0].velocity ?? '0' });
  }

  // Trend-adjacent bonus
  if (matchedTrends.length > 0) {
    // Already accounted for in trend_score, but add explicit bonus via filter
  }

  const scoreData = {
    score: finalScore.toFixed(3),
    sales_velocity_score: salesVelocity.toFixed(3),
    margin_score: marginScore.toFixed(3),
    trend_score: trendScore.toFixed(3),
    competition_score: competitionScore.toFixed(3),
    fulfillment_type: fulfillmentType,
    estimated_margin_pct: marginPct.toFixed(2),
    trend_keywords: trendKeywords,
  };

  // Generate opportunity reasoning
  const opportunityReason = await analyzeTrend(
    { title: product.title, price_usd: product.price_usd, estimated_monthly_sales: product.estimated_monthly_sales, source: product.source, category: product.category, review_count: product.review_count },
    matchedTrends,
    scoreData,
  );

  return {
    ...scoreData,
    raw_product_id: product.id,
    opportunity_reason: opportunityReason,
    status: 'pending',
  };
}
