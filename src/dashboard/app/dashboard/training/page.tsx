import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function TrainingPage() {
  const db = getDb();

  // LLM calls by task type
  const llmCallsByTask = db.prepare(`
    SELECT task_type, COUNT(*) as cnt, ROUND(AVG(latency_ms)) as avg_latency
    FROM llm_calls GROUP BY task_type ORDER BY cnt DESC
  `).all() as Array<{ task_type: string; cnt: number; avg_latency: number }>;

  // LLM calls by model
  const llmCallsByModel = db.prepare(`
    SELECT model_used, COUNT(*) as cnt FROM llm_calls GROUP BY model_used ORDER BY cnt DESC
  `).all() as Array<{ model_used: string; cnt: number }>;

  // Total LLM stats
  const llmTotals = db.prepare(`
    SELECT COUNT(*) as total, SUM(tokens_in) as total_tokens_in, SUM(tokens_out) as total_tokens_out FROM llm_calls
  `).get() as { total: number; total_tokens_in: number; total_tokens_out: number };

  // QLoRA pairs
  const qloraPairs = db.prepare(`
    SELECT outcome_quality, COUNT(*) as cnt FROM llm_calls WHERE outcome_quality IS NOT NULL GROUP BY outcome_quality
  `).all() as Array<{ outcome_quality: string; cnt: number }>;

  // Data quality
  const dataQuality = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN outcome_label IS NOT NULL THEN 1 ELSE 0 END) as with_outcome,
           SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END) as with_score
    FROM products
  `).get() as { total: number; with_outcome: number; with_score: number };

  // Recent LLM calls
  const recentCalls = db.prepare(`
    SELECT id, task_type, model_used, tokens_in, tokens_out, latency_ms, created_at
    FROM llm_calls ORDER BY created_at DESC LIMIT 10
  `).all() as Array<{
    id: number;
    task_type: string;
    model_used: string;
    tokens_in: number;
    tokens_out: number;
    latency_ms: number;
    created_at: string;
  }>;

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
            background: '#111118',
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
            background: '#111118',
            border: '1px solid #1a1a24',
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
                  <tr style={{ background: '#0d0d14', borderBottom: '1px solid #1a1a24' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Model</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {llmCallsByModel.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a2444' }}>
                      <td style={{ padding: '8px 14px', color: '#888' }}>{m.model_used?.split('/').pop() || m.model_used || '-'}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: '#00f0ff', fontWeight: 600 }}>{m.cnt}</td>
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
                  background: '#111118',
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
                background: '#111118',
                border: '1px solid #1a1a24',
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
          background: '#111118',
          border: '1px solid #1a1a24',
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
                <tr style={{ background: '#0d0d14', borderBottom: '1px solid #1a1a24' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Task Type</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Count</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {llmCallsByTask.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1a1a2444' }}>
                    <td style={{ padding: '8px 14px', color: '#00f0ff' }}>{l.task_type}</td>
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
            background: '#111118',
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
          background: '#111118',
          border: '1px solid #1a1a24',
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
                <tr style={{ background: '#0d0d14', borderBottom: '1px solid #1a1a24' }}>
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
                    <tr key={c.id} style={{ borderBottom: '1px solid #1a1a2444' }}>
                      <td style={{ padding: '8px 14px', color: '#00f0ff', fontWeight: 600 }}>{c.task_type}</td>
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
      background: '#111118',
      border: '1px solid #1a1a24',
      borderRadius: 8,
      padding: '14px 12px',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg, transparent, #00f0ff44, transparent)',
      }} />
      <div style={{
        fontSize: '1.2rem',
        fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
        color: '#00f0ff',
        textShadow: '0 0 10px #00f0ff33',
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
