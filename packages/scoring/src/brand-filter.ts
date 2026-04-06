import { logger } from '@ghostmarket/shared';

// Brands that small sellers cannot compete against
const BLOCKED_BRANDS = [
  // Tech giants
  'apple', 'samsung', 'sony', 'lg', 'google', 'microsoft', 'amazon basics',
  'anker', 'dell', 'hp', 'lenovo', 'asus', 'acer', 'intel', 'amd', 'nvidia',
  // Tech product names
  'ipad', 'iphone', 'macbook', 'galaxy', 'pixel', 'kindle', 'echo', 'alexa',
  'airpods', 'beats', 'gopro', 'fitbit', 'garmin', 'roku', 'nest',
  // Audio / peripherals
  'bose', 'jbl', 'canon', 'nikon', 'playstation', 'xbox', 'nintendo',
  // Fashion / luxury
  'nike', 'adidas', 'gucci', 'prada', 'louis vuitton', 'chanel', 'hermes',
  'burberry', 'versace', 'dior', 'balenciaga', 'fendi', 'rolex', 'cartier',
  // Auto / luxury
  'tesla', 'bmw', 'mercedes', 'dyson',
  // Kitchen / household big brands
  'stanley', 'ninja', 'instant pot', 'kitchenaid', 'cuisinart',
  'hamilton beach', 'keurig', 'black+decker', 'black & decker',
  'rubbermaid', 'oxo', 'clorox', 'glad', 'ziploc',
  // Pet / grocery big brands
  'purina', 'arm & hammer', 'arm &amp; hammer',
  // Personal care / CPG big brands
  'energizer', 'duracell', 'oral-b', 'gillette', 'tide', 'bounty',
  'charmin', 'pampers', 'mueller', 'fullstar',
  // Other established brands
  'ring', 'cosori', 'breville', 'vitamix', 'shark', 'irobot', 'roomba',
  'weber', 'traeger', 'yeti', 'hydro flask', 'contigo', 'thermos',
];

// Brand-adjacent accessories (dependent on brand ecosystem)
const BRAND_ACCESSORY_PATTERNS = [
  'case for iphone', 'case for samsung', 'case for galaxy', 'case for ipad',
  'charger for', 'compatible with apple', 'compatible with samsung',
  'for airpods', 'for macbook', 'for iphone', 'for galaxy', 'for ipad',
  'replacement for', 'fits',
];

// Refurbished/used indicators
const USED_PATTERNS = ['refurbished', 'renewed', 'used', 'pre-owned', 'open box', 'like new -'];

// Problem-solving product indicators (boost)
const PROBLEM_SOLVING_KEYWORDS = [
  'organizer', 'holder', 'storage', 'mount', 'stand', 'rack', 'tool', 'kit',
  'portable', 'mini', 'foldable', 'adjustable', 'reusable', 'waterproof',
  'magnetic', 'collapsible', 'multipurpose', 'ergonomic', 'non-slip',
  'self-adhesive', 'no-drill', 'wireless', 'rechargeable',
];

// POD-able categories
const POD_CATEGORIES = [
  'clothing', 'apparel', 'accessories', 'home decor', 'decor',
  'mugs', 'tshirt', 't-shirt', 'hoodie', 'poster', 'canvas',
  'phone case', 'pillow', 'blanket', 'tote bag',
];

interface FilterResult {
  allowed: boolean;
  reason: string;
  opportunityBonus: number;
}

interface ProductInput {
  title: string;
  price_usd: string;
  category: string;
  review_count: number | null;
  tags?: unknown;
}

export function filterProduct(product: ProductInput): FilterResult {
  const title = product.title.toLowerCase();
  const price = parseFloat(product.price_usd);
  const category = product.category.toLowerCase();
  let opportunityBonus = 0;

  // --- REJECTION FILTERS ---

  // 1. Blocked brands — use word-boundary matching for short names to avoid false positives
  //    e.g. "ring" should block "Ring Doorbell" but NOT "ring light" or "key ring"
  for (const brand of BLOCKED_BRANDS) {
    if (brand.length <= 4) {
      // Short brand names: require word boundary (start of title or preceded by space)
      const re = new RegExp(`(^|\\s)${brand.replace(/[+&]/g, '\\$&')}(\\s|$|\\b)`, 'i');
      if (re.test(product.title)) {
        return { allowed: false, reason: `Blocked brand: ${brand}`, opportunityBonus: 0 };
      }
    } else {
      if (title.includes(brand)) {
        return { allowed: false, reason: `Blocked brand: ${brand}`, opportunityBonus: 0 };
      }
    }
  }

  // 2. Price too high (>$200) or too low (<$2)
  if (price > 200) {
    return { allowed: false, reason: `Price too high: $${price} (max $200)`, opportunityBonus: 0 };
  }
  if (price < 2 && price > 0) {
    return { allowed: false, reason: `Price too low: $${price} (min $2)`, opportunityBonus: 0 };
  }

  // 3. Brand accessories
  for (const pattern of BRAND_ACCESSORY_PATTERNS) {
    if (title.includes(pattern)) {
      return { allowed: false, reason: `Brand accessory: "${pattern}"`, opportunityBonus: 0 };
    }
  }

  // 4. Refurbished/used
  for (const pattern of USED_PATTERNS) {
    if (title.includes(pattern)) {
      return { allowed: false, reason: `Used/refurbished: "${pattern}"`, opportunityBonus: 0 };
    }
  }

  // --- OPPORTUNITY SIGNALS (BOOSTS) ---

  // Generic/unbranded product
  const hasBrandSignal = BLOCKED_BRANDS.some(b => title.includes(b));
  if (!hasBrandSignal) {
    opportunityBonus += 15;
  }

  // Problem-solving product
  const problemSolvingMatches = PROBLEM_SOLVING_KEYWORDS.filter(k => title.includes(k));
  if (problemSolvingMatches.length > 0) {
    opportunityBonus += 10;
  }

  // High review count but generic brand (proven demand, no brand moat)
  const reviewCount = product.review_count ?? 0;
  if (reviewCount > 1000 && !hasBrandSignal) {
    opportunityBonus += 10;
  }

  // POD-able
  const isPodable = POD_CATEGORIES.some(c => category.includes(c) || title.includes(c));
  if (isPodable) {
    opportunityBonus += 10;
  }

  // Price sweet spot ($10-$50 = best margins for dropship)
  if (price >= 10 && price <= 50) {
    opportunityBonus += 10;
  }

  return {
    allowed: true,
    reason: `Passed filters. Bonus: +${opportunityBonus} (${[
      !hasBrandSignal ? 'generic' : null,
      problemSolvingMatches.length > 0 ? `problem-solver: ${problemSolvingMatches[0]}` : null,
      reviewCount > 1000 ? 'proven demand' : null,
      isPodable ? 'POD-able' : null,
      price >= 10 && price <= 50 ? 'price sweet spot' : null,
    ].filter(Boolean).join(', ')})`,
    opportunityBonus,
  };
}
