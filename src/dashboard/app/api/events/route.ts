import { isLocal, proxyToOrchestrator } from '@/lib/api-proxy';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';

function getDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

export async function GET() {
  if (!isLocal()) return proxyToOrchestrator('/api/events/stream');
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      let lastEventId = '';

      const poll = () => {
        if (cancelled) return;

        let db: Database.Database | null = null;
        try {
          db = getDb();

          let events;
          if (lastEventId) {
            // Fetch events newer than the last seen event
            events = db.prepare(`
              SELECT id, agent, event_type, severity, message, created_at
              FROM system_events
              WHERE created_at > (SELECT created_at FROM system_events WHERE id = ?)
              ORDER BY created_at ASC
              LIMIT 100
            `).all(lastEventId);
          } else {
            // Initial load: last 20 events
            events = db.prepare(`
              SELECT id, agent, event_type, severity, message, created_at
              FROM system_events
              ORDER BY created_at DESC
              LIMIT 20
            `).all();
            // Reverse so oldest first for streaming order
            events.reverse();
          }

          if (events.length > 0) {
            for (const event of events) {
              const evt = event as { id: string; agent: string; event_type: string; severity: string; message: string; created_at: string };
              lastEventId = evt.id;
              const data = JSON.stringify(evt);
              controller.enqueue(
                encoder.encode(`id: ${evt.id}\nevent: system_event\ndata: ${data}\n\n`)
              );
            }
          } else {
            // Send heartbeat to keep connection alive
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
          );
        } finally {
          db?.close();
        }

        // Schedule next poll in 2 seconds
        if (!cancelled) {
          setTimeout(poll, 2000);
        }
      };

      // Start polling
      poll();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
