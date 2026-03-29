import { getDb } from '@/lib/db';
import MetricCard from '@/components/MetricCard';

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

// Pipeline visualization stage definitions
const PIPELINE_STAGES = [
  { name: 'scout', label: 'SCOUT', dbStages: ['discovered'] },
  { name: 'sourcer', label: 'SOURCER', dbStages: ['sourced'] },
  { name: 'scorer', label: 'SCORER', dbStages: ['scored'] },
  { name: 'telegram', label: 'TELEGRAM', dbStages: ['approved'] },
  { name: 'builder', label: 'BUILDER', dbStages: ['building'] },
  { name: 'deployer', label: 'DEPLOYER', dbStages: ['deploying', 'deployed'] },
  { name: 'tracker', label: 'TRACKER', dbStages: ['live', 'tracking'] },
  { name: 'learner', label: 'LEARNER', dbStages: ['completed'] },
];

const CYAN = '#00f0ff';

const EVENT_COLORS: Record<string, string> = {
  discovery: '#00f0ff',
  scoring: '#ff00aa',
  approval: '#00ff66',
  error: '#ff3344',
  info: '#666666',
};

function mapEventType(eventType: string): string {
  if (eventType.includes('error')) return 'error';
  if (eventType.includes('discover') || eventType === 'discovery') return 'discovery';
  if (eventType.includes('scor')) return 'scoring';
  if (eventType.includes('approv')) return 'approval';
  return 'info';
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '--';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DashboardPage() {
  const db = getDb();

  // Metric counts
  const totalProducts = (db.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number }).cnt;
  const scoredToday = (db.prepare(
    "SELECT COUNT(*) as cnt FROM products WHERE stage = 'scored' AND date(created_at) = date('now')"
  ).get() as { cnt: number }).cnt;
  const approved = (db.prepare("SELECT COUNT(*) as cnt FROM products WHERE stage = 'approved'").get() as { cnt: number }).cnt;
  const live = (db.prepare("SELECT COUNT(*) as cnt FROM products WHERE stage IN ('live','tracking')").get() as { cnt: number }).cnt;

  let totalRevenue = 0;
  try {
    totalRevenue = (db.prepare('SELECT COALESCE(SUM(total_revenue), 0) as rev FROM products').get() as { rev: number }).rev;
  } catch { /* table may not have column */ }

  let modelVersion = 'v1.0';
  try {
    const mv = db.prepare("SELECT model_version_after FROM learning_cycles ORDER BY created_at DESC LIMIT 1").get() as { model_version_after: string } | undefined;
    if (mv?.model_version_after) modelVersion = mv.model_version_after;
  } catch { /* ok */ }

  // Pipeline data: stage counts
  const stageCounts = db.prepare(
    'SELECT stage, COUNT(*) as count FROM products GROUP BY stage'
  ).all() as Array<{ stage: string; count: number }>;
  const stageCountMap: Record<string, number> = {};
  for (const s of stageCounts) {
    stageCountMap[s.stage] = s.count;
  }

  // Pipeline data: agent last activity
  const agentActivity = db.prepare(
    'SELECT agent, MAX(created_at) as last FROM system_events GROUP BY agent'
  ).all() as Array<{ agent: string; last: string }>;
  const agentLastMap: Record<string, string> = {};
  for (const a of agentActivity) {
    agentLastMap[a.agent] = a.last;
  }

  // Build pipeline stage data
  const pipelineData = PIPELINE_STAGES.map(ps => {
    let count = 0;
    for (const dbStage of ps.dbStages) {
      count += stageCountMap[dbStage] || 0;
    }
    const lastActivity = agentLastMap[ps.name] || agentLastMap[ps.name.replace('-light', '').replace('-heavy', '')] || null;
    const isActive = lastActivity ? (Date.now() - new Date(lastActivity).getTime()) < 5 * 60 * 1000 : false;
    return { ...ps, count, lastActivity, isActive };
  });

  // Event feed data
  const recentEvents = db.prepare(
    'SELECT id, agent, event_type, severity, message, created_at FROM system_events ORDER BY created_at DESC LIMIT 30'
  ).all() as Array<{
    id: number;
    agent: string;
    event_type: string;
    severity: string;
    message: string;
    created_at: string;
  }>;

  // Recent scored products
  const recentProducts = db.prepare(`
    SELECT id, keyword, score, stage, category, created_at
    FROM products
    ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{
    id: string; keyword: string; score: number;
    stage: string; category: string; created_at: string;
  }>;

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontSize: '1.4rem',
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          color: '#e0e0e0',
          margin: 0,
          letterSpacing: '0.03em',
        }}>
          COMMAND CENTER
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          Real-time pipeline monitoring &amp; autonomous operations
        </div>
      </div>

      {/* Pipeline Visualization (server-rendered) */}
      <div style={{ marginBottom: 32 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          overflowX: 'auto',
          padding: '16px 8px',
          position: 'relative',
        }}>
          {pipelineData.map((stage, idx) => (
            <div key={stage.name} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {/* Hex node */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 80,
                  height: 80,
                  clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                  position: 'relative',
                  ...(stage.isActive ? { boxShadow: `0 0 15px ${CYAN}44, 0 0 30px ${CYAN}22, inset 0 0 15px ${CYAN}11` } : {}),
                }}>
                  {/* Hex outline */}
                  <div style={{
                    position: 'absolute',
                    inset: -1,
                    clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                    background: stage.isActive ? CYAN : '#1a1a24',
                    zIndex: 0,
                  }} />
                  {/* Hex inner */}
                  <div style={{
                    position: 'absolute',
                    inset: 1,
                    clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                    background: stage.isActive ? '#111118' : '#0d0d14',
                    zIndex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <div style={{
                      fontSize: '1.2rem',
                      fontWeight: 'bold',
                      color: stage.isActive ? CYAN : '#444',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {stage.count}
                    </div>
                  </div>
                </div>
                <div style={{
                  fontSize: '0.65rem',
                  fontWeight: 'bold',
                  color: stage.isActive ? CYAN : '#555',
                  letterSpacing: '0.05em',
                  fontFamily: "'JetBrains Mono', monospace",
                  textAlign: 'center',
                }}>
                  {stage.label}
                </div>
                <div style={{
                  fontSize: '0.55rem',
                  color: stage.isActive ? '#00f0ff88' : '#333',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {timeAgo(stage.lastActivity)}
                </div>
              </div>

              {/* Connector arrow */}
              {idx < pipelineData.length - 1 && (
                <div style={{
                  width: 32,
                  height: 2,
                  background: `linear-gradient(90deg, ${CYAN}33, ${CYAN}11)`,
                  position: 'relative',
                }}>
                  <div style={{
                    position: 'absolute',
                    right: -4,
                    top: -3,
                    width: 0,
                    height: 0,
                    borderTop: '4px solid transparent',
                    borderBottom: '4px solid transparent',
                    borderLeft: `6px solid ${CYAN}33`,
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 32 }}>
        {/* Left: Event Feed (60%) */}
        <div style={{ flex: '0 0 60%', minWidth: 0 }}>
          <div style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: '#555',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Event Stream
          </div>

          {/* Server-rendered Event Feed */}
          <div style={{
            background: '#111118',
            border: '1px solid #1a1a24',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid #1a1a24',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{
                fontSize: '0.8rem',
                fontWeight: 'bold',
                color: '#e0e0e0',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.05em',
              }}>
                EVENT FEED
              </span>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: recentEvents.length > 0 ? '#00ff66' : '#333',
                display: 'inline-block',
                boxShadow: recentEvents.length > 0 ? '0 0 6px #00ff6688' : 'none',
              }} />
            </div>

            <div style={{
              height: 300,
              overflowY: 'auto',
              padding: '4px 0',
            }}>
              {recentEvents.length === 0 && (
                <div style={{
                  padding: '40px 14px',
                  textAlign: 'center',
                  color: '#333',
                  fontSize: '0.75rem',
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  Waiting for events...
                </div>
              )}

              {recentEvents.map(evt => {
                const type = mapEventType(evt.event_type);
                const color = EVENT_COLORS[type] || EVENT_COLORS.info;
                return (
                  <div
                    key={evt.id}
                    style={{
                      padding: '3px 14px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.72rem',
                      lineHeight: '1.5',
                      borderLeft: `2px solid ${color}`,
                      marginBottom: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <span style={{ color: '#555' }}>
                      [{formatTimestamp(evt.created_at)}]
                    </span>
                    {' '}
                    <span style={{ color, fontWeight: 'bold' }}>
                      [{evt.agent}]
                    </span>
                    {' '}
                    <span style={{ color: '#c0c0c0' }}>
                      {evt.message}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Metric Cards (40%) */}
        <div style={{ flex: '0 0 calc(40% - 24px)', minWidth: 0 }}>
          <div style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: '#555',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            System Metrics
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
          }}>
            <MetricCard label="Products Discovered" value={totalProducts} color="#00f0ff" icon={'\u25C8'} />
            <MetricCard label="Scored Today" value={scoredToday} color="#ff00aa" icon={'\u25B2'} />
            <MetricCard label="Approved" value={approved} color="#00ff66" icon={'\u2713'} />
            <MetricCard label="Live" value={live} color="#00ff66" icon={'\u25CF'} />
            <MetricCard label="Total Revenue" value={`$${totalRevenue.toFixed(2)}`} color="#ffaa00" icon="$" />
            <MetricCard label="Model Version" value={modelVersion} color="#8b5cf6" icon={'\u25C6'} />
          </div>
        </div>
      </div>

      {/* Recent Products */}
      <div>
        <div style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          color: '#555',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}>
          Recent Products
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {recentProducts.map(p => (
            <a
              key={p.id}
              href={`/dashboard/products/${p.id}`}
              style={{
                textDecoration: 'none',
                color: 'inherit',
                minWidth: 200,
                flex: '0 0 auto',
              }}
            >
              <div style={{
                background: '#111118',
                border: '1px solid #1a1a24',
                borderRadius: 8,
                padding: '14px 16px',
                position: 'relative',
                overflow: 'hidden',
                transition: 'border-color 0.2s',
              }}>
                {/* Top glow */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: `linear-gradient(90deg, transparent, ${STAGE_COLORS[p.stage] || '#00f0ff'}, transparent)`,
                  opacity: 0.6,
                }} />
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#e0e0e0',
                  marginBottom: 8,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {p.keyword}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: (p.score || 0) >= 80 ? '#00ff66' : (p.score || 0) >= 60 ? '#ffaa00' : '#666',
                    textShadow: (p.score || 0) >= 80 ? '0 0 10px #00ff6644' : 'none',
                  }}>
                    {p.score?.toFixed(0) || '--'}
                  </span>
                  <span style={{
                    background: `${STAGE_COLORS[p.stage] || '#333'}22`,
                    color: STAGE_COLORS[p.stage] || '#666',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: '0.65rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    border: `1px solid ${STAGE_COLORS[p.stage] || '#333'}44`,
                  }}>
                    {p.stage}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.6rem',
                  color: '#444',
                  fontFamily: "'JetBrains Mono', monospace",
                  marginTop: 8,
                }}>
                  {p.category || 'uncategorized'} &middot; {new Date(p.created_at).toLocaleDateString()}
                </div>
              </div>
            </a>
          ))}
          {recentProducts.length === 0 && (
            <div style={{
              color: '#333',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
              padding: 20,
            }}>
              No products discovered yet. Pipeline awaiting activation...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
