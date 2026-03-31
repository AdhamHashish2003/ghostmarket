import { canUseLocalDb, fetchOrchestrator } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  let llmCallsByTask: Array<{ task_type: string; cnt: number; avg_latency: number }> = [];
  let llmCallsByModel: Array<{ model_used: string; cnt: number }> = [];
  let llmTotals: { total: number; total_tokens_in: number; total_tokens_out: number } = { total: 0, total_tokens_in: 0, total_tokens_out: 0 };
  let qloraPairs: Array<{ outcome_quality: string; cnt: number }> = [];
  let dataQuality: { total: number; with_outcome: number; with_score: number } = { total: 0, with_outcome: 0, with_score: 0 };
  let recentCalls: Array<{
    id: number;
    task_type: string;
    model_used: string;
    tokens_in: number;
    tokens_out: number;
    latency_ms: number;
    created_at: string;
  }> = [];

  if (canUseLocalDb()) {
    const { getDb } = await import('@/lib/db');
    const db = getDb();

    // LLM calls by task type
    llmCallsByTask = db.prepare(`
      SELECT task_type, COUNT(*) as cnt, ROUND(AVG(latency_ms)) as avg_latency
      FROM llm_calls GROUP BY task_type ORDER BY cnt DESC
    `).all() as typeof llmCallsByTask;

    // LLM calls by model
    llmCallsByModel = db.prepare(`
      SELECT model_used, COUNT(*) as cnt FROM llm_calls GROUP BY model_used ORDER BY cnt DESC
    `).all() as typeof llmCallsByModel;

    // Total LLM stats
    llmTotals = db.prepare(`
      SELECT COUNT(*) as total, SUM(tokens_in) as total_tokens_in, SUM(tokens_out) as total_tokens_out FROM llm_calls
    `).get() as typeof llmTotals;

    // QLoRA pairs
    qloraPairs = db.prepare(`
      SELECT outcome_quality, COUNT(*) as cnt FROM llm_calls WHERE outcome_quality IS NOT NULL GROUP BY outcome_quality
    `).all() as typeof qloraPairs;

    // Data quality
    dataQuality = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN outcome_label IS NOT NULL THEN 1 ELSE 0 END) as with_outcome,
             SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END) as with_score
      FROM products
    `).get() as typeof dataQuality;

    // Recent LLM calls
    recentCalls = db.prepare(`
      SELECT id, task_type, model_used, tokens_in, tokens_out, latency_ms, created_at
      FROM llm_calls ORDER BY created_at DESC LIMIT 10
    `).all() as typeof recentCalls;
  } else {
    const data = await fetchOrchestrator<{
      callsByTask: typeof llmCallsByTask;
      totals: typeof llmTotals;
      labelDistribution: unknown;
      qloraPairs: typeof qloraPairs;
      unlabeled: unknown;
      recentCalls: typeof recentCalls;
    }>('/api/training');

    const rawCalls = data.callsByTask || (data as Record<string, unknown>).llmCallsByTask || [];
    llmCallsByTask = (rawCalls as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({
      task_type: String(c.task_type || ''),
      cnt: Number(c.count || c.cnt || 0),
      avg_latency: Number(c.avg_latency_ms || c.avg_latency || 0),
    }));
    const t = data.totals as Record<string, unknown> || {};
    llmTotals = {
      total: Number(t.totalCalls || t.total || 0),
      total_tokens_in: Number(t.totalTokensIn || t.total_tokens_in || 0),
      total_tokens_out: Number(t.totalTokensOut || t.total_tokens_out || 0),
    };
    const rawQlora = data.qloraPairs;
    if (Array.isArray(rawQlora)) {
      qloraPairs = rawQlora.map((q: Record<string, unknown>) => ({
        outcome_quality: String(q.outcome_quality || q.training_version || ''),
        cnt: Number(q.pairs || q.cnt || 0),
      }));
    } else if (rawQlora && typeof rawQlora === 'object') {
      // Dashboard API format: {total_calls, keep_count, flip_count, ...}
      const rq = rawQlora as Record<string, number>;
      qloraPairs = [
        { outcome_quality: 'keep', cnt: rq.keep_count || 0 },
        { outcome_quality: 'flip', cnt: rq.flip_count || 0 },
        { outcome_quality: 'discard', cnt: rq.discard_count || 0 },
      ].filter(q => q.cnt > 0);
    }
    recentCalls = (data.recentCalls || []).map((c: Record<string, unknown>) => ({
      id: Number(c.id || 0),
      task_type: String(c.task_type || ''),
      model_used: String(c.model_used || ''),
      tokens_in: Number(c.tokens_in || 0),
      tokens_out: Number(c.tokens_out || 0),
      latency_ms: Number(c.latency_ms || 0),
      created_at: String(c.created_at || ''),
    }));
  }

  const totalQloraPairs = qloraPairs
    .filter(q => q.outcome_quality === 'keep' || q.outcome_quality === 'flip')
    .reduce((sum, q) => sum + q.cnt, 0);

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
          TRAINING DATA
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          Data pipeline volumes, LLM usage &amp; quality metrics
        </div>
      </div>

      {/* Data Volume Grid */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel>Data Volume</SectionLabel>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 10,
        }}>
          <VolumeCard label="Products" value={dataQuality.total} />
          <VolumeCard label="With Outcome" value={dataQuality.with_outcome} />
          <VolumeCard label="With Score" value={dataQuality.with_score} />
          <VolumeCard label="LLM Calls" value={llmTotals.total} />
          <VolumeCard label="Tokens In" value={llmTotals.total_tokens_in || 0} />
          <VolumeCard label="Tokens Out" value={llmTotals.total_tokens_out || 0} />
          <div style={{
            background: '#08080c',
            border: '1px solid #8b5cf644',
            borderRadius: 8,
            padding: '14px 12px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, height: 2,
              background: 'linear-gradient(90deg, transparent, #8b5cf6, transparent)',
              opacity: 0.6,
            }} />
            <div style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#8b5cf6',
              textShadow: '0 0 10px #8b5cf633',
            }}>
              {totalQloraPairs.toLocaleString()}
            </div>
            <div style={{
              fontSize: '0.6rem',
              color: '#666',
              fontFamily: "'JetBrains Mono', monospace",
              marginTop: 4,
            }}>
              QLoRA Pairs
            </div>
          </div>
        </div>
      </div>

      {/* LLM Calls by Model */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        <div>
          <SectionLabel>LLM Calls by Model</SectionLabel>
          <div style={{
            background: '#08080c',
            border: '1px solid #1a1a22',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {llmCallsByModel.length > 0 ? (
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.75rem',
              }}>
                <thead>
                  <tr style={{ background: '#060608', borderBottom: '1px solid #1a1a22' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Model</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {llmCallsByModel.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a2244' }}>
                      <td style={{ padding: '8px 14px', color: '#888' }}>{m.model_used?.split('/').pop() || m.model_used || '-'}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: '#00FFFF', fontWeight: 600 }}>{m.cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '30px 20px', textAlign: 'center', color: '#333', fontSize: '0.75rem' }}>
                No LLM call data yet
              </div>
            )}
          </div>
        </div>

        <div>
          <SectionLabel>QLoRA Data Quality</SectionLabel>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 10,
          }}>
            {qloraPairs.length > 0 ? qloraPairs.map(q => {
              const colors: Record<string, string> = { keep: '#00ff66', flip: '#ffaa00', discard: '#ff3344' };
              const color = colors[q.outcome_quality] || '#666';
              return (
                <div key={q.outcome_quality} style={{
                  background: '#08080c',
                  border: `1px solid ${color}33`,
                  borderRadius: 8,
                  padding: '16px 14px',
                  textAlign: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, height: 2,
                    background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
                    opacity: 0.5,
                  }} />
                  <div style={{
                    fontSize: '1.3rem',
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                    color,
                  }}>
                    {q.cnt}
                  </div>
                  <div style={{
                    fontSize: '0.6rem',
                    color: '#666',
                    fontFamily: "'JetBrains Mono', monospace",
                    textTransform: 'uppercase',
                    marginTop: 4,
                  }}>
                    {q.outcome_quality}
                  </div>
                </div>
              );
            }) : (
              <div style={{
                background: '#08080c',
                border: '1px solid #1a1a22',
                borderRadius: 8,
                padding: '30px 20px',
                textAlign: 'center',
                color: '#333',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.75rem',
              }}>
                No quality labels yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LLM Call Statistics */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel>LLM Call Statistics</SectionLabel>
        <div style={{
          background: '#08080c',
          border: '1px solid #1a1a22',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {llmCallsByTask.length > 0 ? (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
            }}>
              <thead>
                <tr style={{ background: '#060608', borderBottom: '1px solid #1a1a22' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Task Type</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Count</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {llmCallsByTask.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1a1a2244' }}>
                    <td style={{ padding: '8px 14px', color: '#00FFFF' }}>{l.task_type}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'center', color: '#aaa' }}>{l.cnt}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'center', color: '#888' }}>
                      {l.avg_latency ? `${l.avg_latency}ms` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: '#333', fontSize: '0.75rem' }}>
              No LLM call data yet
            </div>
          )}
        </div>
      </div>

      {/* Export Button */}
      <div style={{ marginBottom: 28 }}>
        <a
          href="/api/training?export=jsonl"
          download
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: '#08080c',
            border: '1px solid #8b5cf644',
            borderRadius: 8,
            padding: '10px 20px',
            color: '#8b5cf6',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.8rem',
            fontWeight: 600,
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          DOWNLOAD TRAINING EXPORT (JSONL)
        </a>
      </div>

      {/* Recent LLM Calls */}
      <div>
        <SectionLabel>Recent LLM Calls</SectionLabel>
        <div style={{
          background: '#08080c',
          border: '1px solid #1a1a22',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {recentCalls.length > 0 ? (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
            }}>
              <thead>
                <tr style={{ background: '#060608', borderBottom: '1px solid #1a1a22' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Task</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Model</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Tokens</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Latency</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.map(c => {
                  const totalTokens = (c.tokens_in || 0) + (c.tokens_out || 0);
                  const latencyColor = c.latency_ms > 5000 ? '#ff3344' : c.latency_ms > 2000 ? '#ffaa00' : '#00ff66';
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid #1a1a2244' }}>
                      <td style={{ padding: '8px 14px', color: '#00FFFF', fontWeight: 600 }}>{c.task_type}</td>
                      <td style={{ padding: '8px 14px', color: '#888' }}>{c.model_used?.split('/').pop() || '-'}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: '#aaa' }}>{totalTokens.toLocaleString()}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: latencyColor }}>
                        {c.latency_ms ? `${c.latency_ms}ms` : '-'}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', color: '#555', fontSize: '0.65rem' }}>
                        {c.created_at ? new Date(c.created_at).toLocaleString() : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: '#333', fontSize: '0.75rem' }}>
              No LLM calls recorded yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VolumeCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      background: '#08080c',
      border: '1px solid #1a1a22',
      borderRadius: 8,
      padding: '14px 12px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg, transparent, #00FFFF44, transparent)',
      }} />
      <div style={{
        fontSize: '1.2rem',
        fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
        color: '#00FFFF',
        textShadow: '0 0 10px #00FFFF33',
      }}>
        {value.toLocaleString()}
      </div>
      <div style={{
        fontSize: '0.6rem',
        color: '#666',
        fontFamily: "'JetBrains Mono', monospace",
        marginTop: 4,
      }}>
        {label}
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
