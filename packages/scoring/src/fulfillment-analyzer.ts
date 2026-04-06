import { logger } from '@ghostmarket/shared';

interface ProductData {
  title: string;
  price_usd: string;
  source: string;
  category: string;
  estimated_monthly_sales: number | null;
  review_count: number | null;
}

interface FulfillmentAnalysis {
  fulfillment_type: 'dropship' | 'pod' | 'wholesale' | 'digital' | 'skip';
  strategy: string;
  supplier_action: string;
  estimated_startup_cost: number;
  risk_level: 'low' | 'medium' | 'high';
  reasoning: string;
}

const POD_INDICATORS = ['shirt', 'tee', 'hoodie', 'mug', 'case', 'poster', 'canvas', 'print', 'custom', 'personalized', 'blanket', 'pillow', 'tote'];
const POD_CATEGORIES = ['clothing', 'apparel', 'accessories', 'home decor', 'decor', 'fashion'];
// Only match digital when it's clearly a digital product, NOT physical products with "digital display"
const DIGITAL_INDICATORS = ['download', 'template', 'printable', 'ebook', 'e-book', 'course', 'guide pdf', 'software license'];
const SKIP_INDICATORS = ['subscription', 'membership', 'service', 'supplement', 'vitamin', 'medicine', 'drug'];
const LIGHT_CATEGORIES = ['kitchen', 'office', 'pet', 'accessories', 'beauty', 'tools', 'phone', 'car', 'automotive', 'crafts', 'garden'];

export function analyzeFulfillment(product: ProductData, score: number): FulfillmentAnalysis {
  const title = product.title.toLowerCase();
  const price = parseFloat(product.price_usd);
  const category = product.category.toLowerCase();
  const sales = product.estimated_monthly_sales ?? 0;
  const reviews = product.review_count ?? 0;
  const sellingPrice = Math.round(price * 2.5 * 100) / 100;
  const marginPct = price > 0 ? Math.round(((sellingPrice - price - 5) / sellingPrice) * 100) : 0;

  // SKIP checks first
  if (price > 150) {
    return {
      fulfillment_type: 'skip',
      strategy: 'Skip — too expensive for dropship, too much capital for wholesale.',
      supplier_action: 'None',
      estimated_startup_cost: 0,
      risk_level: 'high',
      reasoning: `At $${price}, this product requires too much capital. Dropship margins are thin at this price point, and wholesale MOQ would need $${Math.round(price * 100)}+ investment.`,
    };
  }

  for (const indicator of SKIP_INDICATORS) {
    if (title.includes(indicator)) {
      return {
        fulfillment_type: 'skip',
        strategy: `Skip — "${indicator}" products have regulatory/recurring complexity.`,
        supplier_action: 'None',
        estimated_startup_cost: 0,
        risk_level: 'high',
        reasoning: `Products containing "${indicator}" often require licenses, FDA approval, or have recurring billing complexity that small sellers should avoid.`,
      };
    }
  }

  if (marginPct < 20 && price > 0) {
    return {
      fulfillment_type: 'skip',
      strategy: 'Skip — margin too thin after shipping costs.',
      supplier_action: 'None',
      estimated_startup_cost: 0,
      risk_level: 'high',
      reasoning: `At $${price} cost with ~$5 shipping, selling at $${sellingPrice} gives only ${marginPct}% margin. Need at least 30% to be profitable after ads and returns.`,
    };
  }

  // DIGITAL check
  for (const indicator of DIGITAL_INDICATORS) {
    if (title.includes(indicator) || category.includes(indicator)) {
      return {
        fulfillment_type: 'digital',
        strategy: 'Create once, sell forever. List on Gumroad/Etsy/Shopify. Zero fulfillment cost.',
        supplier_action: 'Create the digital product using AI tools. No supplier needed.',
        estimated_startup_cost: 0,
        risk_level: 'low',
        reasoning: `Digital product with infinite margin potential. No inventory, no shipping, no returns. Create using AI tools and list on multiple platforms simultaneously.`,
      };
    }
  }

  // POD check
  const isPod = POD_INDICATORS.some(p => title.includes(p)) || POD_CATEGORIES.some(c => category.includes(c) && !title.includes('electronic'));
  if (isPod && price < 40) {
    return {
      fulfillment_type: 'pod',
      strategy: 'Design 5-10 variations. List on Printful/Printify integrated with Shopify. They print and ship per order.',
      supplier_action: 'Connect Printful to Shopify. Create designs using Canva or AI image gen. Upload mockups.',
      estimated_startup_cost: 30,
      risk_level: 'low',
      reasoning: `POD opportunity — add custom designs for higher margins. At $${price} base cost, custom designs can sell at $${Math.round(price * 3)}-$${Math.round(price * 4)}. Zero inventory risk, Printful handles everything.`,
    };
  }

  // WHOLESALE check — high demand, cheap, generic
  if (price >= 2 && price <= 15 && sales > 5000 && reviews > 500) {
    const moq = 200;
    const wholesalePrice = price * 0.5;
    const investment = Math.round(wholesalePrice * moq);
    return {
      fulfillment_type: 'wholesale',
      strategy: `Order ${moq}-500 units from Alibaba at ~$${wholesalePrice.toFixed(2)}/unit. Ship to 3PL. Higher margin than dropship.`,
      supplier_action: `Contact 5 Alibaba suppliers. Request samples from top 3. Negotiate MOQ and price for ${moq}+ units.`,
      estimated_startup_cost: investment,
      risk_level: 'medium',
      reasoning: `Wholesale recommended — ${sales.toLocaleString()} monthly sales prove demand, ${reviews.toLocaleString()} reviews confirm product-market fit. At ~$${wholesalePrice.toFixed(2)} wholesale cost, selling at $${sellingPrice} gives ${Math.round(((sellingPrice - wholesalePrice - 5) / sellingPrice) * 100)}% margin. ~$${investment} initial investment for ${moq} units.`,
    };
  }

  // DROPSHIP — default for most products
  const isLight = LIGHT_CATEGORIES.some(c => category.includes(c));
  return {
    fulfillment_type: 'dropship',
    strategy: `List on Shopify/TikTok Shop at $${sellingPrice}. Supplier ships direct to customer.`,
    supplier_action: 'Find 3 AliExpress suppliers with >4.5 rating, >1000 orders, ePacket shipping. Order 1 sample first.',
    estimated_startup_cost: 50,
    risk_level: 'low',
    reasoning: `DROPSHIP recommended. This ${isLight ? 'lightweight' : ''} product ($${price} cost) sells at $${sellingPrice} for ~${marginPct}% margin. ${sales > 1000 ? `${sales.toLocaleString()} monthly sales prove demand.` : 'Test with low-risk dropship model.'} No inventory needed — supplier ships direct.`,
  };
}
