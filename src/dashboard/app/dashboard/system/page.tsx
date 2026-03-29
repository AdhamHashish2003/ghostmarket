import { getDb } from '@/lib/db';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const KNOWN_AGENTS = [
  'orchestrator', 'scout-light', 'scout-heavy', 'sourcer',
  'scorer', 'builder', 'deployer', 'tracker',
  'learner', 'telegram', 'image-proc', 'llm', 'rog-worker',
];

export default function SystemPage() {
  const db = getDb();

  // Agent status (last event per agent)
  const agentStatus = db.prepare(`
    SELECT agent, event_type, severity, message, MAX(created_at) as last_seen
    FROM system_events GROUP BY agent ORDER BY last_seen DESC
  `).all() as Array<{
    agent: string;
    event_type: string;
    severity: string;
    message: string;
    last_seen: string;
  }>;

  // Error count per agent (24h)
  const errorCounts = db.prepare(`
    SELECT agent, COUNT(*) as errors FROM system_events
    WHERE severity IN ('error', 'critical') AND created_at > datetime('now', '-24 hours')
    GROUP BY agent
  `).all() as Array<{ agent: string; errors: number }>;
  const errorMap: Record<string, number> = {};
  for (const e of errorCounts) {
    errorMap[e.agent] = e.errors;
  }

  // Recent errors
  const recentErrors = db.prepare(`
    SELECT id, agent, event_type, severity, message, created_at FROM system_events
    WHERE severity IN ('error', 'critical') ORDER BY created_at DESC LIMIT 30
  `).all() as Array<{
    id: number;
    agent: string;
    event_type: string;
    severity: string;
    message: string;
    created_at: string;
  }>;

  // DB size
  const dbPath = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';
  let dbSizeBytes = 0;
  try {
    const stat = fs.statSync(dbPath);
    dbSizeBytes = stat.size;
  } catch { /* ok */ }
  const dbSize = dbSizeBytes > 0
    ? dbSizeBytes >= 1048576
      ? `${(dbSizeBytes / 1048576).toFixed(1)} MB`
      : `${(dbSizeBytes / 1024).toFixed(0)} KB`
    : 'N/A';

  // Table counts
  const tableCounts = db.prepare(`
    SELECT 'products' as tbl, COUNT(*) as cnt FROM products
    UNION ALL SELECT 'trend_signals', COUNT(*) FROM trend_signals
    UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
    UNION ALL SELECT 'llm_calls', COUNT(*) FROM llm_calls
    UNION ALL SELECT 'system_events', COUNT(*) FROM system_events
  `).all() as Array<{ tbl: string; cnt: number }>;

  // Build unique agent list (known + any from DB)
  const allAgents = [...new Set([...KNOWN_AGENTS, ...agentStatus.map(a => a.agent)])];
  const agentMap: Record<string, typeof agentStatus[0]> = {};
  for (const a of agentStatus) {
    agentMap[a.agent] = a;
  }

  const severityColors: Record<string, string> = {
    info: '#00f0ff',
    warning: '#ffaa00',
    error: '#ff3344',
    critical: '#ff3344',
  };

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
          SYSTEM STATUS
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          Agent health monitoring, error tracking &amp; diagnostics
        </div>
      </div>

      {/* Agent Health Grid */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel>Agent Health</SectionLabel>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10,
        }}>
          {allAgents.map(agentName => {
            const status = agentMap[agentName];
            const lastSeen = status?.last_seen ? new Date(status.last_seen) : null;
            const now = Date.now();
            const isRecent = lastSeen ? (now - lastSeen.getTime()) < 3600000 : false;
            const isStale = lastSeen ? (now - lastSeen.getTime()) > 3600000 : false;
            const agentErrors = errorMap[agentName] || 0;

            let dotColor = '#333';
            let borderColor = '#1a1a24';
            if (agentErrors > 0) { dotColor = '#ff3344'; borderColor = '#ff334433'; }
            else if (isRecent) { dotColor = '#00ff66'; borderColor = '#00ff6633'; }
            else if (isStale) { dotColor = '#ffaa00'; borderColor = '#ffaa0033'; }

            return (
              <div key={agentName} style={{
                background: '#111118',
                border: `1px solid ${borderColor}`,
                borderRadius: 8,
                padding: '12px 14px',
                position: 'relative',
                overflow: 'hidden',
              }}>
                {isRecent && (
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, height: 2,
                    background: 'linear-gradient(90deg, transparent, #00ff66, transparent)',
                    opacity: 0.4,
                  }} />
                )}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}>
                  <span style={{
                    fontWeight: 600,
                    fontSize: '0.78rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: isRecent ? '#e0e0e0' : '#666',
                  }}>
                    {agentName}
                  </span>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: dotColor,
                    display: 'inline-block',
                    boxShadow: isRecent ? `0 0 6px ${dotColor}88` : 'none',
                  }} />
                </div>
                <div style={{
                  fontSize: '0.6rem',
                  color: '#555',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {status ? (
                    <>
                      <span style={{ color: '#666' }}>{status.event_type}</span>
                      <span style={{ color: '#333' }}> &middot; </span>
                      <span>{lastSeen ? lastSeen.toLocaleTimeString() : '--'}</span>
                      {agentErrors > 0 && (
                        <span style={{ color: '#ff3344', marginLeft: 6 }}>
                          {agentErrors} err
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: '#333' }}>No data</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* DB Size + Table Counts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, marginBottom: 28 }}>
        <div>
          <SectionLabel>Database</SectionLabel>
          <div style={{
            background: '#111118',
            border: '1px solid #1a1a24',
            borderRadius: 8,
            padding: '20px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#00f0ff',
              textShadow: '0 0 12px #00f0ff33',
            }}>
              {dbSize}
            </div>
            <div style={{
              fontSize: '0.6rem',
              color: '#666',
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              marginTop: 4,
            }}>
              DB Size
            </div>
          </div>

          {/* Table Row Counts */}
          <div style={{ marginTop: 12 }}>
            {tableCounts.map(t => (
              <div key={t.tbl} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 10px',
                borderBottom: '1px solid #1a1a2444',
                fontSize: '0.7rem',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                <span style={{ color: '#888' }}>{t.tbl}</span>
                <span style={{ color: '#00f0ff', fontWeight: 600 }}>{t.cnt.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Error Summary (24h)</SectionLabel>
          {errorCounts.length > 0 ? (
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
                    <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Agent</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {errorCounts.map(e => (
                    <tr key={e.agent} style={{ borderBottom: '1px solid #1a1a2444' }}>
                      <td style={{ padding: '8px 14px', color: '#ff00aa', fontWeight: 600 }}>{e.agent}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'center', color: '#ff3344', fontWeight: 700 }}>{e.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{
              background: '#111118',
              border: '1px solid #1a1a24',
              borderRadius: 8,
              padding: '30px 20px',
              textAlign: 'center',
              color: '#00ff66',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
            }}>
              No errors in the last 24 hours. System operating within parameters.
            </div>
          )}
        </div>
      </div>

      {/* Error Log */}
      <div>
        <SectionLabel>
          Error Log
          {recentErrors.length > 0 && (
            <span style={{
              marginLeft: 8,
              background: '#ff334422',
              color: '#ff3344',
              padding: '1px 6px',
              borderRadius: 3,
              fontSize: '0.6rem',
              fontWeight: 600,
            }}>
              {recentErrors.length}
            </span>
          )}
        </SectionLabel>
        {recentErrors.length > 0 ? (
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
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Time</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Severity</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Agent</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#555', fontSize: '0.65rem', textTransform: 'uppercase' }}>Message</th>
                </tr>
              </thead>
              <tbody>
                {recentErrors.map(err => {
                  const sevColor = severityColors[err.severity] || '#666';
                  return (
                    <tr key={err.id} style={{ borderBottom: '1px solid #1a1a2444' }}>
                      <td style={{ padding: '8px 14px', color: '#666', fontSize: '0.65rem' }}>
                        {err.created_at ? new Date(err.created_at).toLocaleString() : '-'}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                        <span style={{
                          background: `${sevColor}22`,
                          color: sevColor,
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          border: `1px solid ${sevColor}44`,
                        }}>
                          {err.severity}
                        </span>
                      </td>
                      <td style={{ padding: '8px 14px', color: '#ff00aa', fontWeight: 600 }}>
                        {err.agent}
                      </td>
                      <td style={{ padding: '8px 14px', color: '#aaa', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {err.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
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
            No errors recorded. System operating within parameters.
          </div>
        )}
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
