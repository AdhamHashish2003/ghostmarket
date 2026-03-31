import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function LearningPage() {
  const db = getDb();

  const cycles = db.prepare(`
    SELECT * FROM learning_cycles ORDER BY created_at DESC LIMIT 20
  `).all() as Array<Record<string, unknown>>;

  const labeledCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM products WHERE outcome_label IS NOT NULL"
  ).get() as { cnt: number }).cnt;

  const qloraPairs = (db.prepare(
    "SELECT COUNT(*) as cnt FROM llm_calls WHERE outcome_quality IN ('keep', 'flip')"
  ).get() as { cnt: number }).cnt;

  const sourceRates = db.prepare(`
    SELECT ts.source,
           COUNT(*) as total,
           SUM(CASE WHEN ts.eventual_outcome = 'win' THEN 1 ELSE 0 END) as wins
    FROM trend_signals ts WHERE ts.eventual_outcome IS NOT NULL GROUP BY ts.source
  `).all() as Array<{ source: string; total: number; wins: number }>;

  const latestReflection = db.prepare(`
    SELECT strategy_summary FROM learning_cycles
    WHERE cycle_type = 'reflection' AND strategy_summary IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `).get() as { strategy_summary: string } | undefined;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>Learning</h1>

      {/* Data status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
        <StatusCard label="Labeled Products" value={labeledCount} threshold={50} />
        <StatusCard label="QLoRA Pairs" value={qloraPairs} threshold={50} />
        <StatusCard label="XGBoost Ready" value={labeledCount >= 50 ? 'YES' : 'NO'} />
        <StatusCard label="QLoRA Ready" value={qloraPairs >= 50 ? 'YES' : 'NO'} />
      </div>

      {/* Source Hit Rates */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Source Hit Rates</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
        {sourceRates.sort((a, b) => (b.wins / b.total) - (a.wins / a.total)).map(s => {
          const rate = s.total > 0 ? (s.wins / s.total * 100).toFixed(0) : '0';
          return (
            <div key={s.source} style={{ background: '#1a1a22', padding: 16, borderRadius: 8, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: parseInt(rate) > 40 ? '#22c55e' : parseInt(rate) > 20 ? '#f59e0b' : '#ef4444' }}>
                {rate}%
              </div>
              <div style={{ fontSize: '0.75rem', color: '#888' }}>{s.source}</div>
              <div style={{ fontSize: '0.7rem', color: '#555' }}>{s.wins}/{s.total}</div>
            </div>
          );
        })}
        {sourceRates.length === 0 && <div style={{ color: '#666' }}>No labeled data yet</div>}
      </div>

      {/* Latest Strategy Insights */}
      {latestReflection && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Strategy Insights</h2>
          <div style={{ background: '#1a1a22', padding: 16, borderRadius: 8, marginBottom: 32, whiteSpace: 'pre-wrap', fontSize: '0.85rem', lineHeight: 1.6 }}>
            {latestReflection.strategy_summary}
          </div>
        </>
      )}

      {/* Learning Cycles History */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Training History</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>Date</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Type</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Version</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Accuracy Before</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Accuracy After</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Samples</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Deployed</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((c, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1a1a22' }}>
              <td style={{ padding: 8, fontSize: '0.75rem' }}>{new Date(c.created_at as string).toLocaleString()}</td>
              <td style={{ textAlign: 'center', padding: 8 }}>
                <span style={{ background: c.cycle_type === 'xgboost' ? '#3b82f6' : c.cycle_type === 'qlora' ? '#8b5cf6' : '#f59e0b', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem' }}>
                  {c.cycle_type as string}
                </span>
              </td>
              <td style={{ textAlign: 'center', padding: 8 }}>{c.model_version_after as string || '-'}</td>
              <td style={{ textAlign: 'center', padding: 8 }}>{(c.accuracy_before as number)?.toFixed(3) || '-'}</td>
              <td style={{ textAlign: 'center', padding: 8, fontWeight: 'bold' }}>{(c.accuracy_after as number)?.toFixed(3) || '-'}</td>
              <td style={{ textAlign: 'center', padding: 8 }}>{c.training_samples as number || '-'}</td>
              <td style={{ textAlign: 'center', padding: 8 }}>{c.deployed ? '✅' : '❌'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusCard({ label, value, threshold }: { label: string; value: number | string; threshold?: number }) {
  const isNumber = typeof value === 'number';
  const isMet = threshold ? (value as number) >= threshold : value === 'YES';
  return (
    <div style={{ background: '#1a1a22', padding: 16, borderRadius: 8, textAlign: 'center', border: `1px solid ${isMet ? '#22c55e' : '#333'}` }}>
      <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: isMet ? '#22c55e' : '#888' }}>
        {isNumber ? `${value}${threshold ? `/${threshold}` : ''}` : value}
      </div>
      <div style={{ fontSize: '0.75rem', color: '#888' }}>{label}</div>
    </div>
  );
}
