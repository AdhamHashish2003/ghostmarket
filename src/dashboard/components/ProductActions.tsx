'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ProductActionsProps {
  productId: string;
}

const ACTIONS = [
  { key: 'approve', label: 'APPROVE', color: '#00ff66', hoverBg: '#00ff6622', borderColor: '#00ff6644' },
  { key: 'skip', label: 'SKIP', color: '#888', hoverBg: '#88888822', borderColor: '#88888844' },
  { key: 'rescore', label: 'RESCORE', color: '#00f0ff', hoverBg: '#00f0ff22', borderColor: '#00f0ff44' },
  { key: 'kill', label: 'KILL', color: '#ff3344', hoverBg: '#ff334422', borderColor: '#ff334444' },
] as const;

export default function ProductActions({ productId }: ProductActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleAction(action: string) {
    setLoading(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/products/${productId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || `Action "${action}" completed`);
        router.refresh();
      } else {
        setMessage(`Error: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : 'Network error'}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
      }}>
        {ACTIONS.map(({ key, label, color, hoverBg, borderColor }) => (
          <button
            key={key}
            disabled={loading !== null}
            onClick={() => handleAction(key)}
            style={{
              background: loading === key ? `${color}33` : hoverBg,
              color: color,
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              padding: '8px 20px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              cursor: loading !== null ? 'not-allowed' : 'pointer',
              opacity: loading !== null && loading !== key ? 0.4 : 1,
              textTransform: 'uppercase',
              position: 'relative',
              overflow: 'hidden',
              transition: 'all 0.2s ease',
              boxShadow: loading === key ? `0 0 12px ${color}44` : 'none',
            }}
          >
            {loading === key ? 'PROCESSING...' : label}
          </button>
        ))}
      </div>
      {message && (
        <div style={{
          marginTop: 10,
          fontSize: '0.75rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: message.startsWith('Error') || message.startsWith('Failed')
            ? '#ff3344' : '#00ff66',
          padding: '6px 12px',
          background: '#0d0d14',
          border: '1px solid #1a1a24',
          borderRadius: 6,
        }}>
          {message}
        </div>
      )}
    </div>
  );
}
