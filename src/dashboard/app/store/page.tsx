import { canUseLocalDb, fetchOrchestrator } from '@/lib/data';
import Link from 'next/link';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface StoreProduct {
  id: string;
  keyword: string;
  category: string;
  fulfillment_method: string;
  stage: string;
  score: number;
  brand_name: string | null;
  retail_price: number | null;
  has_landing: number;
  has_image: boolean;
  image_b64: string | null;
}

interface StoreCategory {
  value: string;
  label: string;
  count: number;
}

async function getStoreDataLocal(): Promise<{ products: StoreProduct[]; categories: StoreCategory[] }> {
  const { getDb } = await import('@/lib/db');
  const db = getDb();

  const rows = db.prepare(`
    SELECT p.id, p.keyword, p.category, p.fulfillment_method, p.stage, p.score,
           bk.brand_name,
           s.estimated_retail as retail_price,
           (SELECT COUNT(*) FROM landing_pages lp WHERE lp.product_id = p.id AND lp.html_content IS NOT NULL) as has_landing
    FROM products p
    LEFT JOIN brand_kits bk ON bk.product_id = p.id
    LEFT JOIN suppliers s ON s.product_id = p.id AND s.is_best = 1
    WHERE p.stage IN ('approved', 'live', 'tracking', 'building')
    ORDER BY p.score DESC
  `).all() as Array<{
    id: string; keyword: string; category: string; fulfillment_method: string;
    stage: string; score: number; brand_name: string | null; retail_price: number | null; has_landing: number;
  }>;

  const imagesDir = path.resolve(process.cwd(), '..', '..', 'data', 'images');
  const products: StoreProduct[] = rows.map(r => {
    const imgPath = path.join(imagesDir, `${r.id}_hero.png`);
    const hasImage = fs.existsSync(imgPath);
    let imageB64: string | null = null;
    if (hasImage) {
      try { imageB64 = fs.readFileSync(imgPath).toString('base64'); } catch { /* ignore */ }
    }
    return { ...r, has_image: hasImage, image_b64: imageB64 };
  });

  const fm = db.prepare(`
    SELECT fulfillment_method, COUNT(*) as c FROM products
    WHERE stage IN ('approved','live','tracking','building')
    GROUP BY fulfillment_method ORDER BY c DESC
  `).all() as Array<{ fulfillment_method: string; c: number }>;

  const categories: StoreCategory[] = [
    { value: 'all', label: 'All Products', count: fm.reduce((s, r) => s + r.c, 0) },
    ...fm.map(r => ({
      value: r.fulfillment_method || 'other',
      label: r.fulfillment_method === 'pod' ? 'Print on Demand' : r.fulfillment_method === 'dropship' ? 'Dropship' : r.fulfillment_method === 'digital' ? 'Digital' : 'Other',
      count: r.c,
    })),
  ];

  return { products, categories };
}

async function getStoreDataRemote(): Promise<{ products: StoreProduct[]; categories: StoreCategory[] }> {
  const data = await fetchOrchestrator<{
    products: Array<{
      id: string; keyword: string; category: string; fulfillment_method: string;
      stage: string; score: number; brand_name: string | null; retail_price: number | null; has_landing: number;
    }>;
    categories: Array<{ fulfillment_method: string; c: number }>;
  }>('/api/store');

  const products: StoreProduct[] = (data.products || []).map(r => ({
    ...r, has_image: false, image_b64: null,
  }));

  const fm = data.categories || [];
  const categories: StoreCategory[] = [
    { value: 'all', label: 'All Products', count: fm.reduce((s, r) => s + r.c, 0) },
    ...fm.map(r => ({
      value: r.fulfillment_method || 'other',
      label: r.fulfillment_method === 'pod' ? 'Print on Demand' : r.fulfillment_method === 'dropship' ? 'Dropship' : r.fulfillment_method === 'digital' ? 'Digital' : 'Other',
      count: r.c,
    })),
  ];

  return { products, categories };
}

function applyFilters(products: StoreProduct[], category?: string, sort?: string): StoreProduct[] {
  // Deduplicate by keyword (keep highest score)
  const seen = new Map<string, StoreProduct>();
  for (const p of products) {
    const key = p.keyword.toLowerCase();
    if (!seen.has(key) || (p.score > (seen.get(key)!.score || 0))) {
      seen.set(key, p);
    }
  }
  let filtered = Array.from(seen.values());

  // Filter
  if (category && category !== 'all') {
    if (category === 'dropship' || category === 'pod' || category === 'digital') {
      filtered = filtered.filter(p => p.fulfillment_method === category);
    } else {
      filtered = filtered.filter(p => p.category === category);
    }
  }

  // Sort
  if (sort === 'price_low') filtered.sort((a, b) => (a.retail_price || 0) - (b.retail_price || 0));
  else if (sort === 'price_high') filtered.sort((a, b) => (b.retail_price || 0) - (a.retail_price || 0));
  else filtered.sort((a, b) => (b.score || 0) - (a.score || 0));

  return filtered;
}

const GRADIENT_COLORS: Record<string, [string, string]> = {
  home_decor: ['#1a1a3e', '#2d1a3e'],
  gadgets: ['#0a1a2e', '#1a2d3e'],
  fitness: ['#1a2e1a', '#1a3e2d'],
  kitchen: ['#2e2a1a', '#3e2d1a'],
  pod_apparel: ['#2e1a2e', '#3e1a1a'],
  pod_home: ['#1a2e2e', '#2d2e1a'],
  pod_accessories: ['#2e1a1a', '#1a1a2e'],
  beauty: ['#2e1a2e', '#3e1a2d'],
  outdoor: ['#1a2e1a', '#1a3e1a'],
  car_accessories: ['#1a1a2e', '#2e2e1a'],
  pet_products: ['#2e2a1a', '#1a2e2e'],
};

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; sort?: string }>;
}) {
  const params = await searchParams;

  let allProducts: StoreProduct[] = [];
  let categories: StoreCategory[] = [{ value: 'all', label: 'All Products', count: 0 }];

  try {
    const data = canUseLocalDb() ? await getStoreDataLocal() : await getStoreDataRemote();
    allProducts = data.products;
    categories = data.categories;
  } catch {
    try {
      const data = await getStoreDataRemote();
      allProducts = data.products;
      categories = data.categories;
    } catch { /* render empty */ }
  }

  const products = applyFilters(allProducts, params.category, params.sort);
  const activeCategory = params.category || 'all';
  const activeSort = params.sort || 'score';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <h1 style={{
          fontSize: '2rem', fontWeight: 700, color: '#00FFFF',
          fontFamily: "'JetBrains Mono', monospace",
          textShadow: '0 0 30px #00FFFF33',
          marginBottom: 8,
        }}>
          GHOST<span style={{ color: '#FF6B00' }}>MARKET</span> <span style={{ color: '#666', fontSize: '0.5em' }}>STORE</span>
        </h1>
        <p style={{ color: '#555', fontSize: '0.85rem', fontFamily: "'JetBrains Mono', monospace" }}>
          AI-curated trending products — vetted by neural scoring
        </p>
      </div>

      {/* Filters + Sort */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap',
        justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <a
              key={cat.value}
              href={`/store?category=${cat.value}&sort=${activeSort}`}
              style={{
                padding: '6px 14px', borderRadius: 6, textDecoration: 'none',
                fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace",
                background: activeCategory === cat.value ? '#00FFFF18' : '#08080c',
                color: activeCategory === cat.value ? '#00FFFF' : '#666',
                border: `1px solid ${activeCategory === cat.value ? '#00FFFF44' : '#1a1a22'}`,
                transition: 'all 0.2s',
              }}
            >
              {cat.label} <span style={{ opacity: 0.5 }}>({cat.count})</span>
            </a>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { value: 'score', label: 'Top Rated' },
            { value: 'price_low', label: 'Price ↑' },
            { value: 'price_high', label: 'Price ↓' },
          ].map(s => (
            <a
              key={s.value}
              href={`/store?category=${activeCategory}&sort=${s.value}`}
              style={{
                padding: '6px 12px', borderRadius: 6, textDecoration: 'none',
                fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace",
                color: activeSort === s.value ? '#FF6B00' : '#555',
                border: `1px solid ${activeSort === s.value ? '#FF6B0044' : 'transparent'}`,
              }}
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      {products.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#444', fontFamily: "'JetBrains Mono', monospace" }}>
          No products available in this category yet.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 20,
        }}>
          {products.map(product => {
            const gradientColors = GRADIENT_COLORS[product.category] || ['#1a1a2e', '#2d2d3e'];
            const hasLanding = product.has_landing > 0;
            const displayName = product.brand_name || product.keyword;
            const price = product.retail_price || 0;

            return (
              <div
                key={product.id}
                style={{
                  background: '#08080c',
                  border: '1px solid #00FFFF20',
                  borderRadius: 12,
                  overflow: 'hidden',
                  transition: 'border-color 0.3s, box-shadow 0.3s, transform 0.2s',
                }}
              >
                {/* Image */}
                <div style={{
                  width: '100%', aspectRatio: '1/1', position: 'relative',
                  background: product.image_b64
                    ? undefined
                    : `linear-gradient(135deg, ${gradientColors[0]}, ${gradientColors[1]})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {product.image_b64 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`data:image/png;base64,${product.image_b64}`}
                      alt={displayName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{
                      fontSize: '2.5rem', opacity: 0.15, fontFamily: "'JetBrains Mono', monospace",
                      color: '#00FFFF', textAlign: 'center', padding: 20,
                      letterSpacing: '-0.05em',
                    }}>
                      {displayName.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  {/* Fulfillment badge */}
                  <div style={{
                    position: 'absolute', top: 10, left: 10,
                    background: product.fulfillment_method === 'pod' ? '#FF6B0033' : '#00FFFF22',
                    color: product.fulfillment_method === 'pod' ? '#FF6B00' : '#00FFFF',
                    padding: '3px 8px', borderRadius: 4, fontSize: '0.6rem',
                    fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    border: `1px solid ${product.fulfillment_method === 'pod' ? '#FF6B0044' : '#00FFFF33'}`,
                  }}>
                    {product.fulfillment_method || 'dropship'}
                  </div>
                </div>

                {/* Info */}
                <div style={{ padding: '14px 16px' }}>
                  <div style={{
                    fontSize: '0.9rem', fontWeight: 600, color: '#e0e0e0',
                    fontFamily: "'JetBrains Mono', monospace",
                    marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {displayName}
                  </div>
                  <div style={{
                    fontSize: '0.7rem', color: '#555', fontFamily: "'JetBrains Mono', monospace",
                    marginBottom: 12, textTransform: 'capitalize',
                  }}>
                    {product.category.replace(/_/g, ' ')}
                  </div>

                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{
                      fontSize: '1.3rem', fontWeight: 700, color: '#00FFFF',
                      fontFamily: "'JetBrains Mono', monospace",
                      textShadow: '0 0 10px #00FFFF22',
                    }}>
                      ${price.toFixed(2)}
                    </span>

                    {hasLanding ? (
                      <Link
                        href={`/landing/${product.id}`}
                        style={{
                          background: '#FF6B00',
                          color: '#000',
                          padding: '8px 18px',
                          borderRadius: 6,
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          fontFamily: "'JetBrains Mono', monospace",
                          textDecoration: 'none',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          transition: 'background 0.2s',
                        }}
                      >
                        View
                      </Link>
                    ) : (
                      <span style={{
                        color: '#333',
                        fontSize: '0.65rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        padding: '8px 12px',
                        border: '1px solid #1a1a22',
                        borderRadius: 6,
                      }}>
                        Coming Soon
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{
        marginTop: 40, textAlign: 'center', padding: '20px 0',
        borderTop: '1px solid #1a1a22', color: '#333', fontSize: '0.65rem',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        Powered by GhostMarket Neural Scoring — {products.length} products curated
      </div>
    </div>
  );
}
