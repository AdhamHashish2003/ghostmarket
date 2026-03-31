import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function TrainingDataPage() {
  const db = getDb();

  // Data quality metrics
  const tableCounts = db.prepare(`
    SELECT 'products' as t, COUNT(*) as cnt FROM products
    UNION ALL SELECT 'trend_signals', COUNT(*) FROM trend_signals
    UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
    UNION ALL SELECT 'llm_calls', COUNT(*) FROM llm_calls
    UNION ALL SELECT 'operator_decisions', COUNT(*) FROM operator_decisions
    UNION ALL SELECT 'outcomes', COUNT(*) FROM outcomes
    UNION ALL SELECT 'learning_cycles', COUNT(*) FROM learning_cycles
    UNION ALL SELECT 'system_events', COUNT(*) FROM system_events
  `).all() as Array<{ t: string; cnt: number }>;

  const labelDistribution = db.prepare(`
    SELECT outcome_label, COUNT(*) as cnt
    FROM products WHERE outcome_label IS NOT NULL
    GROUP BY outcome_label
  `).all() as Array<{ outcome_label: string; cnt: number }>;

  const llmCallStats = db.prepare(`
    SELECT task_type, COUNT(*) as cnt, AVG(latency_ms) as avg_latency
    FROM llm_calls GROUP BY task_type ORDER BY cnt DESC
  `).all() as Array<{ task_type: string; cnt: number; avg_latency: number }>;

  const qloraStats = db.prepare(`
    SELECT outcome_quality, COUNT(*) as cnt
    FROM llm_calls WHERE outcome_quality IS NOT NULL
    GROUP BY outcome_quality
  `).all() as Array<{ outcome_quality: string; cnt: number }>;

  const trainingExportCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM training_export'
  ).get() as { cnt: number }).cnt;

  const recentLLMCalls = db.prepare(`
    SELECT task_type, model_used, tokens_in, tokens_out, latency_ms, eventual_outcome, outcome_quality, created_at
    FROM llm_calls ORDER BY created_at DESC LIMIT 20
  `).all() as Array<Record<string, unknown>>;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>Training Data</h1>

      {/* Data Volume */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Data Volume</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
        {tableCounts.map(t => (
          <div key={t.t} style={{ background: '#1a1a22', padding: 16, borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{t.cnt.toLocaleString()}</div>
            <div style={{ fontSize: '0.75rem', color: '#888' }}>{t.t}</div>
          </div>
        ))}
        <div style={{ background: '#1a1a22', padding: 16, borderRadius: 8, textAlign: 'center', border: '1px solid #8b5cf6' }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#8b5cf6' }}>{trainingExportCount}</div>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>training_export rows</div>
        </div>
      </div>

      {/* Label Distribution */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Label Distribution</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        {labelDistribution.map(l => (
          <div key={l.outcome_label} style={{ background: '#1a1a22', padding: 16, borderRadius: 8, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {l.outcome_label === 'win' ? '✅' : l.outcome_label === 'loss' ? '❌' : '➖'} {l.cnt}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#888' }}>{l.outcome_label}</div>
          </div>
        ))}
        {labelDistribution.length === 0 && <div style={{ color: '#666' }}>No labeled data yet</div>}
      </div>

      {/* QLoRA Data Quality */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>QLoRA Training Data Quality</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        {qloraStats.map(q => (
          <div key={q.outcome_quality} style={{ background: '#1a1a22', padding: 16, borderRadius: 8, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: q.outcome_quality === 'keep' ? '#22c55e' : q.outcome_quality === 'flip' ? '#f59e0b' : '#888' }}>
              {q.cnt}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#888' }}>{q.outcome_quality}</div>
          </div>
        ))}
        {qloraStats.length === 0 && <div style={{ color: '#666' }}>No quality labels yet</div>}
      </div>

      {/* LLM Call Stats */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>LLM Call Statistics</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 32 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>Task Type</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Count</th>
            <th style={{ textAlign: 'center', padding: 8 }}>Avg Latency</th>
          </tr>
        </thead>
        <tbody>
          {llmCallStats.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1a1a22' }}>
              <td style={{ padding: 8 }}>{l.task_type}</td>
              <td style={{ textAlign: 'center', padding: 8 }}>{l.cnt}</td>
              <td style={{ textAlign: 'center', padding: 8 }}>{l.avg_latency ? `${l.avg_latency.toFixed(0)}ms` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Recent LLM Calls */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Recent LLM Calls</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ textAlign: 'left', padding: 6 }}>Type</th>
            <th style={{ textAlign: 'left', padding: 6 }}>Model</th>
            <th style={{ textAlign: 'center', padding: 6 }}>Tokens</th>
            <th style={{ textAlign: 'center', padding: 6 }}>Latency</th>
            <th style={{ textAlign: 'center', padding: 6 }}>Quality</th>
            <th style={{ textAlign: 'right', padding: 6 }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {recentLLMCalls.map((c, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1a1a22' }}>
              <td style={{ padding: 6 }}>{c.task_type as string}</td>
              <td style={{ padding: 6, color: '#888' }}>{(c.model_used as string)?.split('/').pop()}</td>
              <td style={{ textAlign: 'center', padding: 6 }}>{(c.tokens_in as number || 0) + (c.tokens_out as number || 0)}</td>
              <td style={{ textAlign: 'center', padding: 6 }}>{c.latency_ms ? `${c.latency_ms}ms` : '-'}</td>
              <td style={{ textAlign: 'center', padding: 6, color: c.outcome_quality === 'keep' ? '#22c55e' : c.outcome_quality === 'flip' ? '#f59e0b' : '#888' }}>
                {(c.outcome_quality as string) || '-'}
              </td>
              <td style={{ textAlign: 'right', padding: 6, color: '#555', fontSize: '0.7rem' }}>
                {new Date(c.created_at as string).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
