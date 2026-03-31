'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface EventItem {
  id: string;
  timestamp: string;
  type: 'discovery' | 'scoring' | 'approval' | 'error' | 'info';
  agent: string;
  message: string;
}

const EVENT_COLORS: Record<string, string> = {
  discovery: '#00FFFF',
  scoring: '#FF6B00',
  approval: '#00ff66',
  error: '#ff3344',
  info: '#666666',
};

const MAX_EVENTS = 100;

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function mapEventType(eventType: string): EventItem['type'] {
  if (eventType.includes('error')) return 'error';
  if (eventType.includes('discover') || eventType === 'discovery') return 'discovery';
  if (eventType.includes('scor')) return 'scoring';
  if (eventType.includes('approv')) return 'approval';
  return 'info';
}

export default function EventFeed() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const pollEvents = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('/api/pipeline', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return;
      const data = await res.json();
      const recentEvents: Array<Record<string, unknown>> = Array.isArray(data.recentEvents) ? data.recentEvents : [];

      const newItems: EventItem[] = [];
      for (const evt of recentEvents) {
        const id = String(evt.id || evt.created_at || Math.random());
        if (seenIdsRef.current.has(id)) continue;
        seenIdsRef.current.add(id);

        const eventType = String(evt.event_type || evt.type || '');
        const type = mapEventType(eventType);
        newItems.push({
          id,
          timestamp: String(evt.created_at || evt.timestamp || new Date().toISOString()),
          type,
          agent: String(evt.agent || evt.source || 'system'),
          message: String(evt.message || evt.text || JSON.stringify(evt)),
        });

        // Trigger neural mesh pulse on discovery or approval events
        if ((type === 'discovery' || type === 'approval') && (window as unknown as Record<string, unknown>).__ghostPulse) {
          ((window as unknown as Record<string, unknown>).__ghostPulse as () => void)();
        }
      }

      if (newItems.length > 0) {
        setEvents(prev => {
          const updated = [...newItems.reverse(), ...prev];
          return updated.length > MAX_EVENTS ? updated.slice(0, MAX_EVENTS) : updated;
        });
      }
    } catch {
      // timeout or network error - keep showing whatever we have
    }
  }, []);

  useEffect(() => {
    pollEvents();
    const interval = setInterval(pollEvents, 5000);
    return () => clearInterval(interval);
  }, [pollEvents]);

  // Smooth scroll animation when new events arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  }, [events.length]);

  return (
    <div style={{
      background: '#08080c',
      border: '1px solid #1a1a22',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #1a1a22',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: '0.8rem',
          fontWeight: 'bold',
          color: '#e0e0e0',
          fontFamily: 'monospace',
          letterSpacing: '0.05em',
        }}>
          EVENT FEED
        </span>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: events.length > 0 ? '#00ff66' : '#333',
          display: 'inline-block',
          boxShadow: events.length > 0 ? '0 0 6px #00ff6688' : 'none',
        }} />
      </div>

      <div
        ref={containerRef}
        style={{
          height: 300,
          overflowY: 'auto',
          padding: '4px 0',
          scrollBehavior: 'smooth',
        }}
      >
        {events.length === 0 && (
          <div style={{
            padding: '40px 14px',
            textAlign: 'center',
            color: '#333',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
          }}>
            Waiting for events...
          </div>
        )}

        {events.map(evt => {
          const color = EVENT_COLORS[evt.type] || EVENT_COLORS.info;
          return (
            <div
              key={evt.id}
              style={{
                padding: '3px 14px',
                fontFamily: 'monospace',
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
                [{formatTimestamp(evt.timestamp)}]
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

      <style>{`
        /* Custom scrollbar for the event feed */
        div::-webkit-scrollbar {
          width: 4px;
        }
        div::-webkit-scrollbar-track {
          background: #000000;
        }
        div::-webkit-scrollbar-thumb {
          background: #1a1a22;
          border-radius: 2px;
        }
        div::-webkit-scrollbar-thumb:hover {
          background: #00FFFF44;
        }
      `}</style>
    </div>
  );
}
