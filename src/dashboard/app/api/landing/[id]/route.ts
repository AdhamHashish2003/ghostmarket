import { NextResponse } from 'next/server';
import { isLocal, proxyToOrchestrator } from '@/lib/api-proxy';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (isLocal()) {
    try {
      const { getDb } = await import('@/lib/db');
      const db = getDb();
      const page = db.prepare(
        'SELECT html_content FROM landing_pages WHERE product_id = ? AND html_content IS NOT NULL ORDER BY variant_id LIMIT 1'
      ).get(id) as { html_content: string } | undefined;

      if (page?.html_content) {
        return new NextResponse(page.html_content, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    } catch { /* fall through */ }
  }

  return proxyToOrchestrator(`/api/landing/${id}`);
}
