import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const DB_PATH = process.env.GHOSTMARKET_DB || path.resolve(process.cwd(), '../../data/ghostmarket.db');

function getDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

export async function GET() {
  let db: Database.Database | null = null;
  try {
    db = getDb();

    // Agent status: based on most recent event per agent
    const agentStatus = db.prepare(`
      SELECT
        se.agent,
        se.event_type as last_event_type,
        se.severity as last_severity,
        se.message as last_message,
        se.created_at as last_seen,
        CASE
          WHEN se.event_type IN ('error', 'api_failure', 'scrape_failure') AND se.severity IN ('error', 'critical')
            THEN 'error'
          WHEN se.event_type IN ('retry', 'rate_limit', 'failover')
            THEN 'warning'
          WHEN se.event_type = 'shutdown'
            THEN 'offline'
          ELSE 'healthy'
        END as status,
        (SELECT COUNT(*) FROM system_events se2
         WHERE se2.agent = se.agent
           AND se2.severity IN ('error', 'critical')
           AND se2.created_at >= datetime('now', '-24 hours')
        ) as errors_24h,
        (SELECT COUNT(*) FROM system_events se2
         WHERE se2.agent = se.agent
           AND se2.created_at >= datetime('now', '-24 hours')
        ) as events_24h
      FROM system_events se
      INNER JOIN (
        SELECT agent, MAX(created_at) as max_created
        FROM system_events
        GROUP BY agent
      ) latest ON se.agent = latest.agent AND se.created_at = latest.max_created
      ORDER BY se.agent
    `).all();

    // Error log (recent errors and critical events)
    const errorLog = db.prepare(`
      SELECT id, agent, event_type, severity, message, metadata, created_at, resolved
      FROM system_events
      WHERE severity IN ('error', 'critical')
      ORDER BY created_at DESC
      LIMIT 50
    `).all() as Record<string, unknown>[];

    const enrichedErrors = errorLog.map((e) => ({
      ...e,
      metadata: e.metadata ? tryParseJson(e.metadata as string) : null,
    }));

    // DB size
    let dbSizeBytes = 0;
    try {
      const stats = fs.statSync(DB_PATH);
      dbSizeBytes = stats.size;
    } catch {
      // DB file might not exist or be inaccessible
    }

    // Also check WAL file size
    let walSizeBytes = 0;
    try {
      const walStats = fs.statSync(DB_PATH + '-wal');
      walSizeBytes = walStats.size;
    } catch {
      // WAL file might not exist
    }

    // Event counts by type
    const eventCounts = db.prepare(`
      SELECT event_type, COUNT(*) as count
      FROM system_events
      GROUP BY event_type
      ORDER BY count DESC
    `).all();

    // Event counts by severity
    const severityCounts = db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM system_events
      GROUP BY severity
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'error' THEN 2
          WHEN 'warning' THEN 3
          WHEN 'info' THEN 4
        END
    `).all();

    // Events in last 24 hours
    const events24h = db.prepare(`
      SELECT COUNT(*) as count
      FROM system_events
      WHERE created_at >= datetime('now', '-24 hours')
    `).get() as { count: number };

    // Unresolved errors
    const unresolvedErrors = db.prepare(`
      SELECT COUNT(*) as count
      FROM system_events
      WHERE severity IN ('error', 'critical') AND resolved = 0
    `).get() as { count: number };

    // Table row counts
    const tableCounts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products) as products,
        (SELECT COUNT(*) FROM trend_signals) as trend_signals,
        (SELECT COUNT(*) FROM suppliers) as suppliers,
        (SELECT COUNT(*) FROM brand_kits) as brand_kits,
        (SELECT COUNT(*) FROM landing_pages) as landing_pages,
        (SELECT COUNT(*) FROM ad_creatives) as ad_creatives,
        (SELECT COUNT(*) FROM content_posts) as content_posts,
        (SELECT COUNT(*) FROM campaign_metrics) as campaign_metrics,
        (SELECT COUNT(*) FROM outcomes) as outcomes,
        (SELECT COUNT(*) FROM learning_cycles) as learning_cycles,
        (SELECT COUNT(*) FROM operator_decisions) as operator_decisions,
        (SELECT COUNT(*) FROM system_events) as system_events,
        (SELECT COUNT(*) FROM llm_calls) as llm_calls
    `).get();

    // Hourly event rate (last 24h)
    const hourlyEvents = db.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00:00', created_at) as hour,
        COUNT(*) as count,
        COUNT(CASE WHEN severity IN ('error', 'critical') THEN 1 END) as error_count
      FROM system_events
      WHERE created_at >= datetime('now', '-24 hours')
      GROUP BY hour
      ORDER BY hour ASC
    `).all();

    return NextResponse.json({
      agentStatus,
      errorLog: enrichedErrors,
      database: {
        path: DB_PATH,
        sizeBytes: dbSizeBytes,
        sizeMB: Math.round((dbSizeBytes / 1024 / 1024) * 100) / 100,
        walSizeBytes,
        walSizeMB: Math.round((walSizeBytes / 1024 / 1024) * 100) / 100,
        tableCounts,
      },
      events: {
        total: eventCounts,
        bySeverity: severityCounts,
        last24h: events24h.count,
        unresolvedErrors: unresolvedErrors.count,
        hourlyRate: hourlyEvents,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
