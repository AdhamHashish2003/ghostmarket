import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STAGE_COLORS: Record<string, string> = {
  discovered: '#00f0ff',
  scored: '#ff00aa',
  approved: '#00ff66',
  building: '#ffaa00',
  live: '#00ff66',
  tracking: '#00f0ff',
  completed: '#8b5cf6',
  skipped: '#666',
  killed: '#ff3344',
};

const DIMENSION_COLORS: Record<string, string> = {
  trend_strength: '#00f0ff',
  market_gap: '#ff00aa',
  competition: '#00ff66',
  margin_potential: '#ffaa00',
  viral_potential: '#8b5cf6',
  seasonality: '#ff3344',
  supply_ease: '#06b6d4',
};

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  const db = getDb();

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(params.id) as Record<string, unknown> | undefined;
  if (!product) {
    return (
      <div style={{
        textAlign: 'center',
        padding: 60,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{ fontSize: '2rem', color: '#ff3344', marginBottom: 12 }}>404</div>
        <div style={{ color: '#666' }}>Product not found in neural network</div>
      </div>
    );
  }

  const signals = db.prepare('SELECT * FROM trend_signals WHERE product_id = ? ORDER BY created_at DESC').all(params.id) as Array<Record<string, unknown>>;
  const suppliers = db.prepare('SELECT * FROM suppliers WHERE product_id = ? ORDER BY landed_cost').all(params.id) as Array<Record<string, unknown>>;
  const brandKit = db.prepare('SELECT * FROM brand_kits WHERE product_id = ? LIMIT 1').get(params.id) as Record<string, unknown> | undefined;
  const pages = db.prepare('SELECT * FROM landing_pages WHERE product_id = ?').all(params.id) as Array<Record<string, unknown>>;
  const creatives = db.prepare('SELECT * FROM ad_creatives WHERE product_id = ?').all(params.id) as Array<Record<string, unknown>>;
  const posts = db.prepare('SELECT * FROM content_posts WHERE product_id = ? ORDER BY scheduled_at').all(params.id) as Array<Record<string, unknown>>;

  const breakdown = product.score_breakdown ? JSON.parse(product.score_breakdown as string) : null;
  const stageColor = STAGE_COLORS[product.stage as string] || '#666';

  return (
    <div>
      {/* Back link */}
      <a href="/dashboard/products" style={{
        color: '#555',
        textDecoration: 'none',
        fontSize: '0.75rem',
        fontFamily: "'JetBrains Mono', monospace",
        display: 'inline-block',
        marginBottom: 16,
      }}>
        &larr; BACK TO PRODUCTS
      </a>

      {/* Product Header */}
      <div style={{
        background: '#111118',
        border: '1px solid #1a1a24',
        borderRadius: 12,
        padding: '24px 28px',
        marginBottom: 24,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Top glow */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${stageColor}, transparent)`,
          opacity: 0.8,
        }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#e0e0e0',
              margin: '0 0 8px 0',
            }}>
              {String(product.keyword)}
            </h1>
            <div style={{
              fontSize: '0.8rem',
              color: '#666',
              fontFamily: "'JetBrains Mono', monospace",
              display: 'flex',
              gap: 16,
              alignItems: 'center',
            }}>
              <span>{String(product.category || 'Uncategorized')}</span>
              <span style={{
                background: `${stageColor}22`,
                color: stageColor,
                padding: '2px 10px',
                borderRadius: 4,
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                border: `1px solid ${stageColor}44`,
              }}>
                {String(product.stage)}
              </span>
              {product.outcome_label ? (
                <span style={{
                  color: String(product.outcome_label) === 'win' ? '#00ff66' : String(product.outcome_label) === 'loss' ? '#ff3344' : '#ffaa00',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                }}>
                  {String(product.outcome_label)}
                </span>
              ) : null}
            </div>
          </div>
          <div style={{
            textAlign: 'right',
          }}>
            <div style={{
              fontSize: '2.5rem',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              color: (Number(product.score) || 0) >= 80 ? '#00ff66' : (Number(product.score) || 0) >= 60 ? '#ffaa00' : '#666',
              lineHeight: 1,
              textShadow: (Number(product.score) || 0) >= 80 ? '0 0 20px #00ff6644' : 'none',
            }}>
              {product.score != null ? Number(product.score).toFixed(0) : '--'}
            </div>
            <div style={{
              fontSize: '0.6rem',
              color: '#555',
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}>
              Neural Score
            </div>
          </div>
        </div>
      </div>

      {/* Score Breakdown */}
      {breakdown && (
        <Section title="SCORE BREAKDOWN" color="#00f0ff">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 10,
          }}>
            {Object.entries(breakdown).map(([key, value]) => {
              const dimColor = DIMENSION_COLORS[key] || '#00f0ff';
              const numVal = Number(value);
              const pct = Math.min(100, Math.max(0, numVal));
              return (
                <div key={key} style={{
                  background: '#0d0d14',
                  border: '1px solid #1a1a24',
                  borderRadius: 8,
                  padding: '12px 14px',
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}>
                    <span style={{
                      fontSize: '0.65rem',
                      color: '#888',
                      fontFamily: "'JetBrains Mono', monospace",
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span style={{
                      fontSize: '1rem',
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      color: dimColor,
                    }}>
                      {numVal.toFixed(0)}
                    </span>
                  </div>
                  {/* Bar */}
                  <div style={{
                    width: '100%',
                    height: 4,
                    background: '#1a1a24',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${dimColor}88, ${dimColor})`,
                      borderRadius: 2,
                      boxShadow: `0 0 6px ${dimColor}44`,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <Section title={`TREND SIGNALS (${signals.length})`} color="#ff00aa">
          <div style={{ display: 'grid', gap: 8 }}>
            {signals.map((s, i) => (
              <div key={i} style={{
                background: '#0d0d14',
                border: '1px solid #1a1a24',
                borderRadius: 8,
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <span style={{
                    color: '#ff00aa',
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.8rem',
                  }}>
                    {String(s.source)}
                  </span>
                  <span style={{ color: '#444', margin: '0 8px' }}>&middot;</span>
                  <span style={{ color: '#888', fontSize: '0.75rem' }}>
                    Strength: {s.raw_signal_strength != null ? Number(s.raw_signal_strength).toFixed(2) : '?'}
                  </span>
                  <span style={{ color: '#444', margin: '0 8px' }}>&middot;</span>
                  <span style={{ color: '#888', fontSize: '0.75rem' }}>
                    Velocity: {String(s.trend_velocity || '?')}
                  </span>
                </div>
                {s.source_url ? (
                  <a href={String(s.source_url)} target="_blank" rel="noopener noreferrer" style={{
                    color: '#00f0ff',
                    fontSize: '0.7rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    textDecoration: 'none',
                  }}>
                    VIEW &rarr;
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Suppliers */}
      {suppliers.length > 0 && (
        <Section title={`SUPPLIERS (${suppliers.length})`} color="#ffaa00">
          <div style={{ display: 'grid', gap: 8 }}>
            {suppliers.map((s, i) => (
              <div key={i} style={{
                background: '#0d0d14',
                border: s.is_best ? '1px solid #00ff6644' : '1px solid #1a1a24',
                borderRadius: 8,
                padding: '14px 16px',
                boxShadow: s.is_best ? '0 0 12px #00ff6611' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{
                      fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.8rem',
                      color: s.is_best ? '#00ff66' : '#e0e0e0',
                    }}>
                      {String(s.platform)}
                    </span>
                    {s.is_best ? (
                      <span style={{
                        marginLeft: 8,
                        color: '#00ff66',
                        fontSize: '0.6rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 600,
                        background: '#00ff6622',
                        padding: '1px 6px',
                        borderRadius: 3,
                      }}>
                        BEST
                      </span>
                    ) : null}
                  </div>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1rem',
                    fontWeight: 700,
                    color: '#ffaa00',
                  }}>
                    ${s.landed_cost != null ? Number(s.landed_cost).toFixed(2) : '?'}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: '#666',
                  fontFamily: "'JetBrains Mono', monospace",
                  marginTop: 6,
                  display: 'flex',
                  gap: 16,
                }}>
                  <span>Unit: ${s.unit_cost != null ? Number(s.unit_cost).toFixed(2) : '?'}</span>
                  <span>Ship: ${s.shipping_cost != null ? Number(s.shipping_cost).toFixed(2) : '?'}</span>
                  <span>Margin: {s.margin_pct != null ? Number(s.margin_pct).toFixed(0) : '?'}%</span>
                  {s.warehouse ? <span>WH: {String(s.warehouse)}</span> : null}
                  <span>Rating: {String(s.seller_rating || '?')}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Brand Kit */}
      {brandKit && (
        <Section title="BRAND KIT" color="#8b5cf6">
          <div style={{
            background: '#0d0d14',
            border: '1px solid #1a1a24',
            borderRadius: 8,
            padding: '16px 20px',
          }}>
            <div style={{ marginBottom: 12 }}>
              <span style={{ color: '#666', fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" }}>BRAND NAME</span>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#e0e0e0', marginTop: 2 }}>
                {String(brandKit.brand_name)}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ color: '#666', fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" }}>BIO</span>
              <div style={{ fontSize: '0.85rem', color: '#aaa', marginTop: 2 }}>
                {String(brandKit.instagram_bio)}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ color: '#666', fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" }}>POSITIONING</span>
              <div style={{ fontSize: '0.85rem', color: '#aaa', marginTop: 2 }}>
                {String(brandKit.page_description)}
              </div>
            </div>
            {brandKit.color_palette ? (
              <div>
                <span style={{ color: '#666', fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" }}>PALETTE</span>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {(JSON.parse(String(brandKit.color_palette)) as string[]).map((c, i) => (
                    <div key={i} style={{
                      width: 36,
                      height: 36,
                      background: c,
                      borderRadius: 4,
                      border: '1px solid #1a1a24',
                    }} title={c} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Section>
      )}

      {/* Landing Pages */}
      {pages.length > 0 && (
        <Section title={`LANDING PAGES (${pages.length})`} color="#00f0ff">
          <div style={{ display: 'grid', gap: 8 }}>
            {pages.map((p, i) => (
              <div key={i} style={{
                background: '#0d0d14',
                border: '1px solid #1a1a24',
                borderRadius: 8,
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', color: '#e0e0e0' }}>
                    Variant {String(p.variant_id)}
                  </span>
                  <span style={{ color: '#444', margin: '0 8px' }}>&middot;</span>
                  <span style={{ color: '#888', fontSize: '0.75rem' }}>{String(p.copy_approach)}</span>
                  <span style={{ color: '#444', margin: '0 8px' }}>&middot;</span>
                  <span style={{ color: '#666', fontSize: '0.75rem' }}>
                    Conv: {p.conversion_rate != null ? Number(p.conversion_rate).toFixed(3) : 'N/A'}
                  </span>
                </div>
                {p.url ? (
                  <a href={String(p.url)} target="_blank" rel="noopener noreferrer" style={{
                    color: '#00f0ff',
                    fontSize: '0.7rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    textDecoration: 'none',
                  }}>
                    VISIT &rarr;
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Ad Creatives */}
      {creatives.length > 0 && (
        <Section title={`AD CREATIVES (${creatives.length})`} color="#ff00aa">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
            {creatives.map((c, i) => (
              <div key={i} style={{
                background: '#0d0d14',
                border: '1px solid #1a1a24',
                borderRadius: 8,
                padding: '12px 16px',
              }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>
                  {String(c.platform || 'Ad')} - {String(c.ad_type || 'Creative')}
                </div>
                {c.headline ? (
                  <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 4 }}>
                    {String(c.headline)}
                  </div>
                ) : null}
                {c.primary_text ? (
                  <div style={{ fontSize: '0.7rem', color: '#666' }}>
                    {String(c.primary_text).slice(0, 100)}...
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Financials */}
      <Section title="FINANCIALS" color="#ffaa00">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <FinancialCard label="Revenue" value={`$${Number(product.total_revenue || 0).toFixed(2)}`} color="#00ff66" />
          <FinancialCard label="Ad Spend" value={`$${Number(product.total_ad_spend || 0).toFixed(2)}`} color="#ff3344" />
          <FinancialCard label="Orders" value={String(Number(product.total_orders) || 0)} color="#00f0ff" />
          <FinancialCard label="ROAS" value={product.roas != null ? `${Number(product.roas).toFixed(1)}x` : 'N/A'} color="#ffaa00" />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: '0.7rem',
        fontWeight: 600,
        color: '#555',
        fontFamily: "'JetBrains Mono', monospace",
        letterSpacing: '0.1em',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ width: 3, height: 14, background: color, borderRadius: 1, display: 'inline-block' }} />
        {title}
      </div>
      {children}
    </div>
  );
}

function FinancialCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: '#0d0d14',
      border: '1px solid #1a1a24',
      borderRadius: 8,
      padding: '16px 14px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        opacity: 0.5,
      }} />
      <div style={{
        fontSize: '0.6rem',
        color: '#666',
        fontFamily: "'JetBrains Mono', monospace",
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.3rem',
        fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
        color,
        textShadow: `0 0 12px ${color}33`,
      }}>
        {value}
      </div>
    </div>
  );
}
