import { logger } from '@ghostmarket/shared';

interface ProductData {
  title: string;
  price_usd: string;
  estimated_monthly_sales: number | null;
  source: string;
  category: string;
  review_count: number | null;
}

interface TrendMatch {
  keyword: string;
  interest_score: number;
  velocity: string;
}

interface ScoreData {
  score: string;
  sales_velocity_score: string;
  margin_score: string;
  trend_score: string;
  competition_score: string;
  fulfillment_type: string;
  estimated_margin_pct: string;
  trend_keywords: string[];
}

export async function analyzeTrend(
  product: ProductData,
  matchedTrends: TrendMatch[],
  score: ScoreData,
): Promise<string> {
  const price = parseFloat(product.price_usd);
  const sellingPrice = Math.round(price * 2.5 * 100) / 100;
  const marginPct = parseFloat(score.estimated_margin_pct);
  const sales = product.estimated_monthly_sales ?? 0;
  const competitionScore = parseFloat(score.competition_score);
  const trendScore = parseFloat(score.trend_score);
  const fulfillment = score.fulfillment_type;

  // Try Groq API if available
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const trendText = matchedTrends.length > 0
        ? matchedTrends.map(t => `"${t.keyword}" (interest: ${t.interest_score}/100, velocity: ${t.velocity})`).join(', ')
        : 'No direct trend match';

      const prompt = `You are a product opportunity analyst for an e-commerce entrepreneur. Given this product data and trend signals, write a 2-3 sentence explanation of why this is a good opportunity to sell RIGHT NOW. Be specific with numbers. Focus on: why demand exists, why a small seller can compete, and the margin opportunity.

Product: ${product.title} | Price: $${price} | Monthly sales: ${sales} | Source: ${product.source} | Category: ${product.category}
Matching trends: ${trendText}
Score breakdown: Sales velocity ${score.sales_velocity_score}/100, Margin ${score.margin_score}/100, Trend ${score.trend_score}/100, Competition ${score.competition_score}/100
Overall score: ${score.score}/100`;

      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
          temperature: 0.7,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const reason = data.choices?.[0]?.message?.content?.trim();
        if (reason && reason.length > 20) return reason;
      }
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'Groq API failed, using template');
    }
  }

  // Template-based fallback
  const parts: string[] = [];

  // Trend match
  if (matchedTrends.length > 0) {
    const top = matchedTrends[0];
    const vel = parseFloat(top.velocity);
    parts.push(
      `"${top.keyword}" is trending at ${top.interest_score}/100 interest${vel > 5 ? ` and rising ${vel.toFixed(0)}% daily` : ''}.`
    );
  }

  // Margin + price
  if (marginPct > 0) {
    parts.push(
      `At $${price.toFixed(2)} cost, selling at $${sellingPrice.toFixed(2)} gives ~${marginPct.toFixed(0)}% margin.`
    );
  }

  // Competition
  if (competitionScore > 70) {
    parts.push('Low competition in this category — early mover advantage.');
  } else if (competitionScore > 50) {
    parts.push('Moderate competition — differentiation through listing quality or bundling recommended.');
  }

  // Fulfillment
  if (fulfillment === 'dropship') {
    parts.push('Can be dropshipped with no inventory risk.');
  } else if (fulfillment === 'pod') {
    parts.push('POD opportunity — add custom designs for higher margins.');
  }

  // Sales validation
  if (sales > 5000) {
    parts.push(`${sales.toLocaleString()} monthly sales prove strong demand.`);
  } else if (sales > 1000) {
    parts.push(`${sales.toLocaleString()} monthly sales show validated demand.`);
  }

  return parts.slice(0, 3).join(' ');
}
