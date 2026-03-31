import { NextResponse } from 'next/server';
import { canUseLocalDb, fetchOrchestrator } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (canUseLocalDb()) {
    // Local: read html_content from SQLite, fall back to file
    try {
      const { getDb } = await import('@/lib/db');
      const db = getDb();

      // Try html_content column first (works everywhere)
      const page = db.prepare(
        'SELECT html_content, html_path FROM landing_pages WHERE product_id = ? AND (html_content IS NOT NULL OR html_path IS NOT NULL) ORDER BY variant_id LIMIT 1'
      ).get(id) as { html_content: string | null; html_path: string | null } | undefined;

      if (page?.html_content) {
        return new NextResponse(page.html_content, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // Fall back to file on disk
      if (page?.html_path) {
        const fs = await import('fs');
        if (fs.existsSync(page.html_path)) {
          const html = fs.readFileSync(page.html_path, 'utf-8');
          return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
      }
    } catch { /* fall through */ }
  } else {
    // Vercel: proxy to orchestrator via tunnel
    const orchUrl = process.env.ORCHESTRATOR_URL;
    if (orchUrl) {
      try {
        const resp = await fetch(`${orchUrl}/api/landing/${id}`, {
          signal: AbortSignal.timeout(20000),
        });
        if (resp.ok) {
          const html = await resp.text();
          return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
      } catch { /* fall through */ }
    }
  }

  return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
}
