import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { isLocal, proxyToOrchestrator } from '@/lib/api-proxy';

export const dynamic = 'force-dynamic';

const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';

function getDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

export async function GET() {
  if (!isLocal()) return proxyToOrchestrator('/api/pipeline');
  let db: Database.Database | null = null;
  try {
    db = getDb();

    // Count of products per stage
    const stageCounts = db.prepare(`
      SELECT stage, COUNT(*) as count
      FROM products
      GROUP BY stage
      ORDER BY CASE stage
        WHEN 'discovered' THEN 1
        WHEN 'scored' THEN 2
        WHEN 'approved' THEN 3
        WHEN 'building' THEN 4
        WHEN 'live' THEN 5
        WHEN 'tracking' THEN 6
        WHEN 'completed' THEN 7
        WHEN 'skipped' THEN 8
        WHEN 'killed' THEN 9
      END
    `).all();

    // Last activity per stage (most recent product updated_at in each stage)
    const lastActivity = db.prepare(`
      SELECT stage, MAX(updated_at) as last_activity
      FROM products
      GROUP BY stage
    `).all();

    // Recent events (last 50 system events)
    const recentEvents = db.prepare(`
      SELECT id, agent, event_type, severity, message, created_at
      FROM system_events
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    // Products currently in-flight (not terminal states)
    const inFlightCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM products
      WHERE stage NOT IN ('completed', 'skipped', 'killed')
    `).get() as { count: number };

    // Recent stage transitions (products updated in last 24h)
    const recentTransitions = db.prepare(`
      SELECT id, keyword, stage, score, updated_at
      FROM products
      WHERE updated_at >= datetime('now', '-24 hours')
      ORDER BY updated_at DESC
      LIMIT 20
    `).all();

    return NextResponse.json({
      stageCounts,
      lastActivity,
      recentEvents,
      inFlightCount: inFlightCount.count,
      recentTransitions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
