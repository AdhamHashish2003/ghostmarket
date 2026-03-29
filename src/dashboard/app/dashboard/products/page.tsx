'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';

const STAGES = ['', 'discovered', 'scored', 'approved', 'building', 'live', 'tracking', 'completed', 'skipped', 'killed'];

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

interface Product {
  id: string;
  keyword: string;
  score: number;
  stage: string;
  category: string;
  source: string;
  created_at: string;
  outcome_label: string;
  margin_pct: number;
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('score');

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        sort,
        ...(stage && { stage }),
        ...(search && { search }),
      });
      const res = await fetch(`/api/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || data.rows || []);
        setTotal(data.total || 0);
      }
    } catch { /* silently fail */ }
    setLoading(false);
  }, [page, stage, search, sort]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const columns = [
    {
      key: 'keyword',
      label: 'Keyword',
      render: (val: string) => (
        <span style={{ color: '#00f0ff', fontWeight: 600 }}>{val}</span>
      ),
    },
    {
      key: 'score',
      label: 'Score',
      align: 'center' as const,
      render: (val: number) => (
        <span style={{
          fontWeight: 700,
          color: (val || 0) >= 80 ? '#00ff66' : (val || 0) >= 60 ? '#ffaa00' : '#666',
          textShadow: (val || 0) >= 80 ? '0 0 8px #00ff6644' : 'none',
        }}>
          {val?.toFixed(0) || '--'}
        </span>
      ),
    },
    {
      key: 'stage',
      label: 'Stage',
      align: 'center' as const,
      render: (val: string) => (
        <span style={{
          background: `${STAGE_COLORS[val] || '#333'}22`,
          color: STAGE_COLORS[val] || '#666',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: '0.7rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
          textTransform: 'uppercase',
          border: `1px solid ${STAGE_COLORS[val] || '#333'}44`,
        }}>
          {val}
        </span>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (val: string) => (
        <span style={{ color: '#888' }}>{val || '-'}</span>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      render: (val: string) => (
        <span style={{ color: '#666' }}>{val || '-'}</span>
      ),
    },
    {
      key: 'outcome_label',
      label: 'Outcome',
      align: 'center' as const,
      render: (val: string) => {
        if (!val) return <span style={{ color: '#333' }}>--</span>;
        const colors: Record<string, string> = { win: '#00ff66', loss: '#ff3344', breakeven: '#ffaa00' };
        return (
          <span style={{
            color: colors[val] || '#666',
            fontWeight: 600,
            fontSize: '0.7rem',
            textTransform: 'uppercase',
          }}>
            {val}
          </span>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Created',
      align: 'right' as const,
      render: (val: string) => (
        <span style={{ color: '#555', fontSize: '0.7rem' }}>
          {val ? new Date(val).toLocaleDateString() : '-'}
        </span>
      ),
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
          letterSpacing: '0.03em',
        }}>
          PRODUCTS
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          {total} products in pipeline
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 20,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        {/* Stage Dropdown */}
        <select
          value={stage}
          onChange={(e) => { setStage(e.target.value); setPage(1); }}
          style={{
            background: '#111118',
            color: '#e0e0e0',
            border: '1px solid #1a1a24',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: '0.8rem',
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">All Stages</option>
          {STAGES.filter(Boolean).map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          style={{
            background: '#111118',
            color: '#e0e0e0',
            border: '1px solid #1a1a24',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: '0.8rem',
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="score">Sort: Score</option>
          <option value="created_at">Sort: Newest</option>
          <option value="keyword">Sort: Keyword</option>
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search keywords..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{
            background: '#111118',
            color: '#e0e0e0',
            border: '1px solid #1a1a24',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: '0.8rem',
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none',
            flex: 1,
            minWidth: 200,
          }}
        />
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{
          textAlign: 'center',
          padding: 40,
          color: '#333',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.8rem',
        }}>
          <div style={{ color: '#00f0ff', marginBottom: 8 }}>Scanning neural network...</div>
          <div style={{
            width: 40,
            height: 2,
            background: 'linear-gradient(90deg, transparent, #00f0ff, transparent)',
            margin: '0 auto',
            animation: 'pulse 1.5s infinite',
          }} />
        </div>
      )}

      {/* Data Table */}
      {!loading && (
        <DataTable
          columns={columns}
          data={products}
          sortable
          onRowClick={(row) => router.push(`/dashboard/products/${row.id}`)}
        />
      )}

      {/* Pagination */}
      {!loading && total > 50 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 8,
          marginTop: 20,
        }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{
              background: '#111118',
              color: page <= 1 ? '#333' : '#00f0ff',
              border: '1px solid #1a1a24',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: '0.75rem',
              fontFamily: "'JetBrains Mono', monospace",
              cursor: page <= 1 ? 'default' : 'pointer',
            }}
          >
            PREV
          </button>
          <span style={{
            padding: '6px 14px',
            fontSize: '0.75rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: '#666',
          }}>
            Page {page} of {Math.ceil(total / 50)}
          </span>
          <button
            disabled={page >= Math.ceil(total / 50)}
            onClick={() => setPage(p => p + 1)}
            style={{
              background: '#111118',
              color: page >= Math.ceil(total / 50) ? '#333' : '#00f0ff',
              border: '1px solid #1a1a24',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: '0.75rem',
              fontFamily: "'JetBrains Mono', monospace",
              cursor: page >= Math.ceil(total / 50) ? 'default' : 'pointer',
            }}
          >
            NEXT
          </button>
        </div>
      )}
    </div>
  );
}
