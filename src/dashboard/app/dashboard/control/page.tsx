'use client';

import { useState, useEffect, useCallback } from 'react';

interface HealthResult {
  name: string;
  status: 'ok' | 'error' | 'disabled';
  message: string;
  latency_ms?: number;
}

export default function ControlPage() {
  const [health, setHealth] = useState<HealthResult[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [triggerStatus, setTriggerStatus] = useState<Record<string, string>>({});
  const [telegramStatus, setTelegramStatus] = useState<string>('');

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await fetch('/api/control/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data.results || []);
      }
    } catch {
      setHealth([]);
    }
    setHealthLoading(false);
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const triggerAgent = async (agent: string) => {
    setTriggerStatus(prev => ({ ...prev, [agent]: 'running' }));
    try {
      const res = await fetch(`/api/control/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent }),
      });
      if (res.ok) {
        setTriggerStatus(prev => ({ ...prev, [agent]: 'success' }));
      } else {
        setTriggerStatus(prev => ({ ...prev, [agent]: 'error' }));
      }
    } catch {
      setTriggerStatus(prev => ({ ...prev, [agent]: 'error' }));
    }
    setTimeout(() => {
      setTriggerStatus(prev => ({ ...prev, [agent]: '' }));
    }, 3000);
  };

  const testTelegram = async () => {
    setTelegramStatus('sending');
    try {
      const res = await fetch('/api/control/telegram-test', { method: 'POST' });
      setTelegramStatus(res.ok ? 'success' : 'error');
    } catch {
      setTelegramStatus('error');
    }
    setTimeout(() => setTelegramStatus(''), 3000);
  };

  const STATUS_COLORS: Record<string, string> = {
    ok: '#00ff66',
    error: '#ff3344',
    disabled: '#666',
  };

  const agents = ['scout', 'scorer', 'builder', 'learner'];

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
          CONTROL PANEL
        </h1>
        <div style={{
          fontSize: '0.7rem',
          color: '#444',
          fontFamily: "'JetBrains Mono', monospace",
          marginTop: 4,
        }}>
          Service health, manual triggers & system diagnostics
        </div>
      </div>

      {/* Service Health */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}>
          <SectionLabel>Service Health</SectionLabel>
          <button
            onClick={fetchHealth}
            disabled={healthLoading}
            style={{
              background: healthLoading ? '#111118' : '#00f0ff11',
              border: '1px solid #00f0ff44',
              borderRadius: 6,
              padding: '6px 16px',
              color: healthLoading ? '#333' : '#00f0ff',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.7rem',
              fontWeight: 600,
              cursor: healthLoading ? 'default' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {healthLoading ? 'SCANNING...' : 'RUN HEALTH CHECK'}
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 10,
        }}>
          {health.map(h => (
            <div key={h.name} style={{
              background: '#111118',
              border: `1px solid ${STATUS_COLORS[h.status]}33`,
              borderRadius: 8,
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Top glow */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${STATUS_COLORS[h.status]}, transparent)`,
                opacity: 0.4,
              }} />
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}>
                <span style={{
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.8rem',
                  color: '#e0e0e0',
                }}>
                  {h.name}
                </span>
                <span style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: STATUS_COLORS[h.status],
                  display: 'inline-block',
                  boxShadow: h.status === 'ok' ? `0 0 8px ${STATUS_COLORS.ok}88` : 'none',
                }} />
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: '#888',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {h.message}
              </div>
              {h.latency_ms !== undefined && (
                <div style={{
                  fontSize: '0.6rem',
                  color: '#555',
                  fontFamily: "'JetBrains Mono', monospace",
                  marginTop: 4,
                }}>
                  {h.latency_ms}ms latency
                </div>
              )}
            </div>
          ))}
          {health.length === 0 && !healthLoading && (
            <div style={{
              background: '#111118',
              border: '1px solid #1a1a24',
              borderRadius: 8,
              padding: '30px 20px',
              textAlign: 'center',
              color: '#333',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
              gridColumn: '1 / -1',
            }}>
              Click "Run Health Check" to scan services
            </div>
          )}
        </div>
      </div>

      {/* Communication Test */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel>Communication</SectionLabel>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
          gap: 10,
        }}>
          <div style={{
            background: '#111118',
            border: '1px solid #1a1a24',
            borderRadius: 8,
            padding: '16px',
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#e0e0e0',
              marginBottom: 12,
            }}>
              Telegram
            </div>
            <button
              onClick={testTelegram}
              disabled={telegramStatus === 'sending'}
              style={{
                background: telegramStatus === 'success' ? '#00ff6622' :
                  telegramStatus === 'error' ? '#ff334422' : '#ff00aa11',
                border: `1px solid ${
                  telegramStatus === 'success' ? '#00ff6644' :
                  telegramStatus === 'error' ? '#ff334444' : '#ff00aa44'
                }`,
                borderRadius: 6,
                padding: '8px 16px',
                color: telegramStatus === 'success' ? '#00ff66' :
                  telegramStatus === 'error' ? '#ff3344' : '#ff00aa',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: telegramStatus === 'sending' ? 'default' : 'pointer',
                width: '100%',
              }}
            >
              {telegramStatus === 'sending' ? 'SENDING...' :
               telegramStatus === 'success' ? 'SENT OK' :
               telegramStatus === 'error' ? 'FAILED' :
               'SEND TEST MESSAGE'}
            </button>
          </div>
        </div>
      </div>

      {/* Manual Triggers */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel>Manual Agent Triggers</SectionLabel>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10,
        }}>
          {agents.map(agent => {
            const status = triggerStatus[agent] || '';
            const agentColors: Record<string, string> = {
              scout: '#00f0ff',
              scorer: '#ff00aa',
              builder: '#ffaa00',
              learner: '#8b5cf6',
            };
            const color = agentColors[agent] || '#00f0ff';

            return (
              <div key={agent} style={{
                background: '#111118',
                border: `1px solid ${color}33`,
                borderRadius: 8,
                padding: '16px',
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
                  opacity: 0.3,
                }} />
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#e0e0e0',
                  marginBottom: 12,
                  textTransform: 'uppercase',
                }}>
                  {agent}
                </div>
                <button
                  onClick={() => triggerAgent(agent)}
                  disabled={status === 'running'}
                  style={{
                    background: status === 'success' ? '#00ff6622' :
                      status === 'error' ? '#ff334422' :
                      status === 'running' ? `${color}11` : `${color}11`,
                    border: `1px solid ${
                      status === 'success' ? '#00ff6644' :
                      status === 'error' ? '#ff334444' : `${color}44`
                    }`,
                    borderRadius: 6,
                    padding: '8px 16px',
                    color: status === 'success' ? '#00ff66' :
                      status === 'error' ? '#ff3344' : color,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: status === 'running' ? 'default' : 'pointer',
                    width: '100%',
                    transition: 'all 0.2s',
                  }}
                >
                  {status === 'running' ? 'EXECUTING...' :
                   status === 'success' ? 'TRIGGERED OK' :
                   status === 'error' ? 'TRIGGER FAILED' :
                   `TRIGGER ${agent.toUpperCase()}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline Test */}
      <div>
        <SectionLabel>Pipeline Diagnostics</SectionLabel>
        <div style={{
          background: '#111118',
          border: '1px solid #1a1a24',
          borderRadius: 8,
          padding: '20px',
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.75rem',
            color: '#666',
            marginBottom: 12,
          }}>
            Run a complete pipeline health check to verify all stages are operational.
          </div>
          <button
            onClick={fetchHealth}
            style={{
              background: '#00f0ff11',
              border: '1px solid #00f0ff44',
              borderRadius: 6,
              padding: '10px 24px',
              color: '#00f0ff',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            RUN PIPELINE DIAGNOSTICS
          </button>
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
