import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get('table');
  const limit = Math.min(Number(searchParams.get('limit') || 50), 200);

  const db = getDb();

  if (!table) {
    // Return all table names with row counts
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all() as Array<{ name: string }>;

    const counts = tables.map(t => {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as { cnt: number };
      return { table: t.name, rows: row.cnt };
    });
    return NextResponse.json({ tables: counts });
  }

  // Validate table name (prevent SQL injection)
  const validTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  if (!validTables.some(t => t.name === table)) {
    return NextResponse.json({ error: `Invalid table: ${table}` }, { status: 400 });
  }

  const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY created_at DESC LIMIT ?`).all(limit);
  const count = (db.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`).get() as { cnt: number }).cnt;

  return NextResponse.json({ table, total: count, rows });
}
