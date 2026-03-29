// GhostMarket Deployer Agent
// Deploys landing pages to Vercel, schedules content to Buffer, adds UTM tracking

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb, uuid, withRetry } from '../../shared/db.js';
import type { Product, LandingPage, ContentPost } from '../../shared/types.js';

const DATA_DIR = process.env.DATA_DIR || '/data';
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_SCOPE = process.env.VERCEL_ORG_ID || '';
const BUFFER_ACCESS_TOKEN = process.env.BUFFER_ACCESS_TOKEN || '';

const BUFFER_PROFILE_IDS: Record<string, string> = {
  instagram: process.env.BUFFER_PROFILE_ID_INSTAGRAM || '',
  tiktok: process.env.BUFFER_PROFILE_ID_TIKTOK || '',
  facebook: process.env.BUFFER_PROFILE_ID_FACEBOOK || '',
};

// ============================================================
// Vercel Deployment
// ============================================================

async function deployToVercel(productId: string, landingPage: LandingPage): Promise<string | null> {
  if (!VERCEL_TOKEN) {
    console.log('[Deployer] VERCEL_TOKEN not set, skipping deploy');
    return null;
  }

  if (!landingPage.html_path || !fs.existsSync(landingPage.html_path)) {
    console.error(`[Deployer] HTML file not found: ${landingPage.html_path}`);
    return null;
  }

  // Create deploy directory with the landing page as index.html
  const deployDir = path.join(DATA_DIR, 'deploy', productId, landingPage.variant_id);
  fs.mkdirSync(deployDir, { recursive: true });
  fs.copyFileSync(landingPage.html_path, path.join(deployDir, 'index.html'));

  // Inject Umami analytics snippet if configured
  const umamiSiteId = process.env.UMAMI_SITE_ID;
  const umamiUrl = process.env.UMAMI_URL;
  if (umamiSiteId && umamiUrl) {
    let html = fs.readFileSync(path.join(deployDir, 'index.html'), 'utf-8');
    const snippet = `<script async src="${umamiUrl}/script.js" data-website-id="${umamiSiteId}"></script>`;
    html = html.replace('</head>', `${snippet}\n</head>`);
    fs.writeFileSync(path.join(deployDir, 'index.html'), html);
  }

  try {
    const scopeFlag = VERCEL_SCOPE ? ` --scope ${VERCEL_SCOPE}` : '';
    const result = execSync(
      `vercel deploy --prod --yes --token=${VERCEL_TOKEN}${scopeFlag}`,
      { cwd: deployDir, encoding: 'utf-8', timeout: 120000 },
    ).trim();

    // Extract URL from output (last line is usually the URL)
    const lines = result.split('\n');
    const url = lines[lines.length - 1].trim();

    if (url.startsWith('http')) {
      // Update DB
      const db = getDb();
      withRetry(() => {
        db.prepare('UPDATE landing_pages SET url = ?, deployed = 1 WHERE id = ?')
          .run(url, landingPage.id);
      });
      console.log(`[Deployer] Deployed: ${url}`);
      return url;
    }

    console.error('[Deployer] Unexpected Vercel output:', result);
    return null;
  } catch (err) {
    console.error('[Deployer] Vercel deploy failed:', err);
    const db = getDb();
    withRetry(() => {
      db.prepare(`INSERT INTO system_events (id, agent, event_type, severity, message) VALUES (?, 'deployer', 'error', 'error', ?)`)
        .run(uuid(), `Vercel deploy failed for ${productId}: ${err}`);
    });
    return null;
  }
}

// ============================================================
// UTM Link Generation
// ============================================================

function generateUTMLink(baseUrl: string, params: { source: string; medium: string; campaign: string; content?: string }): string {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', params.source);
  url.searchParams.set('utm_medium', params.medium);
  url.searchParams.set('utm_campaign', params.campaign);
  if (params.content) url.searchParams.set('utm_content', params.content);
  return url.toString();
}

// ============================================================
// Buffer Scheduling
// ============================================================

async function scheduleToBuffer(
  post: ContentPost,
  landingPageUrl: string,
  productKeyword: string,
): Promise<string | null> {
  if (!BUFFER_ACCESS_TOKEN) {
    console.log('[Deployer] BUFFER_ACCESS_TOKEN not set, skipping Buffer');
    return null;
  }

  const profileId = BUFFER_PROFILE_IDS[post.platform];
  if (!profileId) {
    console.log(`[Deployer] No Buffer profile for platform: ${post.platform}`);
    return null;
  }

  // Add UTM link to caption
  const utmUrl = generateUTMLink(landingPageUrl, {
    source: post.platform,
    medium: 'social',
    campaign: productKeyword.replace(/\s+/g, '_').toLowerCase(),
    content: post.post_type || 'post',
  });

  const captionWithLink = `${post.copy_text || ''}\n\n${utmUrl}`;

  try {
    const resp = await fetch('https://api.bufferapp.com/1/updates/create.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: BUFFER_ACCESS_TOKEN,
        profile_ids: profileId,
        text: captionWithLink,
        scheduled_at: post.scheduled_at || new Date(Date.now() + 3600000).toISOString(),
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Buffer API error: ${resp.status} ${errText}`);
    }

    const data = await resp.json() as { updates?: Array<{ id: string }> };
    const bufferId = data.updates?.[0]?.id || null;

    if (bufferId) {
      const db = getDb();
      withRetry(() => {
        db.prepare('UPDATE content_posts SET buffer_post_id = ?, utm_url = ? WHERE id = ?')
          .run(bufferId, utmUrl, post.id);
      });
      console.log(`[Deployer] Scheduled to Buffer: ${bufferId}`);
    }

    return bufferId;
  } catch (err) {
    console.error(`[Deployer] Buffer scheduling failed:`, err);
    const db = getDb();
    withRetry(() => {
      db.prepare(`INSERT INTO system_events (id, agent, event_type, severity, message) VALUES (?, 'deployer', 'api_failure', 'error', ?)`)
        .run(uuid(), `Buffer failed: ${err}`);
    });
    return null;
  }
}

// ============================================================
// Full Deploy Pipeline
// ============================================================

export async function deployProduct(productId: string): Promise<void> {
  console.log(`[Deployer] Starting deploy for product ${productId}`);

  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Product | undefined;
  if (!product) {
    console.error(`[Deployer] Product ${productId} not found`);
    return;
  }

  // 1. Deploy best landing page variant to Vercel
  const landingPages = db.prepare(
    'SELECT * FROM landing_pages WHERE product_id = ? ORDER BY variant_id'
  ).all(productId) as LandingPage[];

  let deployedUrl: string | null = null;
  for (const page of landingPages) {
    const url = await deployToVercel(productId, page);
    if (url) {
      deployedUrl = url;
      break; // Deploy first variant, can A/B test later
    }
  }

  if (!deployedUrl) {
    console.log('[Deployer] No landing page deployed, skipping Buffer scheduling');
    return;
  }

  // Update product with landing page URL
  withRetry(() => {
    db.prepare('UPDATE products SET landing_page_url = ?, stage = ? WHERE id = ?')
      .run(deployedUrl, 'live', productId);
  });

  // 2. Schedule content posts to Buffer
  const posts = db.prepare(
    'SELECT * FROM content_posts WHERE product_id = ? ORDER BY scheduled_at'
  ).all(productId) as ContentPost[];

  let scheduledCount = 0;
  for (const post of posts) {
    const bufferId = await scheduleToBuffer(post, deployedUrl, product.keyword);
    if (bufferId) scheduledCount++;
    // Buffer rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[Deployer] Deploy complete: ${product.keyword} — URL: ${deployedUrl}, ${scheduledCount}/${posts.length} posts scheduled`);

  // 3. Log deployment event
  withRetry(() => {
    db.prepare(`INSERT INTO system_events (id, agent, event_type, severity, message, metadata) VALUES (?, 'deployer', 'health_check', 'info', ?, ?)`)
      .run(
        uuid(),
        `Product deployed: ${product.keyword}`,
        JSON.stringify({ product_id: productId, url: deployedUrl, posts_scheduled: scheduledCount }),
      );
  });
}

// ============================================================
// Service loop
// ============================================================

async function processReadyProducts(): Promise<void> {
  const db = getDb();
  // Products that are done building and need deployment
  const products = db.prepare(`
    SELECT p.id, p.keyword FROM products p
    WHERE p.stage = 'building'
      AND EXISTS (SELECT 1 FROM landing_pages lp WHERE lp.product_id = p.id)
      AND EXISTS (SELECT 1 FROM brand_kits bk WHERE bk.product_id = p.id)
    ORDER BY p.score DESC
    LIMIT 3
  `).all() as Array<{ id: string; keyword: string }>;

  for (const p of products) {
    try {
      await deployProduct(p.id);
    } catch (err) {
      console.error(`[Deployer] Deploy failed for ${p.keyword}:`, err);
    }
  }
}

async function main(): Promise<void> {
  console.log('[Deployer] Agent starting');
  const db = getDb();
  withRetry(() => {
    db.prepare(`INSERT INTO system_events (id, agent, event_type, severity, message) VALUES (?, 'deployer', 'startup', 'info', 'Deployer agent started')`)
      .run(uuid());
  });

  while (true) {
    try {
      await processReadyProducts();
    } catch (err) {
      console.error('[Deployer] Cycle crashed:', err);
    }
    await new Promise(r => setTimeout(r, 60000));
  }
}

main().catch(console.error);
