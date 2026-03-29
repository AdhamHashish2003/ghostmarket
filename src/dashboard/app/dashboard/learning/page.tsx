import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function LearningPage() {
  const db = getDb();

  // Learning cycles
  const cycles = db.prepare(
    'SELECT * FROM learning_cycles ORDER BY created_at DESC LIMIT 20'
  ).all() as Array<{
    id: number;
    cycle_type: string;
    model_version_after: string;
    accuracy_before: number;
    accuracy_after: number;
    training_samples: number;
    deployed: number;
    created_at: string;
    strategy_reflection: string | null;
  }>;

  // Label distribution
  const labelDistribution = db.prepare(
    "SELECT outcome_label, COUNT(*) as count FROM products WHERE outcome_label IS NOT NULL GROUP BY outcome_label"
  ).all() as Array<{ outcome_label: string; count: number }>;

  // Source hit rates
  let sourceHitRates: Array<{ source: string; total: number; wins: number }> = [];
  try {
    sourceHitRates = db.prepare(`
      SELECT ts.source, COUNT(*) as total,
        SUM(CASE WHEN ts.eventual_outcome = 'win' THEN 1 ELSE 0 END) as wins
      FROM trend_signals ts WHERE ts.eventual_outcome IS NOT NULL GROUP BY ts.source
    `).all() as Array<{ source: string; total: number; wins: number }>;
  } catch { /* table may not have eventual_outcome column */ }

  // Labeled count
  const labeledRow = db.prepare(
    "SELECT COUNT(*) as cnt FROM products WHERE outcome_label IS NOT NULL"
  ).get() as { cnt: number };
  const labeledCount = labeledRow.cnt;

  // QLoRA pairs
  let qloraPairs = 0;
  try {
    const qloraRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM llm_calls WHERE outcome_quality IN ('keep', 'flip')"
    ).get() as { cnt: number };
    qloraPairs = qloraRow.cnt;
  } catch { /* ok */ }

  // Strategy reflection from latest cycle
  const latestReflection = cycles.find(c => c.strategy_reflection)?.strategy_reflection || null;

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
          LEARNING ENGINE
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          Model training, feature analysis &amp; strategy evolution
        </div>
      </div>

      {/* Status Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginBottom: 28,
      }}>
        <StatusCard label="Labeled Products" value={labeledCount} threshold={50} />
        <StatusCard label="QLoRA Pairs" value={qloraPairs} threshold={50} />
        <StatusCard label="XGBoost Ready" value={labeledCount >= 50 ? 'ARMED' : 'PENDING'} met={labeledCount >= 50} />
        <StatusCard label="QLoRA Ready" value={qloraPairs >= 50 ? 'ARMED' : 'PENDING'} met={qloraPairs >= 50} />
      </div>

      {/* Label Distribution */}
      {labelDistribution.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionLabel>Label Distribution</SectionLabel>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 10,
          }}>
            {labelDistribution.map(l => {
              const colors: Record<string, string> = { win: '#00ff66', loss: '#ff3344', breakeven: '#ffaa00' };
              const color = colors[l.outcome_label] || '#666';
              return (
                <div key={l.outcome_label} style={{
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
                    textShadow: `0 0 12px ${color}33`,
                  }}>
                    {l.count}
                  </div>
                  <div style={{
                    fontSize: '0.6rem',
                    color: '#666',
                    fontFamily: "'JetBrains Mono', monospace",
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginTop: 4,
                  }}>
                    {l.outcome_label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source Hit Rates */}
      {sourceHitRates.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionLabel>Source Hit Rates</SectionLabel>
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
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Source</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Wins</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {sourceHitRates.map(s => {
                  const rate = s.total > 0 ? (s.wins / s.total * 100) : 0;
                  const rateColor = rate > 40 ? '#00ff66' : rate > 20 ? '#ffaa00' : '#ff3344';
                  return (
                    <tr key={s.source} style={{ borderBottom: '1px solid #1a1a2444' }}>
                      <td style={{ padding: '8px 14px', color: '#00f0ff', fontWeight: 600 }}>{s.source}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: '#aaa' }}>{s.total}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: '#00ff66' }}>{s.wins}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: rateColor, fontWeight: 700 }}>
                        {rate.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Strategy Reflection */}
      {latestReflection && (
        <div style={{ marginBottom: 28 }}>
          <SectionLabel>Latest Strategy Reflection</SectionLabel>
          <div style={{
            background: '#111118',
            border: '1px solid #1a1a24',
            borderRadius: 8,
            padding: '18px 20px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.78rem',
            lineHeight: 1.7,
            color: '#aaa',
            whiteSpace: 'pre-wrap',
            borderLeft: '3px solid #ff00aa44',
          }}>
            {latestReflection}
          </div>
        </div>
      )}

      {/* Training History */}
      <div>
        <SectionLabel>Training History</SectionLabel>
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
                <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Type</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Version</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Before</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>After</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Samples</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Deployed</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c, i) => {
                const typeColors: Record<string, string> = { xgboost: '#00f0ff', qlora: '#ff00aa', reflection: '#ffaa00' };
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #1a1a2444' }}>
                    <td style={{ padding: '8px 14px', color: '#888', fontSize: '0.7rem' }}>
                      {new Date(c.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                      <span style={{
                        background: `${typeColors[c.cycle_type] || '#666'}22`,
                        color: typeColors[c.cycle_type] || '#666',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        border: `1px solid ${typeColors[c.cycle_type] || '#666'}44`,
                      }}>
                        {c.cycle_type}
                      </span>
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'center', color: '#aaa' }}>
                      {c.model_version_after || '-'}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'center', color: '#666' }}>
                      {c.accuracy_before?.toFixed(3) || '-'}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, color: '#00ff66' }}>
                      {c.accuracy_after?.toFixed(3) || '-'}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'center', color: '#888' }}>
                      {c.training_samples || '-'}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: c.deployed ? '#00ff66' : '#ff3344',
                        display: 'inline-block',
                        boxShadow: c.deployed ? '0 0 6px #00ff6688' : 'none',
                      }} />
                    </td>
                  </tr>
                );
              })}
              {cycles.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 30, textAlign: 'center', color: '#333', fontSize: '0.75rem' }}>
                    No training cycles recorded yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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

function StatusCard({ label, value, threshold, met }: {
  label: string;
  value: number | string;
  threshold?: number;
  met?: boolean;
}) {
  const isMet = met !== undefined ? met : (threshold ? (value as number) >= threshold : false);
  const color = isMet ? '#00ff66' : '#ff3344';

  return (
    <div style={{
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
        textShadow: `0 0 12px ${color}33`,
      }}>
        {typeof value === 'number' ? `${value}${threshold ? `/${threshold}` : ''}` : value}
      </div>
      <div style={{
        fontSize: '0.6rem',
        color: '#666',
        fontFamily: "'JetBrains Mono', monospace",
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginTop: 4,
      }}>
        {label}
      </div>
    </div>
  );
}
