import Link from 'next/link';
import { canUseLocalDb, fetchOrchestrator } from '@/lib/data';

export const dynamic = 'force-dynamic';

const STAGE_COLORS: Record<string, string> = {
  discovered: '#00FFFF',
  scored: '#FF6B00',
  approved: '#00ff66',
  building: '#ffaa00',
  live: '#00ff66',
  tracking: '#00FFFF',
  completed: '#8b5cf6',
  skipped: '#666',
  killed: '#ff3344',
};

const OUTCOME_COLORS: Record<string, string> = {
  win: '#00ff66',
  loss: '#ff3344',
  breakeven: '#ffaa00',
};

const ALL_STAGES = ['discovered', 'scored', 'approved', 'building', 'live', 'tracking', 'completed', 'skipped', 'killed'];

const SORT_OPTIONS = [
  { key: 'score', label: 'Score' },
  { key: 'created_at', label: 'Newest' },
  { key: 'keyword', label: 'Keyword' },
];

interface PageProps {
  searchParams: Promise<{ stage?: string; sort?: string }>;
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const activeStage = params.stage || '';
  const activeSort = params.sort || 'score';

  type ProductRow = {
    id: string; keyword: string; category: string; stage: string;
    score: number | null; decision: string | null; outcome_label: string | null; created_at: string;
  };

  let products: ProductRow[] = [];
  if (canUseLocalDb()) {
    const { getDb } = await import('@/lib/db');
    const db = getDb();
    const whereClause = activeStage ? `WHERE stage = '${activeStage.replace(/'/g, "''")}'` : '';
    const orderClause = activeSort === 'keyword' ? 'ORDER BY keyword ASC' : activeSort === 'created_at' ? 'ORDER BY created_at DESC' : 'ORDER BY score DESC NULLS LAST, created_at DESC';
    products = db.prepare(`SELECT id, keyword, category, stage, score, decision, outcome_label, created_at FROM products ${whereClause} ${orderClause}`).all() as ProductRow[];
  } else {
    const qs = new URLSearchParams();
    if (activeStage) qs.set('stage', activeStage);
    qs.set('sort', activeSort === 'keyword' ? 'keyword' : activeSort === 'created_at' ? 'created_at' : 'score');
    qs.set('limit', '100');
    const data = await fetchOrchestrator<{ products: ProductRow[] }>(`/api/products?${qs}`);
    products = data.products || [];
  }

  const total = products.length;

  // Build query string helper
  function buildHref(overrides: Record<string, string>): string {
    const p: Record<string, string> = {};
    if (activeStage) p.stage = activeStage;
    if (activeSort && activeSort !== 'score') p.sort = activeSort;
    Object.assign(p, overrides);
    // Remove empty values
    for (const k of Object.keys(p)) {
      if (!p[k]) delete p[k];
    }
    const qs = new URLSearchParams(p).toString();
    return `/dashboard/products${qs ? `?${qs}` : ''}`;
  }

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
          {total} products{activeStage ? ` in "${activeStage}"` : ' in pipeline'}
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <Link
          href={buildHref({ stage: '' })}
          style={{
            background: !activeStage ? '#00FFFF22' : '#08080c',
            border: `1px solid ${!activeStage ? '#00FFFF66' : '#1a1a22'}`,
            borderRadius: 6,
            padding: '5px 12px',
            color: !activeStage ? '#00FFFF' : '#666',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.65rem',
            fontWeight: 600,
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}
        >
          All Stages
        </Link>
        {ALL_STAGES.map(stage => (
          <Link
            key={stage}
            href={buildHref({ stage })}
            style={{
              background: activeStage === stage ? `${STAGE_COLORS[stage] || '#333'}22` : '#08080c',
              border: `1px solid ${activeStage === stage ? `${STAGE_COLORS[stage] || '#333'}66` : '#1a1a22'}`,
              borderRadius: 6,
              padding: '5px 12px',
              color: activeStage === stage ? (STAGE_COLORS[stage] || '#666') : '#555',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.65rem',
              fontWeight: 600,
              textDecoration: 'none',
              textTransform: 'uppercase',
            }}
          >
            {stage}
          </Link>
        ))}
      </div>

      {/* Sort Buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <span style={{ color: '#444', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', alignSelf: 'center', marginRight: 4 }}>Sort:</span>
        {SORT_OPTIONS.map(opt => (
          <Link
            key={opt.key}
            href={buildHref({ sort: opt.key === 'score' ? '' : opt.key })}
            style={{
              background: activeSort === opt.key ? '#FF6B0022' : '#08080c',
              border: `1px solid ${activeSort === opt.key ? '#FF6B0066' : '#1a1a22'}`,
              borderRadius: 6,
              padding: '4px 10px',
              color: activeSort === opt.key ? '#FF6B00' : '#555',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.65rem',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {/* Data Table */}
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
              <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Keyword</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Score</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stage</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Category</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Decision</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Outcome</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const scoreVal = p.score ?? 0;
              const scoreColor = scoreVal >= 70 ? '#00ff66' : scoreVal >= 40 ? '#FF6B00' : scoreVal > 0 ? '#ff3344' : '#333';
              const stageColor = STAGE_COLORS[p.stage] || '#333';
              const outcomeColor = p.outcome_label ? (OUTCOME_COLORS[p.outcome_label] || '#666') : '#333';

              return (
                <tr key={p.id} style={{ borderBottom: '1px solid #1a1a2244' }}>
                  <td style={{ padding: '8px 14px' }}>
                    <Link
                      href={`/dashboard/products/${p.id}`}
                      style={{
                        color: '#00FFFF',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      {p.keyword}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                    <span style={{
                      fontWeight: 700,
                      color: scoreColor,
                      textShadow: scoreVal >= 70 ? '0 0 8px #00ff6644' : 'none',
                    }}>
                      {p.score != null ? Math.round(p.score) : '--'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                    <span style={{
                      background: `${stageColor}22`,
                      color: stageColor,
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: '0.7rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      border: `1px solid ${stageColor}44`,
                    }}>
                      {p.stage}
                    </span>
                  </td>
                  <td style={{ padding: '8px 14px', color: '#888' }}>
                    {p.category || '-'}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'center', color: '#888' }}>
                    {p.decision || '--'}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                    {p.outcome_label ? (
                      <span style={{
                        color: outcomeColor,
                        fontWeight: 600,
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                      }}>
                        {p.outcome_label}
                      </span>
                    ) : (
                      <span style={{ color: '#333' }}>--</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', color: '#555', fontSize: '0.7rem' }}>
                    {p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}
                  </td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={7} style={{
                  padding: 40,
                  textAlign: 'center',
                  color: '#333',
                  fontSize: '0.75rem',
                }}>
                  No products{activeStage ? ` in "${activeStage}" stage` : ' discovered yet'}. Pipeline awaiting activation...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
