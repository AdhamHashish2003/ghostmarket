// GhostMarket Tracker Agent
// Collects performance metrics from Buffer analytics and landing pages
// Writes to campaign_metrics table to close the learning loop

import { getDb, uuid, withRetry } from '../../shared/db.js';
import type { ContentPost } from '../../shared/types.js';

const BUFFER_ACCESS_TOKEN = process.env.BUFFER_ACCESS_TOKEN || '';

// ============================================================
// Buffer Analytics Collection
// ============================================================

async function collectBufferAnalytics(): Promise<void> {
  if (!BUFFER_ACCESS_TOKEN) return;

  const db = getDb();
  const posts = db.prepare(`
    SELECT cp.*, p.keyword, p.id as pid
    FROM content_posts cp
    JOIN products p ON p.id = cp.product_id
    WHERE cp.buffer_post_id IS NOT NULL
      AND p.stage = 'live'
  `).all() as Array<ContentPost & { keyword: string; pid: string }>;

  if (!posts.length) return;

  for (const post of posts) {
    if (!post.buffer_post_id) continue;

    try {
      const resp = await fetch(
        `https://api.bufferapp.com/1/updates/${post.buffer_post_id}/interactions.json?access_token=${BUFFER_ACCESS_TOKEN}`,
      );

      if (!resp.ok) continue;
      const data = await resp.json() as { interactions?: Array<{ type: string; count: number }> };

      let impressions = 0;
      let engagement = 0;
      let clicks = 0;

      if (data.interactions) {
        for (const interaction of data.interactions) {
          if (interaction.type === 'impressions') impressions = interaction.count;
          if (interaction.type === 'clicks') clicks = interaction.count;
          if (['likes', 'comments', 'shares', 'retweets'].includes(interaction.type)) {
            engagement += interaction.count;
          }
        }
      }

      // Update post metrics
      withRetry(() => {
        db.prepare(`
          UPDATE content_posts SET impressions = ?, engagement = ?, clicks = ? WHERE id = ?
        `).run(impressions, engagement, clicks, post.id);
      });

      // Log to campaign_metrics
      const today = new Date().toISOString().split('T')[0];
      withRetry(() => {
        db.prepare(`
          INSERT INTO campaign_metrics (id, product_id, date, source, impressions, clicks, conversions)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(uuid(), post.product_id, today, post.platform, impressions, clicks);
      });

    } catch (err) {
      console.error(`[Tracker] Buffer analytics failed for post ${post.buffer_post_id}:`, err);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[Tracker] Collected analytics for ${posts.length} Buffer posts`);
}

// ============================================================
// Aggregate Product Metrics
// ============================================================

function aggregateProductMetrics(): void {
  const db = getDb();

  // Get all live/tracking products
  const products = db.prepare(`
    SELECT id, keyword FROM products WHERE stage IN ('live', 'tracking')
  `).all() as Array<{ id: string; keyword: string }>;

  for (const product of products) {
    // Aggregate all campaign metrics
    const metrics = db.prepare(`
      SELECT
        SUM(visits) as total_visits,
        SUM(impressions) as total_impressions,
        SUM(clicks) as total_clicks,
        SUM(conversions) as total_conversions,
        SUM(revenue) as total_revenue,
        SUM(ad_spend) as total_ad_spend
      FROM campaign_metrics WHERE product_id = ?
    `).get(product.id) as Record<string, number> | undefined;

    if (!metrics) continue;

    // Update product totals
    const revenue = metrics.total_revenue || 0;
    const adSpend = metrics.total_ad_spend || 0;
    const roas = adSpend > 0 ? revenue / adSpend : null;

    withRetry(() => {
      db.prepare(`
        UPDATE products SET
          total_revenue = ?,
          total_ad_spend = ?,
          roas = ?,
          stage = CASE WHEN stage = 'live' THEN 'tracking' ELSE stage END
        WHERE id = ?
      `).run(revenue, adSpend, roas, product.id);
    });

    // Calculate landing page conversion rates
    const pageMetrics = db.prepare(`
      SELECT lp.id, lp.variant_id,
        SUM(cm.visits) as visits,
        SUM(cm.conversions) as conversions
      FROM landing_pages lp
      LEFT JOIN campaign_metrics cm ON cm.product_id = lp.product_id AND cm.source = 'landing_page'
      WHERE lp.product_id = ?
      GROUP BY lp.id
    `).all(product.id) as Array<{ id: string; variant_id: string; visits: number; conversions: number }>;

    for (const pm of pageMetrics) {
      if (pm.visits > 0) {
        const convRate = pm.conversions / pm.visits;
        withRetry(() => {
          db.prepare('UPDATE landing_pages SET visits = ?, conversion_rate = ? WHERE id = ?')
            .run(pm.visits, convRate, pm.id);
        });
      }
    }

    // Calculate ad creative CTR
    const creativeMetrics = db.prepare(`
      SELECT id, impressions, clicks FROM ad_creatives WHERE product_id = ? AND impressions > 0
    `).all(product.id) as Array<{ id: string; impressions: number; clicks: number }>;

    for (const cm of creativeMetrics) {
      const ctr = cm.clicks / cm.impressions;
      withRetry(() => {
        db.prepare('UPDATE ad_creatives SET ctr = ? WHERE id = ?').run(ctr, cm.id);
      });
    }
  }

  if (products.length > 0) {
    console.log(`[Tracker] Aggregated metrics for ${products.length} products`);
  }
}

// ============================================================
// Service loop
// ============================================================

async function main(): Promise<void> {
  console.log('[Tracker] Agent starting');
  const db = getDb();
  withRetry(() => {
    db.prepare(`INSERT INTO system_events (id, agent, event_type, severity, message) VALUES (?, 'tracker', 'startup', 'info', 'Tracker agent started')`)
      .run(uuid());
  });

  while (true) {
    try {
      await collectBufferAnalytics();
      aggregateProductMetrics();
    } catch (err) {
      console.error('[Tracker] Cycle crashed:', err);
    }
    // Run every 3 hours
    await new Promise(r => setTimeout(r, 10800000));
  }
}

main().catch(console.error);
