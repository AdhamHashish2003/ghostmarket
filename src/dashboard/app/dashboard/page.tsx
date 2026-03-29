import { getDb } from '@/lib/db';
import PipelineViz from '@/components/PipelineViz';
import EventFeed from '@/components/EventFeed';
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
          Real-time pipeline monitoring & autonomous operations
        </div>
      </div>

      {/* Pipeline Visualization */}
      <PipelineViz />

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
            Live Event Stream
          </div>
          <EventFeed />
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
            <MetricCard label="Products Discovered" value={totalProducts} color="#00f0ff" icon="\u25C8" />
            <MetricCard label="Scored Today" value={scoredToday} color="#ff00aa" icon="\u25B2" />
            <MetricCard label="Approved" value={approved} color="#00ff66" icon="\u2713" />
            <MetricCard label="Live" value={live} color="#00ff66" icon="\u25CF" />
            <MetricCard label="Total Revenue" value={`$${totalRevenue.toFixed(2)}`} color="#ffaa00" icon="$" />
            <MetricCard label="Model Version" value={modelVersion} color="#8b5cf6" icon="\u25C6" />
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
