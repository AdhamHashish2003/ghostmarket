import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function PnLPage() {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      SUM(total_revenue) as revenue,
      SUM(total_ad_spend) as ad_spend,
      SUM(total_orders) as orders,
      COUNT(CASE WHEN outcome_label = 'win' THEN 1 END) as wins,
      COUNT(CASE WHEN outcome_label = 'loss' THEN 1 END) as losses,
      COUNT(CASE WHEN outcome_label = 'breakeven' THEN 1 END) as breakevens,
      COUNT(CASE WHEN outcome_label IS NOT NULL THEN 1 END) as total_labeled
    FROM products
  `).get() as Record<string, number>;

  const revenue = totals.revenue || 0;
  const adSpend = totals.ad_spend || 0;
  const profit = revenue - adSpend;
  const overallRoas = adSpend > 0 ? revenue / adSpend : 0;

  const products = db.prepare(`
    SELECT keyword, category, score, total_revenue, total_ad_spend, total_orders, roas, outcome_label
    FROM products WHERE outcome_label IS NOT NULL
    ORDER BY total_revenue DESC
  `).all() as Array<{
    keyword: string; category: string; score: number;
    total_revenue: number; total_ad_spend: number; total_orders: number;
    roas: number; outcome_label: string;
  }>;

  const byCategory = db.prepare(`
    SELECT category,
           COUNT(*) as products,
           SUM(total_revenue) as revenue,
           SUM(total_ad_spend) as ad_spend,
           COUNT(CASE WHEN outcome_label = 'win' THEN 1 END) as wins
    FROM products WHERE outcome_label IS NOT NULL AND category IS NOT NULL
    GROUP BY category ORDER BY revenue DESC
  `).all() as Array<{ category: string; products: number; revenue: number; ad_spend: number; wins: number }>;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>Profit & Loss</h1>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 32 }}>
        <MetricCard label="Total Revenue" value={`$${revenue.toFixed(2)}`} color="#22c55e" />
        <MetricCard label="Total Ad Spend" value={`$${adSpend.toFixed(2)}`} color="#ef4444" />
        <MetricCard label="Profit" value={`$${profit.toFixed(2)}`} color={profit >= 0 ? '#22c55e' : '#ef4444'} />
        <MetricCard label="ROAS" value={overallRoas.toFixed(2) + 'x'} color={overallRoas >= 2 ? '#22c55e' : '#f59e0b'} />
        <MetricCard label="Win Rate" value={`${totals.total_labeled > 0 ? ((totals.wins / totals.total_labeled) * 100).toFixed(0) : 0}%`} color="#8b5cf6" />
      </div>

      {/* Win/Loss Distribution */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        <div style={{ background: '#1a1a22', padding: 16, borderRadius: 8, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '2rem' }}>✅ {totals.wins || 0}</div>
          <div style={{ color: '#888' }}>Wins</div>
        </div>
        <div style={{ background: '#1a1a22', padding: 16, borderRadius: 8, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '2rem' }}>❌ {totals.losses || 0}</div>
          <div style={{ color: '#888' }}>Losses</div>
        </div>
        <div style={{ background: '#1a1a22', padding: 16, borderRadius: 8, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '2rem' }}>➖ {totals.breakevens || 0}</div>
          <div style={{ color: '#888' }}>Breakeven</div>
        </div>
      </div>

      {/* By Category */}
      {byCategory.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>By Category</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 32 }}>
            {byCategory.map(c => (
              <div key={c.category} style={{ background: '#1a1a22', padding: 16, borderRadius: 8 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{c.category}</div>
                <div style={{ fontSize: '0.85rem', color: '#888' }}>
                  {c.products} products · {c.wins} wins<br />
                  Rev: ${(c.revenue || 0).toFixed(0)} · Spend: ${(c.ad_spend || 0).toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Product P&L table */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Product Performance</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>Product</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Score</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Revenue</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Ad Spend</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Profit</th>
            <th style={{ textAlign: 'center', padding: 8 }}>ROAS</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Orders</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const pProfit = (p.total_revenue || 0) - (p.total_ad_spend || 0);
            return (
              <tr key={i} style={{ borderBottom: '1px solid #1a1a22' }}>
                <td style={{ padding: 8 }}>{p.keyword}</td>
                <td style={{ textAlign: 'center', padding: 8 }}>{p.score?.toFixed(0) || '-'}</td>
                <td style={{ textAlign: 'right', padding: 8, color: '#22c55e' }}>${(p.total_revenue || 0).toFixed(2)}</td>
                <td style={{ textAlign: 'right', padding: 8, color: '#ef4444' }}>${(p.total_ad_spend || 0).toFixed(2)}</td>
                <td style={{ textAlign: 'right', padding: 8, color: pProfit >= 0 ? '#22c55e' : '#ef4444' }}>${pProfit.toFixed(2)}</td>
                <td style={{ textAlign: 'center', padding: 8 }}>{p.roas?.toFixed(1) || '-'}x</td>
                <td style={{ textAlign: 'center', padding: 8 }}>{p.total_orders || 0}</td>
                <td style={{ textAlign: 'center', padding: 8 }}>
                  {p.outcome_label === 'win' ? '✅' : p.outcome_label === 'loss' ? '❌' : '➖'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#1a1a22', padding: 16, borderRadius: 8, textAlign: 'center' }}>
      <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: '#888' }}>{label}</div>
    </div>
  );
}
