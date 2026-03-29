'use client';

import { useState, useEffect } from 'react';
import NeonChart from '@/components/NeonChart';

interface LearningData {
  cycles: Array<{
    id: number;
    cycle_type: string;
    model_version_after: string;
    accuracy_before: number;
    accuracy_after: number;
    training_samples: number;
    deployed: boolean;
    created_at: string;
  }>;
  featureImportance: Array<{ feature: string; importance: number }> | null;
  sourceHitRates: Array<{ source: string; total: number; wins: number }> | null;
  strategyReflection: string | null;
  labelDistribution: Array<{ outcome_label: string; count: number }>;
  accuracyTrend: Array<{ date: string; accuracy: number }>;
  samplesTrend: Array<{ date: string; samples: number }>;
}

export default function LearningPage() {
  const [data, setData] = useState<LearningData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch('/api/learning', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch {
        // timeout or network error - keep showing whatever we have
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{
          color: '#00f0ff',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.8rem',
        }}>
          Loading neural learning data...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{
          color: '#555',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.8rem',
        }}>
          Unable to load learning data. Will retry on next visit.
        </div>
      </div>
    );
  }

  const cycles = data?.cycles || [];
  const sourceRates = data?.sourceHitRates || [];
  const featureImportance = data?.featureImportance || [];
  const labelDistribution = data?.labelDistribution || [];
  const labeledCount = labelDistribution.reduce((sum, l) => sum + (l.count || 0), 0);
  const qloraPairs = 0; // Not provided by /api/learning

  // Accuracy over time chart data
  const accuracyData = {
    labels: cycles.filter(c => c.accuracy_after).map(c => new Date(c.created_at).toLocaleDateString()),
    datasets: [
      {
        label: 'Accuracy',
        data: cycles.filter(c => c.accuracy_after).map(c => c.accuracy_after * 100),
        borderColor: '#00f0ff',
      },
    ],
  };

  // Feature importance chart
  const featureData = {
    labels: featureImportance.map(f => f.feature.replace(/_/g, ' ')),
    datasets: [
      {
        label: 'Importance',
        data: featureImportance.map(f => f.importance),
        backgroundColor: featureImportance.map((_, i) => {
          const colors = ['#00f0ff', '#ff00aa', '#00ff66', '#ffaa00', '#8b5cf6', '#ff3344', '#06b6d4'];
          return colors[i % colors.length] + '88';
        }),
        borderColor: featureImportance.map((_, i) => {
          const colors = ['#00f0ff', '#ff00aa', '#00ff66', '#ffaa00', '#8b5cf6', '#ff3344', '#06b6d4'];
          return colors[i % colors.length];
        }),
      },
    ],
  };

  // Source hit rates chart
  const sourceData = {
    labels: sourceRates.map(s => s.source),
    datasets: [
      {
        label: 'Win Rate %',
        data: sourceRates.map(s => s.total > 0 ? (s.wins / s.total * 100) : 0),
        backgroundColor: sourceRates.map(s => {
          const rate = s.total > 0 ? (s.wins / s.total * 100) : 0;
          return rate > 40 ? '#00ff6688' : rate > 20 ? '#ffaa0088' : '#ff334488';
        }),
        borderColor: sourceRates.map(s => {
          const rate = s.total > 0 ? (s.wins / s.total * 100) : 0;
          return rate > 40 ? '#00ff66' : rate > 20 ? '#ffaa00' : '#ff3344';
        }),
      },
    ],
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
          LEARNING ENGINE
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          Model training, feature analysis & strategy evolution
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

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
        <div>
          <SectionLabel>Model Accuracy Over Time</SectionLabel>
          {accuracyData.labels.length > 0 ? (
            <NeonChart type="line" data={accuracyData} options={{ scales: { y: { min: 0, max: 100 } } }} />
          ) : (
            <EmptyState>No accuracy data yet</EmptyState>
          )}
        </div>
        <div>
          <SectionLabel>Feature Importance</SectionLabel>
          {featureData.labels.length > 0 ? (
            <NeonChart
              type="bar"
              data={featureData}
              options={{ indexAxis: 'y' }}
            />
          ) : (
            <EmptyState>No feature importance data yet</EmptyState>
          )}
        </div>
      </div>

      {/* Source Hit Rates */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel>Source Hit Rates</SectionLabel>
        {sourceData.labels.length > 0 ? (
          <NeonChart type="bar" data={sourceData} />
        ) : (
          <EmptyState>No labeled data available for source analysis</EmptyState>
        )}
      </div>

      {/* Strategy Reflection */}
      {data?.strategyReflection && (
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
            {data.strategyReflection}
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
        top: 0,
        left: 0,
        right: 0,
        height: 2,
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: '#111118',
      border: '1px solid #1a1a24',
      borderRadius: 8,
      padding: '40px 20px',
      textAlign: 'center',
      color: '#333',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '0.75rem',
    }}>
      {children}
    </div>
  );
}
