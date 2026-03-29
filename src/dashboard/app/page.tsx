import { getDb } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STAGE_ORDER = ['discovered', 'scored', 'approved', 'building', 'live', 'tracking', 'completed', 'skipped', 'killed'];
const STAGE_COLORS: Record<string, string> = {
  discovered: '#3b82f6',
  scored: '#8b5cf6',
  approved: '#22c55e',
  building: '#f59e0b',
  live: '#10b981',
  tracking: '#06b6d4',
  completed: '#6366f1',
  skipped: '#6b7280',
  killed: '#ef4444',
};

export default function PipelinePage() {
  const db = getDb();

  const stageCounts = db.prepare(
    'SELECT stage, COUNT(*) as count FROM products GROUP BY stage'
  ).all() as Array<{ stage: string; count: number }>;

  const stageMap = Object.fromEntries(stageCounts.map(s => [s.stage, s.count]));
  const total = stageCounts.reduce((sum, s) => sum + s.count, 0);

  const recentProducts = db.prepare(`
    SELECT id, keyword, category, stage, score, model_version, decision, outcome_label, created_at
    FROM products ORDER BY created_at DESC LIMIT 30
  `).all() as Array<{
    id: string; keyword: string; category: string; stage: string;
    score: number; model_version: string; decision: string;
    outcome_label: string; created_at: string;
  }>;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>Pipeline ({total} products)</h1>

      {/* Kanban counts */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
        {STAGE_ORDER.map(stage => (
          <div key={stage} style={{
            background: '#1a1a24',
            border: `1px solid ${STAGE_COLORS[stage] || '#333'}`,
            borderRadius: 8,
            padding: '12px 16px',
            minWidth: 100,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: STAGE_COLORS[stage] }}>
              {stageMap[stage] || 0}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#888', textTransform: 'capitalize' }}>
              {stage}
            </div>
          </div>
        ))}
      </div>

      {/* Recent products table */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Recent Products</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>Keyword</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Category</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Score</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Stage</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Decision</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Outcome</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Date</th>
          </tr>
        </thead>
        <tbody>
          {recentProducts.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid #1a1a24' }}>
              <td style={{ padding: 8 }}>
                <Link href={`/products/${p.id}`} style={{ color: '#60a5fa', textDecoration: 'none' }}>
                  {p.keyword}
                </Link>
              </td>
              <td style={{ padding: 8, color: '#888' }}>{p.category || '-'}</td>
              <td style={{ textAlign: 'center', padding: 8, fontWeight: 'bold', color: (p.score || 0) >= 90 ? '#f59e0b' : (p.score || 0) >= 65 ? '#22c55e' : '#888' }}>
                {p.score?.toFixed(0) || '-'}
              </td>
              <td style={{ textAlign: 'center', padding: 8 }}>
                <span style={{ background: STAGE_COLORS[p.stage] || '#333', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem' }}>
                  {p.stage}
                </span>
              </td>
              <td style={{ textAlign: 'center', padding: 8, color: '#888' }}>{p.decision || '-'}</td>
              <td style={{ textAlign: 'center', padding: 8 }}>
                {p.outcome_label === 'win' ? '✅' : p.outcome_label === 'loss' ? '❌' : p.outcome_label === 'breakeven' ? '➖' : '-'}
              </td>
              <td style={{ textAlign: 'right', padding: 8, color: '#666', fontSize: '0.75rem' }}>
                {new Date(p.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
