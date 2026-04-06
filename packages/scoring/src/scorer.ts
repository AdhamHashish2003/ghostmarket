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
]);

function extractSignificantWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
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

// --- 3. Trend Score (weight 0.25) ---

async function computeTrendScore(
  product: RawProductRow,
): Promise<{ score: number; trendKeywords: string[] }> {
  const words = extractSignificantWords(product.title);
  if (words.length === 0) return { score: 15, trendKeywords: [] };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const trendKeywords: string[] = [];
  let bestInterestScore = 0;
  let bestVelocity = 0;

  // Query trend_signals for each significant word
  for (const word of words.slice(0, 8)) {
    const trends = await db
      .select({
        keyword: trendSignals.keyword,
        interest_score: trendSignals.interest_score,
        velocity: trendSignals.velocity,
      })
      .from(trendSignals)
      .where(
        and(
          ilike(trendSignals.keyword, `%${word}%`),
          gte(trendSignals.captured_at, sevenDaysAgo),
        ),
      )
      .orderBy(desc(trendSignals.interest_score))
      .limit(3);

    for (const t of trends) {
      if (t.interest_score > bestInterestScore) {
        bestInterestScore = t.interest_score;
        bestVelocity = parseFloat(t.velocity ?? '0');
      }
      if (!trendKeywords.includes(t.keyword)) {
        trendKeywords.push(t.keyword);
      }
    }
  }

  if (trendKeywords.length === 0) {
    return { score: 15, trendKeywords: [] };
  }

  // Apply velocity multiplier
  let velocityMultiplier = 1.0;
  if (bestVelocity > 5) velocityMultiplier = 1.5;
  else if (bestVelocity > 2) velocityMultiplier = 1.2;

  const score = Math.min(100, Math.round(bestInterestScore * velocityMultiplier));
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
