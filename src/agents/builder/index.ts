// GhostMarket Builder Agent
// Generates brand kits, landing pages, ad creatives, and content calendars
// Uses Groq LLM (with Ollama fallback after fine-tune) for all creative generation

import { getDb, uuid, withRetry } from '../../shared/db.js';
import { llmJSON } from '../../shared/llm.js';
import type {
  Product, Supplier, TrendSignal, BrandKit, CopyApproach,
  HookType, AdPlatform, AdFormat, PostType,
} from '../../shared/types.js';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/data';
const LANDING_PAGES_DIR = path.join(DATA_DIR, 'landing_pages');
const CREATIVES_DIR = path.join(DATA_DIR, 'creatives');

// Ensure directories exist
for (const dir of [LANDING_PAGES_DIR, CREATIVES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ============================================================
// Brand Kit Generation
// ============================================================

interface BrandGenResult {
  names: string[];
  selected_name: string;
  colors: string[];
  typography: { heading: string; body: string };
  logo_prompt: string;
  instagram_bio: string;
  page_description: string;
}

async function generateBrandKit(product: Product, supplier: Supplier | null, signals: TrendSignal[]): Promise<string> {
  const signalSummary = signals.map(s => `${s.source}: ${s.raw_signal_strength}`).join(', ');
  const priceRange = supplier ? `$${supplier.estimated_retail}` : '$20-30';

  const { parsed } = await llmJSON<BrandGenResult>({
    task_type: 'brand_naming',
    product_id: product.id,
    system_prompt: `You are an expert e-commerce brand strategist. Generate brand kits for dropshipping/POD products.
Be creative but commercial. Names should be 1-2 words, memorable, modern. Avoid generic names like "Pro" or "Plus".
Respond in JSON only.`,
    prompt: `Create a brand kit for this product:

Product: ${product.keyword}
Category: ${product.category || 'general'}
Price point: ${priceRange}
Trend signals: ${signalSummary}
Fulfillment: ${product.fulfillment_method || 'dropship'}

Generate:
1. "names": array of 3 brand name options (short, memorable, modern)
2. "selected_name": your recommended pick from the 3
3. "colors": array of 2-3 hex colors (primary, accent, optional dark)
4. "typography": {"heading": "font name", "body": "font name"} — Google Fonts only
5. "logo_prompt": a DALL-E/Flux prompt for a minimalist logo
6. "instagram_bio": Instagram bio text (150 chars max, include emoji)
7. "page_description": one-line brand positioning statement`,
  });

  const db = getDb();
  const brandId = uuid();
  withRetry(() => {
    db.prepare(`
      INSERT INTO brand_kits (id, product_id, brand_name, brand_names_options, color_palette, typography, logo_prompt, instagram_bio, page_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      brandId,
      product.id,
      parsed.selected_name,
      JSON.stringify(parsed.names),
      JSON.stringify(parsed.colors),
      JSON.stringify(parsed.typography),
      parsed.logo_prompt,
      parsed.instagram_bio,
      parsed.page_description,
    );
  });

  console.log(`[Builder] Brand kit generated: ${parsed.selected_name} for ${product.keyword}`);
  return brandId;
}

// ============================================================
// Landing Page Generation
// ============================================================

interface LandingPageCopy {
  headline: string;
  subheadline: string;
  benefits: string[];
  cta_text: string;
  social_proof: string;
  urgency_text: string;
}

const COPY_APPROACHES: CopyApproach[] = ['benefit', 'story', 'urgency'];

async function generateLandingPage(
  product: Product,
  brand: BrandKit,
  supplier: Supplier | null,
  variant: CopyApproach,
): Promise<string> {
  const price = supplier?.estimated_retail || 24.99;

  const { parsed } = await llmJSON<LandingPageCopy>({
    task_type: 'landing_page_copy',
    product_id: product.id,
    system_prompt: `You are a conversion copywriter. Write landing page copy that sells.
Approach: ${variant}. Be specific, not generic. No filler words.`,
    prompt: `Write landing page copy for:

Product: ${product.keyword}
Brand: ${brand.brand_name}
Price: $${price}
Approach: ${variant}

Output JSON:
1. "headline": main headline (max 10 words, powerful)
2. "subheadline": supporting text (max 20 words)
3. "benefits": array of 3-5 benefit bullets (specific, not generic)
4. "cta_text": call-to-action button text
5. "social_proof": fake-but-believable social proof line
6. "urgency_text": urgency element text`,
  });

  // Generate HTML
  const colors = brand.color_palette ? JSON.parse(brand.color_palette as unknown as string) : ['#1a1a2e', '#e94560'];
  const primaryColor = colors[0] || '#1a1a2e';
  const accentColor = colors[1] || '#e94560';

  const html = generateHTML(parsed, brand.brand_name, price, primaryColor, accentColor, product.keyword);
  const wordCount = html.split(/\s+/).length;

  // Save HTML file
  const fileName = `${product.id}_${variant}.html`;
  const filePath = path.join(LANDING_PAGES_DIR, fileName);
  fs.writeFileSync(filePath, html);

  // Store in DB
  const pageId = uuid();
  const db = getDb();
  withRetry(() => {
    db.prepare(`
      INSERT INTO landing_pages (id, product_id, variant_id, copy_approach, headline, subheadline, benefits, html_path, word_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pageId, product.id, variant, variant,
      parsed.headline, parsed.subheadline,
      JSON.stringify(parsed.benefits), filePath, wordCount,
    );
  });

  console.log(`[Builder] Landing page ${variant} generated for ${product.keyword}`);
  return pageId;
}

function generateHTML(
  copy: LandingPageCopy,
  brandName: string,
  price: number,
  primaryColor: string,
  accentColor: string,
  _productKeyword: string,
): string {
  const benefitsHTML = copy.benefits
    .map(b => `<li>${b}</li>`)
    .join('\n            ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brandName} — ${copy.headline}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; color: #222; line-height: 1.6; }
    .hero { background: ${primaryColor}; color: white; padding: 60px 20px; text-align: center; }
    .hero h1 { font-size: 2.5rem; margin-bottom: 16px; max-width: 600px; margin-left: auto; margin-right: auto; }
    .hero p { font-size: 1.2rem; opacity: 0.9; max-width: 500px; margin: 0 auto 32px; }
    .hero .price { font-size: 2rem; font-weight: bold; margin-bottom: 24px; }
    .hero .price .original { text-decoration: line-through; opacity: 0.6; font-size: 1.2rem; margin-right: 8px; }
    .cta { display: inline-block; background: ${accentColor}; color: white; padding: 16px 48px; border-radius: 8px; font-size: 1.2rem; font-weight: bold; text-decoration: none; transition: transform 0.2s; }
    .cta:hover { transform: scale(1.05); }
    .benefits { padding: 60px 20px; max-width: 600px; margin: 0 auto; }
    .benefits h2 { font-size: 1.8rem; margin-bottom: 24px; text-align: center; }
    .benefits ul { list-style: none; }
    .benefits li { padding: 12px 0; padding-left: 32px; position: relative; font-size: 1.1rem; }
    .benefits li::before { content: "✓"; position: absolute; left: 0; color: ${accentColor}; font-weight: bold; }
    .social-proof { background: #f8f9fa; padding: 40px 20px; text-align: center; }
    .social-proof p { font-size: 1.1rem; color: #555; max-width: 500px; margin: 0 auto; }
    .urgency { background: ${accentColor}; color: white; padding: 20px; text-align: center; font-weight: bold; }
    .final-cta { padding: 60px 20px; text-align: center; }
    .final-cta .cta { background: ${primaryColor}; }
    .brand { padding: 20px; text-align: center; font-size: 0.9rem; color: #999; }
  </style>
</head>
<body>
  <section class="hero">
    <h1>${copy.headline}</h1>
    <p>${copy.subheadline}</p>
    <div class="price">
      <span class="original">$${(price * 1.5).toFixed(2)}</span>
      $${price.toFixed(2)}
    </div>
    <a href="#order" class="cta">${copy.cta_text}</a>
  </section>
  <section class="benefits">
    <h2>Why ${brandName}?</h2>
    <ul>
            ${benefitsHTML}
    </ul>
  </section>
  <section class="social-proof">
    <p>"${copy.social_proof}"</p>
  </section>
  <section class="urgency">
    ${copy.urgency_text}
  </section>
  <section class="final-cta" id="order">
    <h2>Get Yours Now</h2>
    <br>
    <a href="#" class="cta">${copy.cta_text}</a>
  </section>
  <footer class="brand">© ${new Date().getFullYear()} ${brandName}. All rights reserved.</footer>
</body>
</html>`;
}

// ============================================================
// Ad Creative Copy Generation
// ============================================================

interface AdCreativeCopy {
  hook: string;
  body: string;
  cta: string;
}

const HOOK_TYPES: HookType[] = ['problem_solution', 'transformation', 'curiosity', 'social_proof', 'urgency'];
const AD_FORMATS: Array<{ platform: AdPlatform; format: AdFormat }> = [
  { platform: 'instagram', format: 'square' },
  { platform: 'tiktok', format: 'vertical_9_16' },
  { platform: 'facebook', format: 'horizontal' },
];

async function generateAdCreatives(product: Product, brand: BrandKit, supplier: Supplier | null): Promise<string[]> {
  const creativeIds: string[] = [];
  const price = supplier?.estimated_retail || 24.99;

  // Generate 2 hook types × 3 formats = 6 creatives
  const selectedHooks = HOOK_TYPES.slice(0, 2);

  for (const hookType of selectedHooks) {
    const { parsed } = await llmJSON<AdCreativeCopy>({
      task_type: 'ad_hook',
      product_id: product.id,
      system_prompt: `You are a performance marketing copywriter specializing in ${hookType.replace('_', ' ')} hooks.
Write short, punchy ad copy for social media. Under 100 words total.`,
      prompt: `Write ad copy for:
Product: ${product.keyword}
Brand: ${brand.brand_name}
Price: $${price}
Hook type: ${hookType}
Target: 18-45, impulse buyers, social media scroll-stoppers

Output JSON:
1. "hook": opening line that stops the scroll (max 15 words)
2. "body": supporting copy (2-3 short sentences)
3. "cta": call to action`,
    });

    for (const { platform, format } of AD_FORMATS) {
      const creativeId = uuid();
      const db = getDb();
      withRetry(() => {
        db.prepare(`
          INSERT INTO ad_creatives (id, product_id, platform, format, hook_type, copy_text)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          creativeId, product.id, platform, format, hookType,
          `${parsed.hook}\n\n${parsed.body}\n\n${parsed.cta}`,
        );
      });
      creativeIds.push(creativeId);
    }
  }

  console.log(`[Builder] ${creativeIds.length} ad creatives generated for ${product.keyword}`);
  return creativeIds;
}

// ============================================================
// Content Calendar Generation
// ============================================================

interface ContentCalendarPost {
  day: number;
  post_type: PostType;
  caption: string;
  image_prompt: string;
}

async function generateContentCalendar(product: Product, brand: BrandKit, supplier: Supplier | null): Promise<string[]> {
  const price = supplier?.estimated_retail || 24.99;

  const { parsed } = await llmJSON<{ posts: ContentCalendarPost[] }>({
    task_type: 'social_caption',
    product_id: product.id,
    system_prompt: `You are a social media strategist for e-commerce brands. Create a 10-day content calendar.
Mix post types for variety. Each caption should feel authentic, not corporate.`,
    prompt: `Create a 10-day content calendar for:
Product: ${product.keyword}
Brand: ${brand.brand_name}
Price: $${price}

Post types to mix: product_showcase, lifestyle, ugc_style, benefit_focused, urgency_scarcity

Output JSON: {"posts": [{"day": 1, "post_type": "...", "caption": "...", "image_prompt": "..."}]}
Each post needs caption (Instagram-ready with hashtags) and image_prompt (for AI image gen).`,
  });

  const postIds: string[] = [];
  const db = getDb();

  for (const post of parsed.posts) {
    const postId = uuid();
    const scheduledAt = new Date(Date.now() + post.day * 86400000).toISOString();

    withRetry(() => {
      db.prepare(`
        INSERT INTO content_posts (id, product_id, platform, post_type, copy_text, scheduled_at)
        VALUES (?, ?, 'instagram', ?, ?, ?)
      `).run(postId, product.id, post.post_type, post.caption, scheduledAt);
    });
    postIds.push(postId);
  }

  console.log(`[Builder] ${postIds.length}-day content calendar generated for ${product.keyword}`);
  return postIds;
}

// ============================================================
// Full Build Pipeline
// ============================================================

export async function buildProduct(productId: string): Promise<void> {
  console.log(`[Builder] Starting full build for product ${productId}`);

  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Product | undefined;
  if (!product) {
    console.error(`[Builder] Product ${productId} not found`);
    return;
  }

  // Parse JSON fields that come as strings from SQLite
  const parsedProduct: Product = {
    ...product,
    score_breakdown: typeof product.score_breakdown === 'string' ? JSON.parse(product.score_breakdown) : product.score_breakdown,
    buffer_post_ids: typeof product.buffer_post_ids === 'string' ? JSON.parse(product.buffer_post_ids) : product.buffer_post_ids,
  };

  const supplier = db.prepare(
    'SELECT * FROM suppliers WHERE product_id = ? AND is_best = 1 LIMIT 1'
  ).get(productId) as Supplier | undefined ?? null;

  const signals = db.prepare(
    'SELECT * FROM trend_signals WHERE product_id = ?'
  ).all(productId) as TrendSignal[];

  // Update stage
  withRetry(() => {
    db.prepare('UPDATE products SET stage = ? WHERE id = ?').run('building', productId);
  });

  try {
    // 1. Brand kit
    const brandKitId = await generateBrandKit(parsedProduct, supplier, signals);
    const brandKit = db.prepare('SELECT * FROM brand_kits WHERE id = ?').get(brandKitId) as BrandKit;

    // 2. Landing pages (3 variants)
    const pageIds: string[] = [];
    for (const approach of COPY_APPROACHES) {
      const pageId = await generateLandingPage(parsedProduct, brandKit, supplier, approach);
      pageIds.push(pageId);
    }

    // 3. Ad creatives
    const creativeIds = await generateAdCreatives(parsedProduct, brandKit, supplier);

    // 4. Content calendar
    const postIds = await generateContentCalendar(parsedProduct, brandKit, supplier);

    // Update product
    withRetry(() => {
      db.prepare('UPDATE products SET brand_kit_id = ?, stage = ? WHERE id = ?')
        .run(brandKitId, 'building', productId);
    });

    console.log(`[Builder] Build complete for ${product.keyword}: brand=${brandKit.brand_name}, pages=${pageIds.length}, creatives=${creativeIds.length}, posts=${postIds.length}`);
  } catch (err) {
    console.error(`[Builder] Build failed for ${product.keyword}:`, err);
    const db2 = getDb();
    withRetry(() => {
      db2.prepare(`INSERT INTO system_events (id, agent, event_type, severity, message) VALUES (?, 'builder', 'error', 'error', ?)`)
        .run(uuid(), `Build failed for ${productId}: ${err}`);
    });
  }
}

// ============================================================
// Service loop
// ============================================================

async function processApprovedProducts(): Promise<void> {
  const db = getDb();
  const products = db.prepare(`
    SELECT id, keyword FROM products
    WHERE stage = 'approved'
    ORDER BY score DESC
    LIMIT 5
  `).all() as Array<{ id: string; keyword: string }>;

  if (!products.length) return;

  console.log(`[Builder] Found ${products.length} approved products to build`);
  for (const p of products) {
    await buildProduct(p.id);
  }
}

async function main(): Promise<void> {
  console.log('[Builder] Agent starting');
  const db = getDb();
  withRetry(() => {
    db.prepare(`INSERT INTO system_events (id, agent, event_type, severity, message) VALUES (?, 'builder', 'startup', 'info', 'Builder agent started')`)
      .run(uuid());
  });

  while (true) {
    try {
      await processApprovedProducts();
    } catch (err) {
      console.error('[Builder] Cycle crashed:', err);
    }
    await new Promise(r => setTimeout(r, 60000)); // Check every minute
  }
}

main().catch(console.error);
