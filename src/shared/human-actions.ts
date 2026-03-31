// GhostMarket — Human Action Required System
// When the pipeline hits a step needing manual action, it pauses and notifies the operator.

import { getDb, uuid, nowISO, withRetry } from './db.js';

// ============================================================
// Action Type Definitions
// ============================================================

export interface HumanActionDef {
  emoji: string;
  title: string;
  description: string;
  instructions: string[];
}

export const HUMAN_ACTIONS: Record<string, HumanActionDef> = {
  create_instagram: {
    emoji: '📸',
    title: 'CREATE INSTAGRAM PAGE',
    description: 'Create an Instagram business page for brand "{brand_name}"',
    instructions: [
      '1. Go to instagram.com and create a new account',
      '2. Username: {suggested_username}',
      '3. Bio: {suggested_bio}',
      '4. Profile pic: Use the brand kit colors',
      '5. Switch to Business account',
      '6. Reply DONE when complete',
    ],
  },
  create_tiktok: {
    emoji: '🎵',
    title: 'CREATE TIKTOK ACCOUNT',
    description: 'Create a TikTok business account for brand "{brand_name}"',
    instructions: [
      '1. Go to tiktok.com and create a new account',
      '2. Username: {suggested_username}',
      '3. Bio: {suggested_bio}',
      '4. Switch to Business account',
      '5. Reply DONE when complete',
    ],
  },
  setup_shopify: {
    emoji: '🛒',
    title: 'SET UP SHOPIFY STORE',
    description: 'Create a Shopify store for "{product_name}"',
    instructions: [
      '1. Go to shopify.com and create a new store',
      '2. Store name: {brand_name}',
      '3. Add the product: {product_name}',
      '4. Set price: ${retail_price}',
      '5. Upload the landing page as homepage',
      '6. Connect payment processor',
      '7. Reply DONE with the store URL',
    ],
  },
  setup_payment: {
    emoji: '💳',
    title: 'CONNECT PAYMENT PROCESSOR',
    description: 'Set up Stripe/PayPal for "{brand_name}"',
    instructions: [
      '1. Go to stripe.com or paypal.com',
      '2. Create/connect a business account',
      '3. Add the product at ${retail_price}',
      '4. Get the checkout link',
      '5. Reply DONE with the payment link',
    ],
  },
  upload_ad_creative: {
    emoji: '🎨',
    title: 'UPLOAD AD CREATIVE',
    description: 'Upload the ad creative to {platform} Ads Manager',
    instructions: [
      '1. Go to {platform} Ads Manager',
      '2. Create a new campaign: Conversions',
      '3. Upload the creative from data/images/',
      '4. Set daily budget: ${daily_budget}',
      '5. Target audience: {target_audience}',
      '6. Reply DONE when the ad is live',
    ],
  },
  connect_domain: {
    emoji: '🌐',
    title: 'CONNECT CUSTOM DOMAIN',
    description: 'Point a domain to the landing page for "{brand_name}"',
    instructions: [
      '1. Buy a domain (e.g., {suggested_domain})',
      '2. Add CNAME record pointing to Vercel',
      '3. Reply DONE with the domain name',
    ],
  },
  manual_review: {
    emoji: '👁️',
    title: 'MANUAL REVIEW REQUIRED',
    description: '{custom_message}',
    instructions: [
      'Review and reply DONE or SKIP',
    ],
  },
};

// ============================================================
// Request a human action (pauses pipeline for that product)
// ============================================================

export interface RequestResult {
  actionId: string;
  telegramText: string;
}

export function requestHumanAction(
  productId: string | null,
  actionType: string,
  variables: Record<string, string> = {},
): RequestResult {
  const def = HUMAN_ACTIONS[actionType];
  if (!def) throw new Error(`Unknown action type: ${actionType}`);

  // Fill in variable placeholders
  let description = def.description;
  let instructions = [...def.instructions];
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    description = description.replaceAll(placeholder, value);
    instructions = instructions.map(i => i.replaceAll(placeholder, value));
  }

  const id = uuid();
  const db = getDb();

  withRetry(() => {
    db.prepare(
      `INSERT INTO human_actions (id, product_id, action_type, action_description, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(id, productId, actionType, description, nowISO());
  });

  // Pause product pipeline
  if (productId) {
    withRetry(() => {
      db.prepare("UPDATE products SET stage = 'waiting_human' WHERE id = ?").run(productId);
    });
  }

  // Log system event
  withRetry(() => {
    db.prepare(
      `INSERT INTO system_events (id, agent, event_type, severity, message, created_at)
       VALUES (?, 'orchestrator', 'health_check', 'warning', ?, ?)`
    ).run(uuid(), `Human action requested: ${actionType} for product ${productId?.substring(0, 8) || 'system'}`, nowISO());
  });

  // Build Telegram message
  const telegramText =
`⚠️⚠️⚠️ HUMAN ACTION REQUIRED ⚠️⚠️⚠️
━━━━━━━━━━━━━━━━━━━━━━

${def.emoji} ${def.title}

${description}

${instructions.join('\n')}

━━━━━━━━━━━━━━━━━━━━━━
⏸️ Pipeline PAUSED for this product.
Reply DONE or SKIP to continue.
Action ID: ${id.substring(0, 8)}
━━━━━━━━━━━━━━━━━━━━━━`;

  return { actionId: id, telegramText };
}

// ============================================================
// Complete or skip a human action (resumes pipeline)
// ============================================================

export interface ActionRecord {
  id: string;
  product_id: string | null;
  action_type: string;
  action_description: string;
  status: string;
  created_at: string;
}

export function completeHumanAction(actionId: string, operatorData?: string): ActionRecord | null {
  const db = getDb();
  const action = db.prepare("SELECT * FROM human_actions WHERE id = ? OR id LIKE ?").get(actionId, `${actionId}%`) as ActionRecord | undefined;
  if (!action) return null;

  withRetry(() => {
    db.prepare("UPDATE human_actions SET status = 'completed', completed_at = ?, operator_data = ? WHERE id = ?")
      .run(nowISO(), operatorData || null, action.id);
  });

  // Resume product
  if (action.product_id) {
    withRetry(() => {
      db.prepare("UPDATE products SET stage = 'building' WHERE id = ? AND stage = 'waiting_human'")
        .run(action.product_id);
    });
  }

  return action;
}

export function skipHumanAction(actionId: string): ActionRecord | null {
  const db = getDb();
  const action = db.prepare("SELECT * FROM human_actions WHERE id = ? OR id LIKE ?").get(actionId, `${actionId}%`) as ActionRecord | undefined;
  if (!action) return null;

  withRetry(() => {
    db.prepare("UPDATE human_actions SET status = 'skipped', completed_at = ? WHERE id = ?")
      .run(nowISO(), action.id);
  });

  // Resume product (keep in building stage, skip the action)
  if (action.product_id) {
    withRetry(() => {
      db.prepare("UPDATE products SET stage = 'building' WHERE id = ? AND stage = 'waiting_human'")
        .run(action.product_id);
    });
  }

  return action;
}

// ============================================================
// Query pending actions
// ============================================================

export function getPendingActions(): ActionRecord[] {
  const db = getDb();
  return db.prepare("SELECT * FROM human_actions WHERE status = 'pending' ORDER BY created_at DESC").all() as ActionRecord[];
}

export function getLatestPendingAction(): ActionRecord | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM human_actions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1").get() as ActionRecord) || null;
}

export function saveTelegramMessageId(actionId: string, messageId: number): void {
  const db = getDb();
  withRetry(() => {
    db.prepare("UPDATE human_actions SET telegram_message_id = ? WHERE id = ?").run(messageId, actionId);
  });
}
