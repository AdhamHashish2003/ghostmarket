import { NextResponse } from 'next/server';
import { isLocal, proxyToOrchestrator } from '@/lib/api-proxy';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isLocal()) return proxyToOrchestrator('/api/store');

  let db;
  try {
    const Database = (await import('better-sqlite3')).default;
    const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');

    const products = db.prepare(`
      SELECT p.id, p.keyword, p.category, p.fulfillment_method, p.stage, p.score,
             bk.brand_name,
             s.estimated_retail as retail_price,
             (SELECT COUNT(*) FROM landing_pages lp WHERE lp.product_id = p.id AND lp.html_content IS NOT NULL) as has_landing
      FROM products p
      LEFT JOIN brand_kits bk ON bk.product_id = p.id
      LEFT JOIN suppliers s ON s.product_id = p.id AND s.is_best = 1
      WHERE p.stage IN ('approved', 'live', 'tracking', 'building')
      ORDER BY p.score DESC
    `).all();

    const categories = db.prepare(`
      SELECT fulfillment_method, COUNT(*) as c FROM products
      WHERE stage IN ('approved','live','tracking','building')
      GROUP BY fulfillment_method ORDER BY c DESC
    `).all();

    return NextResponse.json({ products, categories });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
