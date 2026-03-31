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

interface ProductCheckout {
  checkout_url: string | null;
  fulfillment_method: string | null;
}

/**
 * Inject checkout section (Buy Now button or waitlist form) before </body>.
 * If checkout_url is set → orange "Buy Now" linking out to Stripe/Gumroad.
 * If null → "Coming Soon — Join Waitlist" email capture form.
 * Also rewires existing CTA links to point to checkout or scroll to #gm-checkout.
 */
function injectCheckoutSection(html: string, productId: string, checkout: ProductCheckout): string {
  const checkoutUrl = checkout.checkout_url;

  const styles = `
<style>
  .gm-checkout { padding: 48px 20px; text-align: center; background: #111; }
  .gm-checkout h2 { color: #fff; font-size: 1.6rem; margin-bottom: 20px; }
  .gm-buy-btn { display: inline-block; background: #FF6B00; color: #fff; padding: 18px 56px;
    border-radius: 8px; font-size: 1.3rem; font-weight: 800; text-decoration: none;
    text-transform: uppercase; letter-spacing: 1px; transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 4px 20px rgba(255,107,0,0.4); }
  .gm-buy-btn:hover { transform: scale(1.05); box-shadow: 0 6px 28px rgba(255,107,0,0.6); }
  .gm-waitlist { max-width: 420px; margin: 0 auto; }
  .gm-waitlist p { color: #aaa; margin-bottom: 16px; font-size: 1rem; }
  .gm-waitlist-form { display: flex; gap: 8px; }
  .gm-waitlist-form input[type="email"] { flex: 1; padding: 14px 16px; border: 2px solid #333;
    border-radius: 8px; background: #1a1a1a; color: #fff; font-size: 1rem; outline: none; }
  .gm-waitlist-form input[type="email"]:focus { border-color: #FF6B00; }
  .gm-waitlist-form button { background: #FF6B00; color: #fff; border: none; padding: 14px 24px;
    border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; white-space: nowrap;
    transition: transform 0.2s; }
  .gm-waitlist-form button:hover { transform: scale(1.05); }
  .gm-waitlist-msg { margin-top: 12px; font-size: 0.95rem; }
  .gm-waitlist-msg.ok { color: #22C55E; }
  .gm-waitlist-msg.err { color: #DC2626; }
  @media (max-width: 480px) {
    .gm-waitlist-form { flex-direction: column; }
    .gm-buy-btn { display: block; width: 100%; max-width: 320px; margin: 0 auto; padding: 16px 20px; font-size: 1.1rem; }
  }
</style>`;

  let section: string;
  if (checkoutUrl) {
    section = `
<section class="gm-checkout" id="gm-checkout">
  <h2>Ready to Order?</h2>
  <a href="${checkoutUrl}" target="_blank" rel="noopener" class="gm-buy-btn">Buy Now &#8594;</a>
</section>`;
  } else {
    section = `
<section class="gm-checkout" id="gm-checkout">
  <h2>Coming Soon &mdash; Join the Waitlist</h2>
  <div class="gm-waitlist">
    <p>Be the first to know when this drops. No spam, just one email.</p>
    <form class="gm-waitlist-form" id="gm-waitlist-form">
      <input type="email" name="email" placeholder="you@example.com" required />
      <button type="submit">Notify Me</button>
    </form>
    <div class="gm-waitlist-msg" id="gm-waitlist-msg"></div>
  </div>
</section>
<script>
(function(){
  var form=document.getElementById('gm-waitlist-form');
  var msg=document.getElementById('gm-waitlist-msg');
  if(!form)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var email=form.querySelector('input[name="email"]').value;
    msg.textContent='Signing up...';msg.className='gm-waitlist-msg';
    fetch('/api/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:email,product_id:"${productId}"})})
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.ok){msg.textContent="You're on the list!";msg.className='gm-waitlist-msg ok';form.reset();}
      else{msg.textContent=d.error||'Something went wrong';msg.className='gm-waitlist-msg err';}
    }).catch(function(){msg.textContent='Network error — try again';msg.className='gm-waitlist-msg err';});
  });
})();
</script>`;
  }

  // Rewire existing CTA buttons: href="#order" and href="#" → point to checkout or #gm-checkout
  const ctaTarget = checkoutUrl
    ? `href="${checkoutUrl}" target="_blank" rel="noopener"`
    : 'href="#gm-checkout"';
  html = html.replace(/href="#order"/g, ctaTarget);
  html = html.replace(/<a\s+href="#"\s+class="cta"/g, `<a ${ctaTarget} class="cta"`);

  // Remove the old final-cta section (replaced by gm-checkout)
  html = html.replace(/<section class="final-cta"[^>]*>[\s\S]*?<\/section>/, '');

  // Inject styles in <head> and checkout section before </body>
  if (html.includes('</head>')) {
    html = html.replace('</head>', styles + '\n</head>');
  }
  if (html.includes('</body>')) {
    html = html.replace('</body>', section + '\n</body>');
  }

  return html;
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

      // Fetch checkout info for this product
      const productRow = db.prepare(
        `SELECT checkout_url, fulfillment_method FROM products WHERE id = ?`
      ).get(id) as ProductCheckout | undefined;
      const checkout: ProductCheckout = productRow || { checkout_url: null, fulfillment_method: null };

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

      // Inject checkout/waitlist section
      html = injectCheckoutSection(html, id, checkout);

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
