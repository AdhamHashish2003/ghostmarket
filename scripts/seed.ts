import 'dotenv/config';
import { db, rawProducts, trendSignals, pool } from '@ghostmarket/shared';

const BATCH_ID = `seed-${Date.now()}`;

// --- Seed trend_signals (commercial/product-oriented trends) ---
const trendSeeds = [
  { keyword: 'portable fan', interest_score: 85, velocity: '7.2', related: ['usb fan', 'neck fan', 'desk fan'] },
  { keyword: 'stanley cup', interest_score: 92, velocity: '4.1', related: ['stanley tumbler', 'water bottle', 'insulated cup'] },
  { keyword: 'ring light', interest_score: 68, velocity: '2.3', related: ['selfie light', 'tiktok light', 'streaming light'] },
  { keyword: 'wireless earbuds', interest_score: 78, velocity: '1.8', related: ['bluetooth earbuds', 'airpods alternative'] },
  { keyword: 'LED strip lights', interest_score: 72, velocity: '3.5', related: ['room lights', 'RGB lights', 'smart lights'] },
  { keyword: 'phone case', interest_score: 65, velocity: '1.2', related: ['iphone case', 'clear case', 'magsafe case'] },
  { keyword: 'posture corrector', interest_score: 74, velocity: '5.8', related: ['back brace', 'posture fix', 'desk ergonomics'] },
  { keyword: 'mini projector', interest_score: 81, velocity: '6.1', related: ['portable projector', 'home theater', 'bedroom projector'] },
  { keyword: 'oil diffuser', interest_score: 60, velocity: '1.5', related: ['essential oils', 'aromatherapy', 'room scent'] },
  { keyword: 'resistance bands', interest_score: 70, velocity: '2.9', related: ['workout bands', 'home gym', 'fitness bands'] },
  { keyword: 'scalp massager', interest_score: 77, velocity: '8.3', related: ['head massager', 'hair growth', 'shampoo brush'] },
  { keyword: 'cloud slides', interest_score: 88, velocity: '9.1', related: ['pillow slides', 'recovery slides', 'comfy slides'] },
  { keyword: 'smart watch', interest_score: 83, velocity: '2.0', related: ['fitness tracker', 'apple watch alternative'] },
  { keyword: 'ice roller', interest_score: 71, velocity: '4.5', related: ['face roller', 'skincare', 'puffiness'] },
  { keyword: 'sunset lamp', interest_score: 66, velocity: '3.2', related: ['projection lamp', 'tiktok lamp', 'aesthetic lamp'] },
  { keyword: 'cordless vacuum', interest_score: 76, velocity: '1.7', related: ['handheld vacuum', 'car vacuum', 'dyson alternative'] },
  { keyword: 'digital picture frame', interest_score: 62, velocity: '2.8', related: ['wifi frame', 'photo frame gift'] },
  { keyword: 'heated blanket', interest_score: 58, velocity: '1.1', related: ['electric blanket', 'warming blanket'] },
  { keyword: 'air fryer', interest_score: 87, velocity: '3.4', related: ['ninja air fryer', 'healthy cooking', 'kitchen gadget'] },
  { keyword: 'pet camera', interest_score: 64, velocity: '2.6', related: ['dog camera', 'pet monitor', 'treat dispenser'] },
];

// --- Seed raw_products ---
const productSeeds = [
  { source: 'aliexpress', title: 'Portable Neck Fan USB Rechargeable Bladeless 3-Speed', price: 8.99, original: 15.99, sales: 8500, reviews: 3200, rating: 4.6, category: 'Consumer Electronics', tags: ['portable fan', 'summer'] },
  { source: 'aliexpress', title: 'Mini Projector 1080P WiFi Bluetooth Home Theater', price: 42.50, original: 89.99, sales: 3200, reviews: 1800, rating: 4.3, category: 'Consumer Electronics', tags: ['mini projector', 'home theater'] },
  { source: 'amazon', title: 'Stanley Quencher H2.0 Tumbler 40oz Stainless Steel', price: 35.00, original: 45.00, sales: 12000, reviews: 45000, rating: 4.8, category: 'Home & Kitchen', tags: ['stanley cup', 'tumbler'] },
  { source: 'amazon', title: 'LED Strip Lights 50ft RGB Color Changing with Remote', price: 12.99, original: 24.99, sales: 7800, reviews: 12000, rating: 4.4, category: 'Home & Kitchen', tags: ['LED strip lights', 'room decor'] },
  { source: 'tiktok_shop', title: 'Cloud Slides Pillow Slippers Ultra Soft Recovery', price: 14.99, original: 29.99, sales: 9200, reviews: 5600, rating: 4.5, category: 'Fashion', tags: ['cloud slides', 'tiktok_viral'] },
  { source: 'amazon', title: 'Wireless Earbuds Bluetooth 5.3 IPX7 Waterproof 36H', price: 19.99, original: 39.99, sales: 6500, reviews: 8900, rating: 4.4, category: 'Consumer Electronics', tags: ['wireless earbuds'] },
  { source: 'aliexpress', title: 'Posture Corrector Back Brace Adjustable Upper Back Support', price: 6.50, original: 12.00, sales: 4300, reviews: 2100, rating: 4.2, category: 'Beauty & Health', tags: ['posture corrector'] },
  { source: 'tiktok_shop', title: 'Scalp Massager Shampoo Brush Silicone Head Scrubber', price: 5.99, original: 11.99, sales: 11000, reviews: 7200, rating: 4.7, category: 'Beauty & Health', tags: ['scalp massager', 'tiktok_viral'] },
  { source: 'amazon', title: '10" Ring Light with Tripod Stand Phone Holder', price: 22.99, original: 34.99, sales: 5100, reviews: 15000, rating: 4.5, category: 'Consumer Electronics', tags: ['ring light', 'streaming'] },
  { source: 'aliexpress', title: 'Essential Oil Diffuser 300ml Ultrasonic Humidifier', price: 9.50, original: 18.00, sales: 3800, reviews: 1500, rating: 4.3, category: 'Home & Kitchen', tags: ['oil diffuser', 'aromatherapy'] },
  { source: 'amazon', title: 'Resistance Bands Set 5-Pack Exercise Workout Bands', price: 11.99, original: 19.99, sales: 4200, reviews: 9800, rating: 4.6, category: 'Sports & Outdoors', tags: ['resistance bands', 'home gym'] },
  { source: 'tiktok_shop', title: 'Ice Roller for Face & Eye Puffiness Relief', price: 7.99, original: 14.99, sales: 6800, reviews: 3400, rating: 4.4, category: 'Beauty & Health', tags: ['ice roller', 'skincare', 'tiktok_viral'] },
  { source: 'aliexpress', title: 'Sunset Lamp Projection LED Rainbow Night Light', price: 8.50, original: 16.00, sales: 5500, reviews: 2800, rating: 4.3, category: 'Home & Kitchen', tags: ['sunset lamp', 'aesthetic'] },
  { source: 'amazon', title: 'Smart Watch Fitness Tracker Heart Rate Blood Oxygen', price: 29.99, original: 49.99, sales: 7200, reviews: 11000, rating: 4.3, category: 'Consumer Electronics', tags: ['smart watch', 'fitness tracker'] },
  { source: 'aliexpress', title: 'Phone Case Clear Magnetic MagSafe Compatible iPhone 15', price: 4.99, original: 9.99, sales: 15000, reviews: 6000, rating: 4.1, category: 'Consumer Electronics', tags: ['phone case', 'magsafe'] },
  { source: 'amazon', title: 'Cordless Handheld Vacuum Cleaner 12000Pa Suction Car', price: 34.99, original: 59.99, sales: 3100, reviews: 4500, rating: 4.2, category: 'Home & Kitchen', tags: ['cordless vacuum'] },
  { source: 'tiktok_shop', title: 'Digital Picture Frame 10.1" WiFi Touch Screen IPS', price: 38.99, original: 69.99, sales: 2200, reviews: 1800, rating: 4.5, category: 'Consumer Electronics', tags: ['digital picture frame'] },
  { source: 'aliexpress', title: 'USB Heated Blanket Electric Warming Throw 150x80cm', price: 15.99, original: 28.00, sales: 1800, reviews: 900, rating: 4.1, category: 'Home & Kitchen', tags: ['heated blanket'] },
  { source: 'amazon', title: 'Air Fryer 5.8QT Large Capacity Oil-Free Digital Touch', price: 44.99, original: 79.99, sales: 9800, reviews: 22000, rating: 4.7, category: 'Home & Kitchen', tags: ['air fryer', 'kitchen gadget'] },
  { source: 'tiktok_shop', title: 'Pet Camera WiFi Dog Treat Dispenser 1080P Night Vision', price: 32.99, original: 54.99, sales: 2800, reviews: 2100, rating: 4.4, category: 'Home & Kitchen', tags: ['pet camera', 'tiktok_viral'] },
  { source: 'aliexpress', title: 'Bluetooth Speaker Portable Waterproof Wireless Mini', price: 11.50, original: 22.00, sales: 6100, reviews: 3500, rating: 4.3, category: 'Consumer Electronics', tags: ['bluetooth speaker'] },
  { source: 'amazon', title: 'Electric Toothbrush Sonic USB Rechargeable 6 Modes', price: 16.99, original: 29.99, sales: 4800, reviews: 7200, rating: 4.5, category: 'Beauty & Health', tags: ['electric toothbrush'] },
  { source: 'tiktok_shop', title: 'Laptop Stand Adjustable Aluminum Foldable Portable', price: 18.99, original: 35.99, sales: 3600, reviews: 2400, rating: 4.6, category: 'Consumer Electronics', tags: ['laptop stand', 'tiktok_viral'] },
  { source: 'aliexpress', title: 'Car Phone Holder Magnetic Dashboard Mount Universal', price: 3.99, original: 8.99, sales: 9200, reviews: 4100, rating: 4.2, category: 'Automobiles & Motorcycles', tags: ['car phone holder'] },
  { source: 'amazon', title: 'Yoga Mat Non-Slip 6mm Extra Thick Exercise Mat', price: 19.99, original: 34.99, sales: 5500, reviews: 13000, rating: 4.6, category: 'Sports & Outdoors', tags: ['yoga mat', 'fitness'] },
  { source: 'tiktok_shop', title: 'Teeth Whitening Kit LED Light 35% Carbamide Peroxide', price: 24.99, original: 49.99, sales: 4100, reviews: 2900, rating: 4.1, category: 'Beauty & Health', tags: ['teeth whitening', 'tiktok_viral'] },
  { source: 'aliexpress', title: 'Wireless Charging Pad 15W Fast Qi Charger Slim', price: 5.50, original: 12.00, sales: 7400, reviews: 3200, rating: 4.3, category: 'Consumer Electronics', tags: ['wireless charger'] },
  { source: 'amazon', title: 'Kitchen Scale Digital Food Scale 0.1g Precision', price: 9.99, original: 16.99, sales: 3900, reviews: 8500, rating: 4.7, category: 'Home & Kitchen', tags: ['kitchen scale'] },
  { source: 'aliexpress', title: 'Security Camera WiFi Indoor 360° Pan Tilt 2K', price: 14.99, original: 29.99, sales: 5200, reviews: 2800, rating: 4.4, category: 'Consumer Electronics', tags: ['security camera', 'smart home'] },
  { source: 'tiktok_shop', title: 'Makeup Brush Set 13-Piece Professional Powder Foundation', price: 9.99, original: 19.99, sales: 8100, reviews: 4500, rating: 4.5, category: 'Beauty & Health', tags: ['makeup brushes', 'tiktok_viral'] },
];

async function seed() {
  console.log('Seeding trend_signals...');
  for (const t of trendSeeds) {
    await db.insert(trendSignals).values({
      keyword: t.keyword,
      source: 'google_trends',
      interest_score: t.interest_score,
      velocity: t.velocity,
      related_queries: t.related,
      geo: 'US',
      captured_at: new Date(),
    });
  }
  console.log(`  Inserted ${trendSeeds.length} trend signals`);

  console.log('Seeding raw_products...');
  for (const p of productSeeds) {
    await db.insert(rawProducts).values({
      source: p.source as any,
      external_id: `seed-${Math.random().toString(36).slice(2, 12)}`,
      title: p.title,
      price_usd: p.price.toFixed(2),
      original_price_usd: p.original.toFixed(2),
      currency: 'USD',
      estimated_monthly_sales: p.sales,
      review_count: p.reviews,
      rating: p.rating.toFixed(2),
      category: p.category,
      product_url: `https://example.com/product/${Math.random().toString(36).slice(2, 10)}`,
      image_urls: [`https://picsum.photos/seed/${Math.random().toString(36).slice(2, 8)}/400/400`],
      tags: p.tags,
      batch_id: BATCH_ID,
    });
  }
  console.log(`  Inserted ${productSeeds.length} raw products with batch_id: ${BATCH_ID}`);

  await pool.end();
  console.log('Seed complete.');
}

seed().catch((e) => { console.error(e); process.exit(1); });
