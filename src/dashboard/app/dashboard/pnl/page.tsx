'use client';

import { useState, useEffect } from 'react';
import MetricCard from '@/components/MetricCard';
import NeonChart from '@/components/NeonChart';
import DataTable from '@/components/DataTable';

interface PnLData {
  revenue: number;
  adSpend: number;
  profit: number;
  orders: number;
  wins: number;
  losses: number;
  breakevens: number;
  totalLabeled: number;
  roas: number;
  products: Array<{
    keyword: string;
    category: string;
    score: number;
    total_revenue: number;
    total_ad_spend: number;
    total_orders: number;
    roas: number;
    outcome_label: string;
  }>;
}

export default function PnLPage() {
  const [data, setData] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/pnl');
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch { /* silently fail */ }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{
          color: '#ffaa00',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.8rem',
        }}>
          Loading financial warfare data...
        </div>
      </div>
    );
  }

  const revenue = data?.revenue || 0;
  const adSpend = data?.adSpend || 0;
  const profit = data?.profit || (revenue - adSpend);
  const roas = data?.roas || (adSpend > 0 ? revenue / adSpend : 0);
  const wins = data?.wins || 0;
  const losses = data?.losses || 0;
  const breakevens = data?.breakevens || 0;
  const totalLabeled = data?.totalLabeled || 0;
  const winRate = totalLabeled > 0 ? ((wins / totalLabeled) * 100).toFixed(0) : '0';
  const products = data?.products || [];

  // ROAS distribution chart
  const roasProducts = products.filter(p => p.roas != null && p.roas > 0);
  const roasChartData = {
    labels: roasProducts.map(p => p.keyword.slice(0, 15)),
    datasets: [{
      label: 'ROAS',
      data: roasProducts.map(p => p.roas),
      backgroundColor: roasProducts.map(p =>
        p.roas >= 3 ? '#00ff6688' : p.roas >= 1.5 ? '#ffaa0088' : '#ff334488'
      ),
      borderColor: roasProducts.map(p =>
        p.roas >= 3 ? '#00ff66' : p.roas >= 1.5 ? '#ffaa00' : '#ff3344'
      ),
    }],
  };

  // Top/Worst performers
  const sorted = [...products].sort((a, b) => (b.total_revenue - b.total_ad_spend) - (a.total_revenue - a.total_ad_spend));
  const topPerformers = sorted.slice(0, 5);
  const worstPerformers = sorted.slice(-5).reverse();

  const tableColumns = [
    {
      key: 'keyword',
      label: 'Product',
      render: (val: string) => (
        <span style={{ color: '#00f0ff', fontWeight: 600 }}>{val}</span>
      ),
    },
    {
      key: 'score',
      label: 'Score',
      align: 'center' as const,
      render: (val: number) => (
        <span style={{ color: (val || 0) >= 80 ? '#00ff66' : '#888' }}>{val?.toFixed(0) || '-'}</span>
      ),
    },
    {
      key: 'total_revenue',
      label: 'Revenue',
      align: 'right' as const,
      render: (val: number) => (
        <span style={{ color: '#00ff66', fontWeight: 600 }}>${(val || 0).toFixed(2)}</span>
      ),
    },
    {
      key: 'total_ad_spend',
      label: 'Ad Spend',
      align: 'right' as const,
      render: (val: number) => (
        <span style={{ color: '#ff3344' }}>${(val || 0).toFixed(2)}</span>
      ),
    },
    {
      key: 'profit',
      label: 'Profit',
      align: 'right' as const,
      render: (_: unknown, row: Record<string, unknown>) => {
        const p = (Number(row.total_revenue) || 0) - (Number(row.total_ad_spend) || 0);
        return (
          <span style={{ color: p >= 0 ? '#00ff66' : '#ff3344', fontWeight: 700 }}>
            ${p.toFixed(2)}
          </span>
        );
      },
    },
    {
      key: 'roas',
      label: 'ROAS',
      align: 'center' as const,
      render: (val: number) => (
        <span style={{
          color: (val || 0) >= 2 ? '#00ff66' : (val || 0) >= 1 ? '#ffaa00' : '#ff3344',
        }}>
          {val?.toFixed(1) || '-'}x
        </span>
      ),
    },
    {
      key: 'total_orders',
      label: 'Orders',
      align: 'center' as const,
    },
    {
      key: 'outcome_label',
      label: 'Outcome',
      align: 'center' as const,
      render: (val: string) => {
        const colors: Record<string, string> = { win: '#00ff66', loss: '#ff3344', breakeven: '#ffaa00' };
        return (
          <span style={{
            color: colors[val] || '#666',
            fontWeight: 600,
            fontSize: '0.7rem',
            textTransform: 'uppercase',
          }}>
            {val || '--'}
          </span>
        );
      },
    },
  ];

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
          Financial warfare analytics & performance tracking
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 12,
        marginBottom: 28,
      }}>
        <MetricCard label="Total Revenue" value={`$${revenue.toFixed(2)}`} color="#00ff66" icon="$" />
        <MetricCard label="Total Ad Spend" value={`$${adSpend.toFixed(2)}`} color="#ff3344" icon="$" />
        <MetricCard label="Net Profit" value={`$${profit.toFixed(2)}`} color={profit >= 0 ? '#00ff66' : '#ff3344'} icon={profit >= 0 ? '\u2191' : '\u2193'} />
        <MetricCard label="Overall ROAS" value={`${roas.toFixed(2)}x`} color={roas >= 2 ? '#00ff66' : '#ffaa00'} />
        <MetricCard label="Win Rate" value={`${winRate}%`} color="#8b5cf6" />
      </div>

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
            background: '#111118',
            border: `1px solid ${item.color}33`,
            borderRadius: 8,
            padding: '20px 16px',
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

      {/* ROAS Distribution */}
      {roasChartData.labels.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionLabel>ROAS Distribution</SectionLabel>
          <NeonChart type="bar" data={roasChartData} />
        </div>
      )}

      {/* Top / Worst Performers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        <div>
          <SectionLabel>Top Performers</SectionLabel>
          <div style={{ display: 'grid', gap: 6 }}>
            {topPerformers.map((p, i) => {
              const pProfit = (p.total_revenue || 0) - (p.total_ad_spend || 0);
              return (
                <div key={i} style={{
                  background: '#111118',
                  border: '1px solid #1a1a24',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.78rem',
                    color: '#e0e0e0',
                  }}>
                    {p.keyword}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#00ff66',
                  }}>
                    +${pProfit.toFixed(2)}
                  </span>
                </div>
              );
            })}
            {topPerformers.length === 0 && <EmptyState>No data yet</EmptyState>}
          </div>
        </div>
        <div>
          <SectionLabel>Worst Performers</SectionLabel>
          <div style={{ display: 'grid', gap: 6 }}>
            {worstPerformers.map((p, i) => {
              const pProfit = (p.total_revenue || 0) - (p.total_ad_spend || 0);
              return (
                <div key={i} style={{
                  background: '#111118',
                  border: '1px solid #1a1a24',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.78rem',
                    color: '#e0e0e0',
                  }}>
                    {p.keyword}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#ff3344',
                  }}>
                    ${pProfit.toFixed(2)}
                  </span>
                </div>
              );
            })}
            {worstPerformers.length === 0 && <EmptyState>No data yet</EmptyState>}
          </div>
        </div>
      </div>

      {/* Full Product P&L Table */}
      <div>
        <SectionLabel>Product Performance</SectionLabel>
        <DataTable columns={tableColumns} data={products} sortable />
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: '#111118',
      border: '1px solid #1a1a24',
      borderRadius: 8,
      padding: '20px',
      textAlign: 'center',
      color: '#333',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '0.75rem',
    }}>
      {children}
    </div>
  );
}
