import { canUseLocalDb, fetchOrchestrator } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function PnLPage() {
  let revenue = 0;
  let adSpend = 0;
  let profit = 0;
  let orders = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let perProduct: Array<{
    id: string;
    keyword: string;
    total_revenue: number;
    total_ad_spend: number;
    profit: number;
    roas: number | null;
    outcome_label: string | null;
  }> = [];

  if (canUseLocalDb()) {
    const { getDb } = await import('@/lib/db');
    const db = getDb();

    // Aggregates
    const agg = db.prepare(`
      SELECT COALESCE(SUM(total_revenue),0) as rev, COALESCE(SUM(total_ad_spend),0) as spend,
             COALESCE(SUM(total_revenue - total_ad_spend),0) as profit,
             COALESCE(SUM(total_orders),0) as orders
      FROM products
    `).get() as { rev: number; spend: number; profit: number; orders: number };

    revenue = agg.rev;
    adSpend = agg.spend;
    profit = agg.profit;
    orders = agg.orders;

    // Win/loss counts
    const outcomeCounts = db.prepare(
      "SELECT outcome_label, COUNT(*) as cnt FROM products WHERE outcome_label IS NOT NULL GROUP BY outcome_label"
    ).all() as Array<{ outcome_label: string; cnt: number }>;

    const outcomeMap: Record<string, number> = {};
    for (const o of outcomeCounts) {
      outcomeMap[o.outcome_label] = o.cnt;
    }
    wins = outcomeMap['win'] || 0;
    losses = outcomeMap['loss'] || 0;
    breakevens = outcomeMap['breakeven'] || 0;

    // Per-product P&L
    perProduct = db.prepare(`
      SELECT id, keyword, total_revenue, total_ad_spend, (total_revenue - total_ad_spend) as profit,
             CASE WHEN total_ad_spend > 0 THEN total_revenue / total_ad_spend ELSE NULL END as roas,
             outcome_label
      FROM products WHERE total_revenue > 0 OR total_ad_spend > 0 ORDER BY total_revenue DESC
    `).all() as typeof perProduct;
  } else {
    const data = await fetchOrchestrator<{
      perProduct: typeof perProduct;
      aggregate: { revenue: number; adSpend: number; profit: number; orders: number; wins: number; losses: number; breakevens: number };
      daily: unknown;
    }>('/api/pnl');

    if (data.aggregate) {
      revenue = data.aggregate.revenue || 0;
      adSpend = data.aggregate.adSpend || 0;
      profit = data.aggregate.profit || 0;
      orders = data.aggregate.orders || 0;
      wins = data.aggregate.wins || 0;
      losses = data.aggregate.losses || 0;
      breakevens = data.aggregate.breakevens || 0;
    }
    perProduct = data.perProduct || [];
  }

  const roas = adSpend > 0 ? revenue / adSpend : 0;
  const totalLabeled = wins + losses + breakevens;
  const winRate = totalLabeled > 0 ? ((wins / totalLabeled) * 100).toFixed(0) : '0';
  const hasFinancialData = revenue > 0 || adSpend > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontSize: '1.4rem',
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          color: '#e0e0e0',
          margin: 0,
        }}>
          PROFIT &amp; LOSS
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          Financial warfare analytics &amp; performance tracking
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 12,
        marginBottom: 28,
      }}>
        <MetricCardInline label="Total Revenue" value={`$${revenue.toFixed(2)}`} color="#00ff66" icon="$" />
        <MetricCardInline label="Total Ad Spend" value={`$${adSpend.toFixed(2)}`} color="#ff3344" icon="$" />
        <MetricCardInline label="Net Profit" value={`$${profit.toFixed(2)}`} color={profit >= 0 ? '#00ff66' : '#ff3344'} icon={profit >= 0 ? '\u2191' : '\u2193'} />
        <MetricCardInline label="Overall ROAS" value={`${roas.toFixed(2)}x`} color={roas >= 2 ? '#00ff66' : '#ffaa00'} />
        <MetricCardInline label="Win Rate" value={`${winRate}%`} color="#8b5cf6" />
      </div>

      {/* No data message */}
      {!hasFinancialData && (
        <div style={{
          background: '#08080c',
          border: '1px solid #1a1a22',
          borderRadius: 8,
          padding: '24px 20px',
          textAlign: 'center',
          color: '#555',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.78rem',
          marginBottom: 28,
        }}>
          No revenue data yet -- approve products and tag outcomes to see financial metrics.
        </div>
      )}

      {/* Win/Loss Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        marginBottom: 28,
      }}>
        {[
          { label: 'WINS', count: wins, color: '#00ff66' },
          { label: 'LOSSES', count: losses, color: '#ff3344' },
          { label: 'BREAKEVEN', count: breakevens, color: '#ffaa00' },
        ].map(item => (
          <div key={item.label} style={{
            background: '#08080c',
            border: `1px solid ${item.color}33`,
            borderRadius: 8,
            padding: '20px 16px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, height: 2,
              background: `linear-gradient(90deg, transparent, ${item.color}, transparent)`,
              opacity: 0.5,
            }} />
            <div style={{
              fontSize: '2rem',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              color: item.color,
              textShadow: `0 0 20px ${item.color}33`,
            }}>
              {item.count}
            </div>
            <div style={{
              fontSize: '0.65rem',
              color: '#666',
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginTop: 4,
            }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* Per-Product P&L Table */}
      {perProduct.length > 0 && (
        <div>
          <SectionLabel>Product Performance</SectionLabel>
          <div style={{
            background: '#08080c',
            border: '1px solid #1a1a22',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
            }}>
              <thead>
                <tr style={{ background: '#060608', borderBottom: '1px solid #1a1a22' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Product</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Revenue</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Ad Spend</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Profit</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>ROAS</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {perProduct.map(p => {
                  const profitVal = p.profit || 0;
                  const outcomeColors: Record<string, string> = { win: '#00ff66', loss: '#ff3344', breakeven: '#ffaa00' };
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #1a1a2244' }}>
                      <td style={{ padding: '8px 14px', color: '#00FFFF', fontWeight: 600 }}>
                        {p.keyword}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', color: '#00ff66', fontWeight: 600 }}>
                        ${(p.total_revenue || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', color: '#ff3344' }}>
                        ${(p.total_ad_spend || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: profitVal >= 0 ? '#00ff66' : '#ff3344' }}>
                        ${profitVal.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: (p.roas || 0) >= 2 ? '#00ff66' : (p.roas || 0) >= 1 ? '#ffaa00' : '#ff3344' }}>
                        {p.roas != null ? `${p.roas.toFixed(1)}x` : '-'}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                        <span style={{
                          color: p.outcome_label ? (outcomeColors[p.outcome_label] || '#666') : '#333',
                          fontWeight: 600,
                          fontSize: '0.7rem',
                          textTransform: 'uppercase',
                        }}>
                          {p.outcome_label || '--'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCardInline({ label, value, color, icon }: {
  label: string;
  value: string;
  color: string;
  icon?: string;
}) {
  return (
    <div style={{
      background: '#08080c',
      border: '1px solid #1a1a22',
      borderRadius: 8,
      padding: '16px 20px',
      minWidth: 0,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        opacity: 0.6,
      }} />
      <div style={{
        position: 'absolute',
        top: -20, right: -20,
        width: 80, height: 80,
        borderRadius: '50%',
        background: color,
        opacity: 0.03,
        filter: 'blur(20px)',
        pointerEvents: 'none',
      }} />
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: '0.7rem',
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {label}
        </span>
        {icon && (
          <span style={{ fontSize: '1rem', opacity: 0.6 }}>
            {icon}
          </span>
        )}
      </div>
      <div style={{
        fontSize: '1.6rem',
        fontWeight: 700,
        color,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 1.2,
        textShadow: `0 0 20px ${color}44`,
      }}>
        {value}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.7rem',
      fontWeight: 600,
      color: '#555',
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}
