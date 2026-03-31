import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  const db = getDb();

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(params.id) as Record<string, unknown> | undefined;
  if (!product) {
    return <div>Product not found</div>;
  }

  const signals = db.prepare('SELECT * FROM trend_signals WHERE product_id = ? ORDER BY created_at DESC').all(params.id) as Array<Record<string, unknown>>;
  const suppliers = db.prepare('SELECT * FROM suppliers WHERE product_id = ? ORDER BY landed_cost').all(params.id) as Array<Record<string, unknown>>;
  const brandKit = db.prepare('SELECT * FROM brand_kits WHERE product_id = ? LIMIT 1').get(params.id) as Record<string, unknown> | undefined;
  const pages = db.prepare('SELECT * FROM landing_pages WHERE product_id = ?').all(params.id) as Array<Record<string, unknown>>;
  const creatives = db.prepare('SELECT * FROM ad_creatives WHERE product_id = ?').all(params.id) as Array<Record<string, unknown>>;
  const posts = db.prepare('SELECT * FROM content_posts WHERE product_id = ? ORDER BY scheduled_at').all(params.id) as Array<Record<string, unknown>>;
  const decisions = db.prepare('SELECT * FROM operator_decisions WHERE product_id = ?').all(params.id) as Array<Record<string, unknown>>;

  const breakdown = product.score_breakdown ? JSON.parse(product.score_breakdown as string) : null;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>{String(product.keyword)}</h1>
      <div style={{ color: '#888', marginBottom: 24 }}>
        {String(product.category || 'Uncategorized')} · Stage: <b>{String(product.stage)}</b> · Score: <b style={{ color: '#22c55e' }}>{product.score != null ? Number(product.score).toFixed(0) : 'N/A'}</b>/100
        {product.outcome_label ? <> · Outcome: <b>{String(product.outcome_label) === 'win' ? '✅ Win' : String(product.outcome_label) === 'loss' ? '❌ Loss' : '➖ Breakeven'}</b></> : null}
      </div>

      {/* Score Breakdown */}
      {breakdown && (
        <Section title="Score Breakdown">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {Object.entries(breakdown).map(([key, value]) => (
              <div key={key} style={{ background: '#1a1a22', padding: 12, borderRadius: 6 }}>
                <div style={{ fontSize: '0.75rem', color: '#888' }}>{key.replace(/_/g, ' ')}</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{Number(value).toFixed(0)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Signals */}
      <Section title={`Trend Signals (${signals.length})`}>
        {signals.map((s, i) => (
          <div key={i} style={{ background: '#1a1a22', padding: 12, borderRadius: 6, marginBottom: 8 }}>
            <b>{String(s.source)}</b> · Strength: {s.raw_signal_strength != null ? Number(s.raw_signal_strength).toFixed(2) : '?'} · Velocity: {String(s.trend_velocity || '?')}
            {s.source_url ? <> · <a href={String(s.source_url)} target="_blank" style={{ color: '#60a5fa' }}>Link</a></> : null}
          </div>
        ))}
      </Section>

      {/* Suppliers */}
      <Section title={`Suppliers (${suppliers.length})`}>
        {suppliers.map((s, i) => (
          <div key={i} style={{ background: '#1a1a22', padding: 12, borderRadius: 6, marginBottom: 8, border: s.is_best ? '1px solid #22c55e' : '1px solid transparent' }}>
            <b>{String(s.platform)}</b> {s.is_best ? '← BEST' : ''} ·
            ${s.unit_cost != null ? Number(s.unit_cost).toFixed(2) : '?'} + ${s.shipping_cost != null ? Number(s.shipping_cost).toFixed(2) : '?'} = <b>${s.landed_cost != null ? Number(s.landed_cost).toFixed(2) : '?'}</b> ·
            Margin: {s.margin_pct != null ? Number(s.margin_pct).toFixed(0) : '?'}% ·
            {s.warehouse ? <> Warehouse: {String(s.warehouse)} ·</> : null}
            Rating: {String(s.seller_rating || '?')}
          </div>
        ))}
      </Section>

      {/* Brand Kit */}
      {brandKit ? (
        <Section title="Brand Kit">
          <div style={{ background: '#1a1a22', padding: 16, borderRadius: 6 }}>
            <div><b>Name:</b> {String(brandKit.brand_name)}</div>
            <div><b>Bio:</b> {String(brandKit.instagram_bio)}</div>
            <div><b>Positioning:</b> {String(brandKit.page_description)}</div>
            {brandKit.color_palette ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {(JSON.parse(String(brandKit.color_palette)) as string[]).map((c, i) => (
                  <div key={i} style={{ width: 40, height: 40, background: c, borderRadius: 4, border: '1px solid #333' }} title={c} />
                ))}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* Landing Pages */}
      {pages.length > 0 ? (
        <Section title={`Landing Pages (${pages.length})`}>
          {pages.map((p, i) => (
            <div key={i} style={{ background: '#1a1a22', padding: 12, borderRadius: 6, marginBottom: 8 }}>
              Variant {String(p.variant_id)} ({String(p.copy_approach)}) ·
              {p.url ? <a href={String(p.url)} target="_blank" style={{ color: '#60a5fa' }}>Visit</a> : 'Not deployed'} ·
              Conv rate: {p.conversion_rate != null ? Number(p.conversion_rate).toFixed(3) : 'N/A'}
            </div>
          ))}
        </Section>
      ) : null}

      {/* Financials */}
      <Section title="Financials">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Metric label="Revenue" value={`$${Number(product.total_revenue) || 0}`} />
          <Metric label="Ad Spend" value={`$${Number(product.total_ad_spend) || 0}`} />
          <Metric label="Orders" value={String(Number(product.total_orders) || 0)} />
          <Metric label="ROAS" value={product.roas != null ? Number(product.roas).toFixed(1) : 'N/A'} />
        </div>
      </Section>

      {/* Operator Decisions */}
      {decisions.length > 0 ? (
        <Section title="Operator Decisions">
          {decisions.map((d, i) => (
            <div key={i} style={{ background: '#1a1a22', padding: 8, borderRadius: 4, marginBottom: 4 }}>
              {String(d.decision)} · {new Date(String(d.created_at)).toLocaleString()}
              {d.modification_notes ? <> · Notes: {String(d.modification_notes)}</> : null}
            </div>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12, color: '#ccc' }}>{title}</h2>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#1a1a22', padding: 16, borderRadius: 6, textAlign: 'center' }}>
      <div style={{ fontSize: '0.75rem', color: '#888' }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{value}</div>
    </div>
  );
}
