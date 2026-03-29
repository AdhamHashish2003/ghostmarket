'use client';

import { useState, useEffect, useCallback } from 'react';
import NeonChart from '@/components/NeonChart';
import DataTable from '@/components/DataTable';

const AGENTS = [
  'orchestrator', 'scout-light', 'scout-heavy', 'sourcer',
  'scorer', 'builder', 'deployer', 'tracker',
  'learner', 'telegram', 'image-proc', 'llm', 'rog-worker',
];

interface AgentStatus {
  agent: string;
  last_seen: string;
  last_event: string;
  last_severity: string;
}

interface ErrorEvent {
  agent: string;
  event_type: string;
  severity: string;
  message: string;
  created_at: string;
}

interface SystemData {
  agents: AgentStatus[];
  recentErrors: ErrorEvent[];
  eventCounts: Array<{ event_type: string; cnt: number }>;
  dbSize: string;
  eventRate: Array<{ hour: string; count: number }>;
}

export default function SystemPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/system');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch { /* silently fail */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{
          color: '#00f0ff',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.8rem',
        }}>
          Probing system neural pathways...
        </div>
      </div>
    );
  }

  const agents = data?.agents || [];
  const recentErrors = data?.recentErrors || [];
  const eventCounts = data?.eventCounts || [];
  const dbSize = data?.dbSize || 'N/A';
  const eventRate = data?.eventRate || [];

  // Event rate chart
  const eventRateData = {
    labels: eventRate.map(e => e.hour),
    datasets: [{
      label: 'Events/Hour',
      data: eventRate.map(e => e.count),
      borderColor: '#00f0ff',
      fill: true,
    }],
  };

  // Error table columns
  const errorColumns = [
    {
      key: 'created_at',
      label: 'Time',
      render: (val: string) => (
        <span style={{ color: '#666', fontSize: '0.65rem' }}>
          {val ? new Date(val).toLocaleString() : '-'}
        </span>
      ),
    },
    {
      key: 'severity',
      label: 'Severity',
      align: 'center' as const,
      render: (val: string) => {
        const colors: Record<string, string> = {
          info: '#00f0ff', warning: '#ffaa00', error: '#ff3344', critical: '#ff3344',
        };
        return (
          <span style={{
            background: `${colors[val] || '#666'}22`,
            color: colors[val] || '#666',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: '0.65rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            border: `1px solid ${colors[val] || '#666'}44`,
          }}>
            {val}
          </span>
        );
      },
    },
    {
      key: 'agent',
      label: 'Agent',
      render: (val: string) => (
        <span style={{ color: '#ff00aa', fontWeight: 600 }}>{val}</span>
      ),
    },
    {
      key: 'message',
      label: 'Message',
      render: (val: string) => (
        <span style={{ color: '#aaa' }}>{val}</span>
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
          SYSTEM STATUS
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          Agent health monitoring, error tracking & diagnostics
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
          {AGENTS.map(agentName => {
            const status = agents.find(a => a.agent === agentName);
            const isRecent = status ? (Date.now() - new Date(status.last_seen).getTime()) < 3600000 : false;
            const isStale = status ? (Date.now() - new Date(status.last_seen).getTime()) > 3600000 : false;

            let dotColor = '#333';
            let borderColor = '#1a1a24';
            if (isRecent) { dotColor = '#00ff66'; borderColor = '#00ff6633'; }
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
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: `linear-gradient(90deg, transparent, #00ff66, transparent)`,
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
                      <span style={{ color: '#666' }}>{status.last_event}</span>
                      <span style={{ color: '#333' }}> &middot; </span>
                      <span>{new Date(status.last_seen).toLocaleTimeString()}</span>
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

      {/* DB Size + Event Distribution */}
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

          {/* Event Type Counts */}
          <div style={{ marginTop: 12 }}>
            {eventCounts.slice(0, 8).map(e => (
              <div key={e.event_type} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 10px',
                borderBottom: '1px solid #1a1a2444',
                fontSize: '0.7rem',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                <span style={{ color: '#888' }}>{e.event_type}</span>
                <span style={{ color: '#00f0ff', fontWeight: 600 }}>{e.cnt}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Event Rate Over Time</SectionLabel>
          {eventRate.length > 0 ? (
            <NeonChart type="line" data={eventRateData} />
          ) : (
            <EmptyState>No event rate data available</EmptyState>
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
          <DataTable columns={errorColumns} data={recentErrors} sortable />
        ) : (
          <EmptyState>No errors recorded. System operating within parameters.</EmptyState>
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
