import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const { email, product_id } = await request.json();

    if (!email || !product_id) {
      return NextResponse.json({ error: 'Missing email or product_id' }, { status: 400 });
    }

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const { getWriteDb } = await import('@/lib/db-write');
    const db = getWriteDb();
    const crypto = await import('crypto');
    const id = crypto.randomUUID();

    db.prepare(
      'INSERT OR IGNORE INTO waitlist (id, email, product_id) VALUES (?, ?, ?)'
    ).run(id, email.toLowerCase().trim(), product_id);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Waitlist signup failed' }, { status: 500 });
  }
}
