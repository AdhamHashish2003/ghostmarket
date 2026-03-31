import { NextResponse } from 'next/server';
import { canUseLocalDb, fetchOrchestrator } from '@/lib/data';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

interface LandingRow {
  variant_id: string;
  copy_approach: string | null;
  html_content: string | null;
  html_path: string | null;
}

/** SHA-256 hash of IP — we never store the raw address. */
function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + 'gm-ab-salt').digest('hex');
}

/** Inject a tiny click-tracking script before </body>. */
function injectClickTracker(html: string, impressionId: string, productId: string, variant: string): string {
  const snippet = `
<script>
(function(){
  var fired=false;
  document.addEventListener('click',function(e){
    if(fired) return;
    var t=e.target;
    while(t&&t!==document){
      var tag=t.tagName;
      var txt=(t.textContent||'').trim().toLowerCase();
      if(tag==='A'||tag==='BUTTON'||
         txt.includes('order')||txt.includes('buy')||txt.includes('get')||txt.includes('shop')){
        fired=true;
        var data=JSON.stringify({impression_id:"${impressionId}",product_id:"${productId}",variant:"${variant}"});
        if(navigator.sendBeacon){
          navigator.sendBeacon('/api/ab-click',new Blob([data],{type:'application/json'}));
        }else{
          var x=new XMLHttpRequest();x.open('POST','/api/ab-click');
          x.setRequestHeader('Content-Type','application/json');x.send(data);
        }
        return;
      }
      t=t.parentElement;
    }
  });
})();
</script>`;
  if (html.includes('</body>')) {
    return html.replace('</body>', snippet + '</body>');
  }
  return html + snippet;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (canUseLocalDb()) {
    try {
      const { getDb } = await import('@/lib/db');
      const db = getDb();

      // Fetch all variants for this product
      const variants = db.prepare(
        `SELECT variant_id, copy_approach, html_content, html_path
         FROM landing_pages
         WHERE product_id = ? AND (html_content IS NOT NULL OR html_path IS NOT NULL)
         ORDER BY variant_id`
      ).all(id) as LandingRow[];

      if (variants.length === 0) {
        return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
      }

      // Pick a random variant (equal probability)
      const chosen = variants[Math.floor(Math.random() * variants.length)];

      // Resolve HTML content
      let html: string | null = chosen.html_content || null;
      if (!html && chosen.html_path) {
        const fs = await import('fs');
        if (fs.existsSync(chosen.html_path)) {
          html = fs.readFileSync(chosen.html_path, 'utf-8');
        }
      }

      if (!html) {
        return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
      }

      // Hash visitor IP
      const forwarded = request.headers.get('x-forwarded-for');
      const rawIp = forwarded?.split(',')[0]?.trim() || '0.0.0.0';
      const visitorHash = hashIp(rawIp);

      // Log impression (write-capable DB)
      let impressionId = crypto.randomUUID();
      try {
        const { getWriteDb } = await import('@/lib/db-write');
        const wdb = getWriteDb();
        wdb.prepare(
          `INSERT INTO ab_impressions (id, product_id, variant, visitor_hash, copy_approach)
           VALUES (?, ?, ?, ?, ?)`
        ).run(impressionId, id, chosen.variant_id, visitorHash, chosen.copy_approach || null);
      } catch {
        // Don't fail the page load if impression logging fails
      }

      // Inject click tracker
      html = injectClickTracker(html, impressionId, id, chosen.variant_id);

      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
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
