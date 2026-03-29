import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  const errors = db.prepare(`
    SELECT agent, event_type, severity, message, metadata, created_at
    FROM system_events
    WHERE severity IN ('error', 'critical', 'warning')
    ORDER BY created_at DESC LIMIT 50
  `).all();
  return NextResponse.json({ errors });
}
