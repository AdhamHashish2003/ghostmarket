'use client';

import { useEffect, useState, useRef } from 'react';

interface EventItem {
  id: string;
  timestamp: string;
  type: 'discovery' | 'scoring' | 'approval' | 'error' | 'info';
  agent: string;
  message: string;
}

const EVENT_COLORS: Record<string, string> = {
  discovery: '#00f0ff',
  scoring: '#ff00aa',
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

export default function EventFeed() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventIdCounter = useRef(0);

  useEffect(() => {
    // Connect to SSE endpoint
    const connect = () => {
      const es = new EventSource('/api/events');
      eventSourceRef.current = es;

      // SSE sends named events: "event: system_event", so we must use addEventListener
      es.addEventListener('system_event', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          // Map API fields: created_at -> timestamp, event_type -> type
          const eventType = data.event_type || '';
          let type: EventItem['type'] = 'info';
          if (eventType.includes('error')) type = 'error';
          else if (eventType.includes('discover') || eventType === 'discovery') type = 'discovery';
          else if (eventType.includes('scor')) type = 'scoring';
          else if (eventType.includes('approv')) type = 'approval';
          else if (eventType === 'startup' || eventType === 'health_check') type = 'info';

          const newEvent: EventItem = {
            id: data.id || `evt-${++eventIdCounter.current}`,
            timestamp: data.created_at || data.timestamp || new Date().toISOString(),
            type,
            agent: data.agent || data.source || 'system',
            message: data.message || data.text || JSON.stringify(data),
          };

          setEvents(prev => {
            const updated = [newEvent, ...prev];
            if (updated.length > MAX_EVENTS) {
              return updated.slice(0, MAX_EVENTS);
            }
            return updated;
          });

          // Trigger neural mesh pulse on discovery or approval events
          if ((type === 'discovery' || type === 'approval') && window.__ghostPulse) {
            window.__ghostPulse();
          }
        } catch {
          // Ignore malformed events
        }
      });

      es.onerror = () => {
        es.close();
        // Reconnect after 5 seconds
        setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

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
          background: #0a0a0f;
        }
        div::-webkit-scrollbar-thumb {
          background: #1a1a24;
          border-radius: 2px;
        }
        div::-webkit-scrollbar-thumb:hover {
          background: #00f0ff44;
        }
      `}</style>
    </div>
  );
}
