import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const AGENTS = ['orchestrator', 'scout-light', 'scout-heavy', 'sourcer', 'scorer', 'builder', 'deployer', 'tracker', 'learner', 'telegram', 'image-proc', 'llm', 'rog-worker'];

export default function SystemPage() {
  const db = getDb();

  // Agent status: last event per agent
  const agentStatus = db.prepare(`
    SELECT agent,
           MAX(created_at) as last_seen,
           (SELECT event_type FROM system_events se2 WHERE se2.agent = se.agent ORDER BY created_at DESC LIMIT 1) as last_event,
           (SELECT severity FROM system_events se3 WHERE se3.agent = se.agent ORDER BY created_at DESC LIMIT 1) as last_severity
    FROM system_events se
    GROUP BY agent
    ORDER BY last_seen DESC
  `).all() as Array<{ agent: string; last_seen: string; last_event: string; last_severity: string }>;

  // Recent errors
  const recentErrors = db.prepare(`
    SELECT agent, event_type, severity, message, created_at
    FROM system_events
    WHERE severity IN ('error', 'critical')
    ORDER BY created_at DESC LIMIT 20
  `).all() as Array<{ agent: string; event_type: string; severity: string; message: string; created_at: string }>;

  // Event counts by type
  const eventCounts = db.prepare(`
    SELECT event_type, COUNT(*) as cnt
    FROM system_events
    GROUP BY event_type
    ORDER BY cnt DESC
  `).all() as Array<{ event_type: string; cnt: number }>;

  // Recent events
  const recentEvents = db.prepare(`
    SELECT agent, event_type, severity, message, created_at
    FROM system_events
    ORDER BY created_at DESC LIMIT 30
  `).all() as Array<{ agent: string; event_type: string; severity: string; message: string; created_at: string }>;

  const severityColors: Record<string, string> = {
    info: '#60a5fa',
    warning: '#f59e0b',
    error: '#ef4444',
    critical: '#dc2626',
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>System</h1>

      {/* Agent Status Grid */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Agent Status</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 32 }}>
        {AGENTS.map(agent => {
          const status = agentStatus.find(a => a.agent === agent);
          const isRecent = status ? (Date.now() - new Date(status.last_seen).getTime()) < 3600000 : false;
          return (
            <div key={agent} style={{
              background: '#1a1a24',
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${isRecent ? '#22c55e' : status ? '#333' : '#222'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{agent}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isRecent ? '#22c55e' : status ? '#f59e0b' : '#555' }} />
              </div>
              <div style={{ fontSize: '0.7rem', color: '#666', marginTop: 4 }}>
                {status ? `${status.last_event} · ${new Date(status.last_seen).toLocaleTimeString()}` : 'No data'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Event Type Counts */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Event Distribution</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
        {eventCounts.map(e => (
          <div key={e.event_type} style={{ background: '#1a1a24', padding: '8px 16px', borderRadius: 6, fontSize: '0.85rem' }}>
            <b>{e.cnt}</b> <span style={{ color: '#888' }}>{e.event_type}</span>
          </div>
        ))}
      </div>

      {/* Recent Errors */}
      {recentErrors.length > 0 && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 12, color: '#ef4444' }}>Recent Errors</h2>
          <div style={{ marginBottom: 32 }}>
            {recentErrors.map((e, i) => (
              <div key={i} style={{ background: '#1a1a24', padding: 10, borderRadius: 6, marginBottom: 4, borderLeft: `3px solid ${severityColors[e.severity]}`, fontSize: '0.8rem' }}>
                <span style={{ color: severityColors[e.severity], fontWeight: 'bold' }}>[{e.agent}]</span> {e.message}
                <span style={{ float: 'right', color: '#555', fontSize: '0.7rem' }}>{new Date(e.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* All Recent Events */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>Event Log</h2>
      <div>
        {recentEvents.map((e, i) => (
          <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #111', fontSize: '0.8rem', display: 'flex', gap: 12 }}>
            <span style={{ color: '#555', minWidth: 140, fontSize: '0.7rem' }}>{new Date(e.created_at).toLocaleString()}</span>
            <span style={{ color: severityColors[e.severity], minWidth: 60 }}>{e.severity}</span>
            <span style={{ color: '#888', minWidth: 100 }}>{e.agent}</span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
