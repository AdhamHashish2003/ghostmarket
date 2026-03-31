'use client';
import { useState, useEffect } from 'react';

interface Integration { name: string; status: 'ok' | 'error' | 'disabled'; message: string; latency_ms?: number; }

export default function KeysPage() {
  const [results, setResults] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [ts, setTs] = useState('');

  const runCheck = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/control/health');
      const data = await resp.json();
      setResults(data.results || []);
      setTs(data.timestamp || '');
    } catch { setResults([]); }
    setLoading(false);
  };

  useEffect(() => { runCheck(); }, []);

  const ok = results.filter(r => r.status === 'ok').length;
  const err = results.filter(r => r.status === 'error').length;
  const dis = results.filter(r => r.status === 'disabled').length;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>API Key Validation</h1>
      <p style={{ color: '#888', marginBottom: 16, fontSize: '0.85rem' }}>
        Tests every integration. Last run: {ts ? new Date(ts).toLocaleString() : 'never'}
      </p>
      <button onClick={runCheck} disabled={loading} style={{
        padding: '8px 24px', background: '#3b82f6', color: '#fff', border: 'none',
        borderRadius: 6, cursor: 'pointer', marginBottom: 24, opacity: loading ? 0.5 : 1,
      }}>{loading ? 'Testing all integrations...' : 'Re-run All Tests'}</button>

      <div style={{ marginBottom: 24, display: 'flex', gap: 16 }}>
        <span style={{ color: '#22c55e', fontWeight: 'bold' }}>✓ {ok} working</span>
        <span style={{ color: '#ef4444', fontWeight: 'bold' }}>✗ {err} failed</span>
        <span style={{ color: '#6b7280' }}>— {dis} disabled</span>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {results.map(r => (
          <div key={r.name} style={{
            background: '#1a1a22', padding: 16, borderRadius: 8, display: 'flex',
            alignItems: 'center', gap: 16,
            borderLeft: `4px solid ${r.status === 'ok' ? '#22c55e' : r.status === 'error' ? '#ef4444' : '#6b7280'}`,
          }}>
            <span style={{ fontSize: '1.5rem', width: 32, textAlign: 'center' }}>
              {r.status === 'ok' ? '✅' : r.status === 'error' ? '❌' : '⬜'}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold' }}>{r.name}</div>
              <div style={{ fontSize: '0.8rem', color: r.status === 'error' ? '#fca5a5' : '#888' }}>{r.message}</div>
            </div>
            {r.latency_ms !== undefined && (
              <div style={{ fontSize: '0.75rem', color: '#555' }}>{r.latency_ms}ms</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
