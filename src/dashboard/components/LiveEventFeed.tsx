'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SystemEvent {
  id: string;
  agent: string;
  event_type: string;
  severity: string;
  message: string;
  created_at: string;
}

const AGENT_COLORS: Record<string, string> = {
  'scout-light': '#00FFFF',
  'scout-heavy': '#00FFFF',
  'scorer': '#FF6B00',
  'telegram': '#00ff66',
  'builder': '#ffaa00',
  'deployer': '#ffaa00',
  'tracker': '#00FFFF',
  'learner': '#8b5cf6',
  'orchestrator': '#555',
  'llm': '#FF6B00',
};

const SEVERITY_COLORS: Record<string, string> = {
  error: '#ff3344',
  critical: '#ff3344',
  warning: '#FF6B00',
  info: '#00FFFF',
};

const AGENT_TO_STAGE: Record<string, string> = {
  'scout-light': 'scout',
  'scout-heavy': 'scout',
  'sourcer': 'sourcer',
  'scorer': 'scorer',
  'telegram': 'telegram',
  'builder': 'builder',
  'deployer': 'deployer',
  'tracker': 'tracker',
  'learner': 'learner',
};

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return ts; }
}

function getEventColor(evt: SystemEvent): string {
  if (evt.severity === 'error' || evt.severity === 'critical') return SEVERITY_COLORS.error;
  if (evt.severity === 'warning') return SEVERITY_COLORS.warning;
  return AGENT_COLORS[evt.agent] || '#888';
}

interface LiveEventFeedProps {
  initialEvents?: SystemEvent[];
}

export default function LiveEventFeed({ initialEvents = [] }: LiveEventFeedProps) {
  const [events, setEvents] = useState<SystemEvent[]>(initialEvents);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const prevEventIdsRef = useRef<Set<string>>(new Set());

  const pulseStage = useCallback((agent: string) => {
    const stage = AGENT_TO_STAGE[agent];
    if (!stage) return;
    const node = document.querySelector(`[data-stage="${stage}"]`);
    if (node) {
      node.classList.add('pipeline-node-active');
      setTimeout(() => node.classList.remove('pipeline-node-active'), 2000);
    }
    // Also trigger the p5.js neural mesh pulse
    if (typeof window !== 'undefined' && window.__ghostPulse) {
      window.__ghostPulse();
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline');
      if (!res.ok) return;
      const data = await res.json();
      if (data.recentEvents) {
        const newEvents = data.recentEvents as SystemEvent[];
        // Detect truly new events and pulse their pipeline nodes
        const newIds = new Set(newEvents.map((e: SystemEvent) => e.id));
        for (const evt of newEvents) {
          if (!prevEventIdsRef.current.has(evt.id)) {
            pulseStage(evt.agent);
          }
        }
        prevEventIdsRef.current = newIds;
        setEvents(newEvents);
        setLastUpdate(Date.now());
      }
      // Dispatch pipeline stage counts so hex nodes can update
      if (data.stageCounts) {
        window.dispatchEvent(new CustomEvent('pipeline-update', { detail: data.stageCounts }));
      }
    } catch (e) {
      console.warn('[LiveEventFeed] fetch failed:', e);
    }
  }, [pulseStage]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 15000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Tick the "seconds ago" counter
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsAgo(Math.round((Date.now() - lastUpdate) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastUpdate]);

  return (
    <div style={{
      background: 'var(--bg-card, #08080c)',
      border: '1px solid var(--border, #1a1a2e)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border, #1a1a2e)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#00ff66',
            display: 'inline-block',
            boxShadow: '0 0 6px #00ff6688',
            animation: 'pulse-dot 1.5s ease-in-out infinite',
          }} />
          <span style={{
            fontSize: '0.75rem', fontWeight: 700,
            color: '#00FFFF',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}>
            Live Event Stream
          </span>
        </div>
        <span style={{
          fontSize: '0.6rem',
          color: secondsAgo > 20 ? '#ff3344' : '#444',
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        }}>
          {secondsAgo}s ago
        </span>
      </div>

      {/* Event list */}
      <div style={{
        height: 320,
        overflowY: 'auto',
        padding: '4px 0',
      }}>
        {events.length === 0 ? (
          <div style={{
            padding: '40px 14px',
            textAlign: 'center',
            color: '#333',
            fontSize: '0.75rem',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          }}>
            Waiting for events...
          </div>
        ) : events.map((evt, i) => {
          const color = getEventColor(evt);
          return (
            <div
              key={evt.id}
              style={{
                padding: '4px 14px',
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: '0.72rem',
                lineHeight: '1.5',
                borderLeft: `2px solid ${color}`,
                marginBottom: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                animation: i === 0 && !prevEventIdsRef.current.has(evt.id)
                  ? 'slide-up 0.3s ease-out' : 'none',
              }}
            >
              <span style={{ color: '#444' }}>
                [{formatTime(evt.created_at)}]
              </span>
              {' '}
              <span style={{ color, fontWeight: 'bold' }}>
                [{evt.agent}]
              </span>
              {' '}
              <span style={{ color: evt.severity === 'error' ? '#ff3344' : evt.severity === 'warning' ? '#FF6B00' : '#999' }}>
                {evt.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
