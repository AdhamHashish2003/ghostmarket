import MetricCard from '@/components/MetricCard';
import LiveEventFeed from '@/components/LiveEventFeed';
import { canUseLocalDb, fetchOrchestrator } from '@/lib/data';

export const dynamic = 'force-dynamic';

const STAGE_COLORS: Record<string, string> = {
  discovered: '#00FFFF', scored: '#FF6B00', approved: '#00ff66',
  building: '#FF6B00', live: '#00ff66', tracking: '#00FFFF',
  completed: '#8b5cf6', skipped: '#555', killed: '#ff3344',
  waiting_human: '#FF6B00',
};

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

const CYAN = '#00FFFF';
const ORANGE = '#FF6B00';

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

// ── Data fetching (works on both localhost and Vercel) ──

interface DashboardData {
  totalProducts: number;
  scoredToday: number;
  approved: number;
  live: number;
  totalRevenue: number;
  modelVersion: string;
  stageCountMap: Record<string, number>;
  agentLastMap: Record<string, string>;
  initialEvents: Array<{ id: string; agent: string; event_type: string; severity: string; message: string; created_at: string }>;
  recentProducts: Array<{ id: string; keyword: string; score: number; stage: string; category: string; created_at: string }>;
  avgScore: number;
  approvedToday: number;
  throughput: number;
}

async function getDataLocal(): Promise<DashboardData> {
  const { getDb } = await import('@/lib/db');
  const db = getDb();

  const totalProducts = (db.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number }).cnt;
  const scoredToday = (db.prepare("SELECT COUNT(*) as cnt FROM products WHERE stage = 'scored' AND date(created_at) = date('now')").get() as { cnt: number }).cnt;
  const approved = (db.prepare("SELECT COUNT(*) as cnt FROM products WHERE stage = 'approved'").get() as { cnt: number }).cnt;
  const live = (db.prepare("SELECT COUNT(*) as cnt FROM products WHERE stage IN ('live','tracking')").get() as { cnt: number }).cnt;
  const avgScoreRow = db.prepare("SELECT ROUND(AVG(score), 1) as avg FROM products WHERE score IS NOT NULL").get() as { avg: number | null };
  const avgScore = avgScoreRow?.avg ?? 0;
  const approvedToday = (db.prepare("SELECT COUNT(*) as cnt FROM operator_decisions WHERE decision = 'approve' AND date(created_at) = date('now')").get() as { cnt: number }).cnt;
  const throughput = (db.prepare("SELECT COUNT(*) as cnt FROM products WHERE stage NOT IN ('discovered') AND date(updated_at) = date('now')").get() as { cnt: number }).cnt;

  let totalRevenue = 0;
  try { totalRevenue = (db.prepare('SELECT COALESCE(SUM(total_revenue), 0) as rev FROM products').get() as { rev: number }).rev; } catch {}

  let modelVersion = 'v1.0';
  try {
    const mv = db.prepare("SELECT model_version_after FROM learning_cycles ORDER BY created_at DESC LIMIT 1").get() as { model_version_after: string } | undefined;
    if (mv?.model_version_after) modelVersion = mv.model_version_after;
  } catch {}

  const stageCounts = db.prepare('SELECT stage, COUNT(*) as count FROM products GROUP BY stage').all() as Array<{ stage: string; count: number }>;
  const stageCountMap: Record<string, number> = {};
  for (const s of stageCounts) stageCountMap[s.stage] = s.count;

  const agentActivity = db.prepare('SELECT agent, MAX(created_at) as last FROM system_events GROUP BY agent').all() as Array<{ agent: string; last: string }>;
  const agentLastMap: Record<string, string> = {};
  for (const a of agentActivity) agentLastMap[a.agent] = a.last;

  const initialEvents = db.prepare('SELECT id, agent, event_type, severity, message, created_at FROM system_events ORDER BY created_at DESC LIMIT 30').all() as DashboardData['initialEvents'];

  const recentProducts = db.prepare('SELECT id, keyword, score, stage, category, created_at FROM products ORDER BY score DESC NULLS LAST, created_at DESC LIMIT 5').all() as DashboardData['recentProducts'];

  return { totalProducts, scoredToday, approved, live, totalRevenue, modelVersion, stageCountMap, agentLastMap, initialEvents, recentProducts, avgScore, approvedToday, throughput };
}

async function getDataRemote(): Promise<DashboardData> {
  // On Vercel: fetch data from orchestrator via tunnel.
  // Read ORCHESTRATOR_URL at call time (not module-load time) to ensure fresh env.
  const orchUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:4000';
  let pipeline: Record<string, unknown> = {};
  let m: Record<string, unknown> = {};

  async function orchFetch(apiPath: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`${orchUrl}${apiPath}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) throw new Error(`${resp.status}`);
    return resp.json();
  }

  // Pipeline fetch
  try { pipeline = await orchFetch('/api/pipeline'); } catch { /* empty */ }

  // Metrics fetch
  try { m = await orchFetch('/api/metrics'); } catch { /* empty */ }

  // Pipeline response: handle both field names (stages vs stageCounts)
  const stageCountMap: Record<string, number> = {};
  const stages = (pipeline.stages || pipeline.stageCounts || []) as Array<{ stage: string; count: number }>;
  for (const s of stages) stageCountMap[s.stage] = s.count;

  // Derive metrics from stage counts as fallback
  const stageTotal = Object.values(stageCountMap).reduce((a, b) => a + b, 0);
  const liveCount = (stageCountMap['live'] || 0) + (stageCountMap['tracking'] || 0);
  const approvedCount = stageCountMap['approved'] || 0;
  const scoredCount = stageCountMap['scored'] || 0;

  return {
    totalProducts: (m.totalProducts as number) || stageTotal,
    scoredToday: (m.scoredToday as number) || (m.throughput as number) || scoredCount,
    approved: (m.approved as number) || (m.productsApproved as number) || approvedCount,
    live: (m.live as number) || (m.productsLive as number) || liveCount,
    totalRevenue: (m.totalRevenue as number) || 0,
    modelVersion: (m.modelVersion as string) || 'v1.0',
    stageCountMap,
    agentLastMap: {},
    initialEvents: (pipeline.recentEvents as DashboardData['initialEvents']) || [],
    recentProducts: (m.recentProducts as DashboardData['recentProducts']) || [],
    avgScore: (m.avgScore as number) || 0,
    approvedToday: (m.approvedToday as number) || 0,
    throughput: (m.throughput as number) || stageTotal,
  };
}

// ── Page Component ──

export default async function DashboardPage() {
  let data: DashboardData;
  try {
    data = canUseLocalDb() ? await getDataLocal() : await getDataRemote();
  } catch (e) {
    try { data = await getDataRemote(); } catch {
      data = { totalProducts: 0, scoredToday: 0, approved: 0, live: 0, totalRevenue: 0, modelVersion: '-', stageCountMap: {}, agentLastMap: {}, initialEvents: [], recentProducts: [], avgScore: 0, approvedToday: 0, throughput: 0 };
    }
  }

  const pipelineData = PIPELINE_STAGES.map(ps => {
    let count = 0;
    for (const dbStage of ps.dbStages) count += data.stageCountMap[dbStage] || 0;
    const lastActivity = data.agentLastMap[ps.name] || data.agentLastMap[`${ps.name}-light`] || data.agentLastMap[`${ps.name}-heavy`] || null;
    const isActive = lastActivity ? (Date.now() - new Date(lastActivity).getTime()) < 5 * 60 * 1000 : false;
    return { ...ps, count, lastActivity, isActive };
  });

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#e0e0e0', margin: 0, letterSpacing: '0.03em' }}>
          COMMAND CENTER
        </h1>
        <div style={{ fontSize: '0.7rem', color: '#444', fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>
          Real-time pipeline monitoring &amp; autonomous operations
        </div>
      </div>

      {/* Pipeline Visualization */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, overflowX: 'auto', padding: '16px 8px', position: 'relative' }}>
          {pipelineData.map((stage, idx) => (
            <div key={stage.name} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <div data-stage={stage.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 80, height: 80, clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)', position: 'relative', ...(stage.isActive ? { boxShadow: `0 0 15px ${CYAN}44, 0 0 30px ${CYAN}22` } : {}) }}>
                  <div style={{ position: 'absolute', inset: -1, clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)', background: stage.isActive ? CYAN : '#1a1a22', zIndex: 0 }} />
                  <div style={{ position: 'absolute', inset: 1, clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)', background: stage.isActive ? '#08080c' : '#060608', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    {stage.isActive && (
                      <div style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: '#00ff66', boxShadow: '0 0 6px #00ff6688', zIndex: 2 }} />
                    )}
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: stage.isActive ? CYAN : stage.count === 0 ? '#222' : '#444', fontFamily: "'JetBrains Mono', monospace" }}>
                      {stage.count === 0 ? (
                        <span style={{ fontSize: '0.55rem', opacity: 0.4, letterSpacing: '0.1em', animation: 'pulse-dot 2s ease-in-out infinite' }}>AWAIT</span>
                      ) : stage.count}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: stage.isActive ? CYAN : '#555', letterSpacing: '0.05em', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>
                  {stage.label}
                </div>
                <div style={{ fontSize: '0.55rem', color: stage.isActive ? '#00FFFF88' : '#333', fontFamily: "'JetBrains Mono', monospace" }}>
                  {timeAgo(stage.lastActivity)}
                </div>
              </div>
              {idx < pipelineData.length - 1 && (
                <div style={{ width: 32, height: 2, background: `linear-gradient(90deg, ${CYAN}33, ${CYAN}11)`, position: 'relative' }}>
                  <div style={{ position: 'absolute', right: -4, top: -3, width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: `6px solid ${CYAN}33` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 32 }}>
        <div style={{ flex: '0 0 60%', minWidth: 0 }}>
          <LiveEventFeed initialEvents={data.initialEvents} />
        </div>
        <div style={{ flex: '0 0 calc(40% - 24px)', minWidth: 0 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#555', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            System Metrics
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <MetricCard label="Total Products" value={data.totalProducts} color="#00FFFF" icon={'\u25C8'} />
            <MetricCard label="Avg Score" value={data.avgScore} color={data.avgScore >= 70 ? '#00ff66' : data.avgScore >= 40 ? '#FF6B00' : '#ff3344'} icon={'\u25B2'} />
            <MetricCard label="Approved Today" value={data.approvedToday} color="#00ff66" icon={'\u2713'} />
            <MetricCard label="Scored Today" value={data.throughput} color="#FF6B00" icon={'\u25CF'} />
            <MetricCard label="Revenue" value={`$${data.totalRevenue.toFixed(2)}`} color="#00FFFF" icon="$" />
            <MetricCard label="Model" value={data.modelVersion} color="#8b5cf6" icon={'\u25C6'} />
          </div>
        </div>
      </div>

      {/* Recent Products */}
      <div>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#555', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          Recent Products
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {data.recentProducts.map(p => (
            <a key={p.id} href={`/dashboard/products/${p.id}`} style={{ textDecoration: 'none', color: 'inherit', minWidth: 200, flex: '0 0 auto' }}>
              <div style={{ background: '#08080c', border: '1px solid #1a1a22', borderRadius: 8, padding: '14px 16px', position: 'relative', overflow: 'hidden', transition: 'border-color 0.2s' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${STAGE_COLORS[p.stage] || '#00FFFF'}, transparent)`, opacity: 0.6 }} />
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', fontWeight: 600, color: '#e0e0e0', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.keyword}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.1rem', fontWeight: 700, color: (p.score || 0) >= 70 ? '#00ff66' : (p.score || 0) >= 40 ? '#FF6B00' : (p.score || 0) > 0 ? '#ff3344' : '#333', textShadow: (p.score || 0) >= 70 ? '0 0 10px #00ff6644' : 'none' }}>
                    {p.score?.toFixed(0) || '--'}
                  </span>
                  <span style={{ background: `${STAGE_COLORS[p.stage] || '#333'}22`, color: STAGE_COLORS[p.stage] || '#666', padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textTransform: 'uppercase', border: `1px solid ${STAGE_COLORS[p.stage] || '#333'}44` }}>
                    {p.stage}
                  </span>
                </div>
                <div style={{ fontSize: '0.6rem', color: '#444', fontFamily: "'JetBrains Mono', monospace", marginTop: 8 }}>
                  {p.category || 'uncategorized'} &middot; {new Date(p.created_at).toLocaleDateString()}
                </div>
              </div>
            </a>
          ))}
          {data.recentProducts.length === 0 && (
            <div style={{ color: '#333', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', padding: 20 }}>
              No products discovered yet. Pipeline awaiting activation...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
