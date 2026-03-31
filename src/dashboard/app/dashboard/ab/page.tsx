import { canUseLocalDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

interface ABRow {
  product_id: string;
  keyword: string;
  variant: string;
  copy_approach: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
}

interface ProductGroup {
  product_id: string;
  keyword: string;
  variants: ABRow[];
  total_impressions: number;
  total_clicks: number;
  winner: string | null;
}

async function getABData(): Promise<{ groups: ProductGroup[]; totalImpressions: number; totalClicks: number; productsTracked: number }> {
  if (!canUseLocalDb()) return { groups: [], totalImpressions: 0, totalClicks: 0, productsTracked: 0 };

  const { getDb } = await import('@/lib/db');
  const db = getDb();

  // Check if tables exist
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='ab_impressions'"
  ).get();
  if (!tableCheck) return { groups: [], totalImpressions: 0, totalClicks: 0, productsTracked: 0 };

  const rows = db.prepare(`
    SELECT
      ai.product_id,
      COALESCE(p.keyword, ai.product_id) as keyword,
      ai.variant,
      ai.copy_approach,
      COUNT(DISTINCT ai.id) as impressions,
      COUNT(DISTINCT ac.id) as clicks,
      CASE WHEN COUNT(DISTINCT ai.id) > 0
        THEN ROUND(CAST(COUNT(DISTINCT ac.id) AS REAL) / COUNT(DISTINCT ai.id) * 100, 2)
        ELSE 0
      END as ctr
    FROM ab_impressions ai
    LEFT JOIN ab_clicks ac ON ac.impression_id = ai.id
    LEFT JOIN products p ON p.id = ai.product_id
    GROUP BY ai.product_id, ai.variant
    ORDER BY impressions DESC
  `).all() as ABRow[];

  // Group by product
  const grouped = new Map<string, ProductGroup>();
  for (const row of rows) {
    if (!grouped.has(row.product_id)) {
      grouped.set(row.product_id, {
        product_id: row.product_id,
        keyword: row.keyword,
        variants: [],
        total_impressions: 0,
        total_clicks: 0,
        winner: null,
      });
    }
    const g = grouped.get(row.product_id)!;
    g.variants.push(row);
    g.total_impressions += row.impressions;
    g.total_clicks += row.clicks;
  }

  // Determine winner per product (highest CTR with >= 10 impressions)
  for (const g of grouped.values()) {
    const eligible = g.variants.filter(v => v.impressions >= 10);
    if (eligible.length >= 2) {
      eligible.sort((a, b) => b.ctr - a.ctr);
      g.winner = eligible[0].variant;
    }
  }

  const groups = Array.from(grouped.values()).sort((a, b) => b.total_impressions - a.total_impressions);
  const totalImpressions = groups.reduce((s, g) => s + g.total_impressions, 0);
  const totalClicks = groups.reduce((s, g) => s + g.total_clicks, 0);

  return { groups, totalImpressions, totalClicks, productsTracked: groups.length };
}

const CYAN = '#00FFFF';
const ORANGE = '#FF6B00';
const GREEN = '#00ff66';
const RED = '#ff3344';

const APPROACH_COLORS: Record<string, string> = {
  benefit: CYAN,
  story: '#8b5cf6',
  urgency: ORANGE,
};

export default async function ABPage() {
  const { groups, totalImpressions, totalClicks, productsTracked } = await getABData();
  const overallCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(2) : '0.00';

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontSize: '1.5rem', fontWeight: 700, color: CYAN,
          fontFamily: "'JetBrains Mono', monospace",
          textShadow: '0 0 20px #00FFFF33',
          margin: 0,
        }}>
          A/B TEST <span style={{ color: ORANGE }}>WAR ROOM</span>
        </h1>
        <p style={{
          color: '#555', fontSize: '0.7rem', margin: '6px 0 0',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          Landing page variant performance — live conversion tracking
        </p>
      </div>

      {/* Top metrics */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28,
      }}>
        {[
          { label: 'PRODUCTS TRACKED', value: String(productsTracked), color: CYAN },
          { label: 'TOTAL IMPRESSIONS', value: totalImpressions.toLocaleString(), color: CYAN },
          { label: 'TOTAL CLICKS', value: totalClicks.toLocaleString(), color: ORANGE },
          { label: 'OVERALL CTR', value: `${overallCtr}%`, color: GREEN },
        ].map(m => (
          <div key={m.label} style={{
            background: '#08080c', border: '1px solid #00FFFF18',
            borderRadius: 8, padding: '14px 16px',
          }}>
            <div style={{
              fontSize: '0.55rem', color: '#555', fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6,
            }}>{m.label}</div>
            <div style={{
              fontSize: '1.4rem', fontWeight: 700, color: m.color,
              fontFamily: "'JetBrains Mono', monospace",
              textShadow: `0 0 12px ${m.color}33`,
            }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* No data state */}
      {groups.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 60, color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          border: '1px solid #1a1a22', borderRadius: 8,
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 12, opacity: 0.3 }}>&#9650;</div>
          <div style={{ fontSize: '0.85rem' }}>No A/B test data yet</div>
          <div style={{ fontSize: '0.7rem', color: '#333', marginTop: 8 }}>
            Impressions are logged when visitors view landing pages
          </div>
        </div>
      ) : (
        /* Product cards */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {groups.map(group => {
            const maxCtr = Math.max(...group.variants.map(v => v.ctr), 1);

            return (
              <div key={group.product_id} style={{
                background: '#08080c', border: '1px solid #00FFFF18',
                borderRadius: 10, overflow: 'hidden',
              }}>
                {/* Product header */}
                <div style={{
                  padding: '14px 18px', borderBottom: '1px solid #00FFFF10',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <a href={`/dashboard/products/${group.product_id}`} style={{
                      color: '#e0e0e0', textDecoration: 'none',
                      fontSize: '0.9rem', fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {group.keyword}
                    </a>
                    <div style={{
                      fontSize: '0.6rem', color: '#444', marginTop: 2,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {group.total_impressions} impressions &middot; {group.total_clicks} clicks
                    </div>
                  </div>
                  {group.winner && (
                    <div style={{
                      background: '#00ff6618', color: GREEN,
                      padding: '4px 10px', borderRadius: 4,
                      fontSize: '0.6rem', fontWeight: 600,
                      fontFamily: "'JetBrains Mono', monospace",
                      border: '1px solid #00ff6633',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      Winner: Variant {group.winner}
                    </div>
                  )}
                </div>

                {/* Variant rows */}
                <div style={{ padding: '12px 18px' }}>
                  {/* Header row */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '80px 120px 1fr 90px 70px 70px',
                    gap: 8, marginBottom: 8,
                    fontSize: '0.55rem', color: '#444',
                    fontFamily: "'JetBrains Mono', monospace",
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                  }}>
                    <div>Variant</div>
                    <div>Approach</div>
                    <div>CTR Bar</div>
                    <div style={{ textAlign: 'right' }}>Impressions</div>
                    <div style={{ textAlign: 'right' }}>Clicks</div>
                    <div style={{ textAlign: 'right' }}>CTR %</div>
                  </div>

                  {group.variants.map(v => {
                    const isWinner = group.winner === v.variant;
                    const barPct = maxCtr > 0 ? (v.ctr / maxCtr) * 100 : 0;
                    const approachColor = APPROACH_COLORS[v.copy_approach || ''] || '#555';

                    return (
                      <div key={v.variant} style={{
                        display: 'grid', gridTemplateColumns: '80px 120px 1fr 90px 70px 70px',
                        gap: 8, alignItems: 'center',
                        padding: '8px 0',
                        borderTop: '1px solid #0a0a12',
                      }}>
                        {/* Variant ID */}
                        <div style={{
                          fontSize: '0.8rem', fontWeight: 700,
                          fontFamily: "'JetBrains Mono', monospace",
                          color: isWinner ? GREEN : '#888',
                        }}>
                          {v.variant}
                          {isWinner && <span style={{
                            fontSize: '0.55rem', marginLeft: 4, color: GREEN,
                          }}> &#9733;</span>}
                        </div>

                        {/* Copy approach badge */}
                        <div>
                          <span style={{
                            background: `${approachColor}18`,
                            color: approachColor,
                            padding: '2px 8px', borderRadius: 3,
                            fontSize: '0.6rem', fontWeight: 600,
                            fontFamily: "'JetBrains Mono', monospace",
                            border: `1px solid ${approachColor}33`,
                          }}>
                            {v.copy_approach || 'unknown'}
                          </span>
                        </div>

                        {/* CTR bar */}
                        <div style={{
                          height: 18, background: '#0a0a14',
                          borderRadius: 3, overflow: 'hidden', position: 'relative',
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${barPct}%`,
                            background: isWinner
                              ? `linear-gradient(90deg, ${GREEN}44, ${GREEN}88)`
                              : `linear-gradient(90deg, ${CYAN}22, ${CYAN}55)`,
                            borderRadius: 3,
                            transition: 'width 0.5s',
                          }} />
                        </div>

                        {/* Numbers */}
                        <div style={{
                          textAlign: 'right', fontSize: '0.8rem', color: '#888',
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {v.impressions.toLocaleString()}
                        </div>
                        <div style={{
                          textAlign: 'right', fontSize: '0.8rem', color: ORANGE,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {v.clicks.toLocaleString()}
                        </div>
                        <div style={{
                          textAlign: 'right', fontSize: '0.85rem', fontWeight: 700,
                          fontFamily: "'JetBrains Mono', monospace",
                          color: isWinner ? GREEN : (v.ctr > 0 ? CYAN : '#444'),
                          textShadow: isWinner ? `0 0 8px ${GREEN}44` : 'none',
                        }}>
                          {v.ctr.toFixed(2)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{
        marginTop: 28, padding: '14px 18px',
        border: '1px solid #1a1a22', borderRadius: 8,
        fontSize: '0.6rem', color: '#444',
        fontFamily: "'JetBrains Mono', monospace",
        display: 'flex', gap: 20, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: `${CYAN}55`, display: 'inline-block' }} />
          benefit
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#8b5cf655', display: 'inline-block' }} />
          story
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: `${ORANGE}55`, display: 'inline-block' }} />
          urgency
        </div>
        <div style={{ marginLeft: 'auto', color: '#333' }}>
          Winner declared at &ge;10 impressions per variant &middot; IPs are SHA-256 hashed (never stored raw)
        </div>
      </div>
    </div>
  );
}
