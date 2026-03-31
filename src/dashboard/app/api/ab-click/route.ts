import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { impression_id, product_id, variant } = await request.json();

    if (!impression_id || !product_id || !variant) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const { getWriteDb } = await import('@/lib/db-write');
    const db = getWriteDb();
    const crypto = await import('crypto');
    const id = crypto.randomUUID();

    db.prepare(
      'INSERT INTO ab_clicks (id, impression_id, product_id, variant) VALUES (?, ?, ?, ?)'
    ).run(id, impression_id, product_id, variant);

    return NextResponse.json({ ok: true, click_id: id });
  } catch (e) {
    return NextResponse.json({ error: 'Click logging failed' }, { status: 500 });
  }
}
