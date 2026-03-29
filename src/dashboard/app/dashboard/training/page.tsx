'use client';

import { useState, useEffect } from 'react';
import NeonChart from '@/components/NeonChart';
import DataTable from '@/components/DataTable';

interface TrainingData {
  llmCallsByTask: Array<{ task_type: string; total_calls: number; avg_tokens_in: number; avg_tokens_out: number; avg_latency_ms?: number }>;
  llmCallsByModel: Array<{ model_used: string; total_calls: number }>;
  labelDistribution: Array<{ outcome_label: string; count: number }>;
  qloraPairs: { total_calls: number; keep_count: number; discard_count: number; flip_count: number };
  qloraPairsByTask: Array<{ task_type: string; total: number; keep: number; discard: number; flip: number }>;
  trainingVersions: Array<unknown>;
  dataQuality: { total_products: number; with_outcome: number; with_score: number; with_breakdown: number };
  signalCoverage: Array<{ signal: string; coverage: number }>;
  recentCalls: Array<{
    task_type: string;
    model_used: string;
    tokens_in: number;
    tokens_out: number;
    latency_ms: number;
    outcome_quality: string;
    created_at: string;
  }>;
}

export default function TrainingPage() {
  const [data, setData] = useState<TrainingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/training');
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch { /* silently fail */ }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{
          color: '#8b5cf6',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.8rem',
        }}>
          Scanning training data matrices...
        </div>
      </div>
    );
  }

  const llmCallsByTask = data?.llmCallsByTask || [];
  const labelDistribution = data?.labelDistribution || [];
  const qloraPairs = data?.qloraPairs;
  const dataQuality = data?.dataQuality;
  const recentLLMCalls = data?.recentCalls || [];

  // Build table counts from dataQuality for the volume grid
  const tableCounts: Array<{ t: string; cnt: number }> = [];
  if (dataQuality) {
    tableCounts.push({ t: 'products', cnt: dataQuality.total_products || 0 });
    tableCounts.push({ t: 'with_outcome', cnt: dataQuality.with_outcome || 0 });
    tableCounts.push({ t: 'with_score', cnt: dataQuality.with_score || 0 });
    tableCounts.push({ t: 'with_breakdown', cnt: dataQuality.with_breakdown || 0 });
  }

  // Build qlora stats from qloraPairs
  const qloraStats: Array<{ outcome_quality: string; cnt: number }> = [];
  if (qloraPairs) {
    if (qloraPairs.keep_count) qloraStats.push({ outcome_quality: 'keep', cnt: qloraPairs.keep_count });
    if (qloraPairs.flip_count) qloraStats.push({ outcome_quality: 'flip', cnt: qloraPairs.flip_count });
    if (qloraPairs.discard_count) qloraStats.push({ outcome_quality: 'discard', cnt: qloraPairs.discard_count });
  }

  // Map llmCallsByTask to the shape the chart/table expects
  const llmCallStats = llmCallsByTask.map(l => ({
    task_type: l.task_type,
    cnt: l.total_calls,
    avg_latency: l.avg_latency_ms || 0,
  }));

  const trainingExportCount = qloraPairs?.total_calls || 0;

  // LLM Calls by task type chart
  const llmChartData = {
    labels: llmCallStats.map(l => l.task_type),
    datasets: [{
      label: 'Call Count',
      data: llmCallStats.map(l => l.cnt),
      borderColor: '#00f0ff',
    }],
  };

  // Label distribution doughnut
  const labelColors: Record<string, string> = { win: '#00ff66', loss: '#ff3344', breakeven: '#ffaa00' };
  const labelChartData = {
    labels: labelDistribution.map(l => l.outcome_label),
    datasets: [{
      data: labelDistribution.map(l => l.count),
      backgroundColor: labelDistribution.map(l => labelColors[l.outcome_label] || '#666'),
      borderColor: '#111118',
    }],
  };

  // Recent LLM calls table columns
  const llmColumns = [
    {
      key: 'task_type',
      label: 'Task',
      render: (val: string) => (
        <span style={{ color: '#00f0ff', fontWeight: 600 }}>{val}</span>
      ),
    },
    {
      key: 'model_used',
      label: 'Model',
      render: (val: string) => (
        <span style={{ color: '#888' }}>{val?.split('/').pop() || '-'}</span>
      ),
    },
    {
      key: 'tokens',
      label: 'Tokens',
      align: 'center' as const,
      render: (_: unknown, row: Record<string, unknown>) => (
        <span style={{ color: '#aaa' }}>
          {((Number(row.tokens_in) || 0) + (Number(row.tokens_out) || 0)).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'latency_ms',
      label: 'Latency',
      align: 'center' as const,
      render: (val: number) => (
        <span style={{
          color: val > 5000 ? '#ff3344' : val > 2000 ? '#ffaa00' : '#00ff66',
        }}>
          {val ? `${val}ms` : '-'}
        </span>
      ),
    },
    {
      key: 'outcome_quality',
      label: 'Quality',
      align: 'center' as const,
      render: (val: string) => {
        const colors: Record<string, string> = { keep: '#00ff66', flip: '#ffaa00', discard: '#ff3344' };
        return (
          <span style={{
            color: colors[val] || '#555',
            fontWeight: val ? 600 : 400,
            fontSize: '0.7rem',
            textTransform: 'uppercase',
          }}>
            {val || '--'}
          </span>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Time',
      align: 'right' as const,
      render: (val: string) => (
        <span style={{ color: '#555', fontSize: '0.65rem' }}>
          {val ? new Date(val).toLocaleString() : '-'}
        </span>
      ),
    },
  ];

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
          Data pipeline volumes, LLM usage & quality metrics
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
          {tableCounts.map(t => (
            <div key={t.t} style={{
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
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                background: 'linear-gradient(90deg, transparent, #00f0ff44, transparent)',
              }} />
              <div style={{
                fontSize: '1.2rem',
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#00f0ff',
                textShadow: '0 0 10px #00f0ff33',
              }}>
                {t.cnt.toLocaleString()}
              </div>
              <div style={{
                fontSize: '0.6rem',
                color: '#666',
                fontFamily: "'JetBrains Mono', monospace",
                marginTop: 4,
              }}>
                {t.t}
              </div>
            </div>
          ))}
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
              top: 0,
              left: 0,
              right: 0,
              height: 2,
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
              {trainingExportCount.toLocaleString()}
            </div>
            <div style={{
              fontSize: '0.6rem',
              color: '#666',
              fontFamily: "'JetBrains Mono', monospace",
              marginTop: 4,
            }}>
              training_export
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 28 }}>
        <div>
          <SectionLabel>LLM Calls by Task Type</SectionLabel>
          {llmCallStats.length > 0 ? (
            <NeonChart type="bar" data={llmChartData} />
          ) : (
            <EmptyState>No LLM call data yet</EmptyState>
          )}
        </div>
        <div>
          <SectionLabel>Label Distribution</SectionLabel>
          {labelDistribution.length > 0 ? (
            <NeonChart type="doughnut" data={labelChartData} />
          ) : (
            <EmptyState>No labeled data yet</EmptyState>
          )}
        </div>
      </div>

      {/* QLoRA Data Quality */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel>QLoRA Training Data Quality</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {qloraStats.map(q => {
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
          })}
          {qloraStats.length === 0 && <EmptyState>No quality labels yet</EmptyState>}
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
              {llmCallStats.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1a1a2444' }}>
                  <td style={{ padding: '8px 14px', color: '#00f0ff' }}>{l.task_type}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'center', color: '#aaa' }}>{l.cnt}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'center', color: '#888' }}>
                    {l.avg_latency ? `${l.avg_latency.toFixed(0)}ms` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            transition: 'border-color 0.2s',
          }}
        >
          DOWNLOAD TRAINING EXPORT (JSONL)
        </a>
      </div>

      {/* Recent LLM Calls */}
      <div>
        <SectionLabel>Recent LLM Calls</SectionLabel>
        <DataTable columns={llmColumns} data={recentLLMCalls} sortable />
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}
