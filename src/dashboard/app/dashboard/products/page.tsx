import { getDb } from '@/lib/db';
import Link from 'next/link';

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

const OUTCOME_COLORS: Record<string, string> = {
  win: '#00ff66',
  loss: '#ff3344',
  breakeven: '#ffaa00',
};

export default function ProductsPage() {
  const db = getDb();

  const products = db.prepare(`
    SELECT id, keyword, category, stage, score, decision, outcome_label, created_at
    FROM products ORDER BY score DESC NULLS LAST, created_at DESC
  `).all() as Array<{
    id: string;
    keyword: string;
    category: string;
    stage: string;
    score: number | null;
    decision: string | null;
    outcome_label: string | null;
    created_at: string;
  }>;

  const total = products.length;

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

      {/* Data Table */}
      <div style={{
        background: '#111118',
        border: '1px solid #1a1a24',
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
            <tr style={{ background: '#0d0d14', borderBottom: '1px solid #1a1a24' }}>
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
              const scoreColor = scoreVal >= 80 ? '#00ff66' : scoreVal >= 60 ? '#ffaa00' : '#666';
              const stageColor = STAGE_COLORS[p.stage] || '#333';
              const outcomeColor = p.outcome_label ? (OUTCOME_COLORS[p.outcome_label] || '#666') : '#333';

              return (
                <tr key={p.id} style={{ borderBottom: '1px solid #1a1a2444' }}>
                  <td style={{ padding: '8px 14px' }}>
                    <Link
                      href={`/dashboard/products/${p.id}`}
                      style={{
                        color: '#00f0ff',
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
                      textShadow: scoreVal >= 80 ? '0 0 8px #00ff6644' : 'none',
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
                  No products discovered yet. Pipeline awaiting activation...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
