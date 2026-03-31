'use client';
import { useState, useEffect, useCallback } from 'react';

interface Integration { name: string; status: 'ok' | 'error' | 'disabled'; message: string; latency_ms?: number; }
interface TableInfo { table: string; rows: number; }
interface ErrorEvent { agent: string; severity: string; message: string; created_at: string; }
interface FileEntry { name: string; isDir: boolean; size: number; }

const STATUS_COLORS = { ok: '#22c55e', error: '#ef4444', disabled: '#6b7280' };

export default function ControlPanel() {
  const [tab, setTab] = useState<'health' | 'db' | 'files' | 'errors'>('health');
  const [health, setHealth] = useState<Integration[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [tableRows, setTableRows] = useState<unknown[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [filePath, setFilePath] = useState('');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileType, setFileType] = useState<'directory' | 'file'>('directory');

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const resp = await fetch('/api/control/health');
      const data = await resp.json();
      setHealth(data.results || []);
    } catch { setHealth([]); }
    setHealthLoading(false);
  }, []);

  const fetchTables = useCallback(async () => {
    try {
      const resp = await fetch('/api/control/db');
      const data = await resp.json();
      setTables(data.tables || []);
    } catch { /* ignore */ }
  }, []);

  const fetchTableData = async (table: string) => {
    setSelectedTable(table);
    try {
      const resp = await fetch(`/api/control/db?table=${table}&limit=30`);
      const data = await resp.json();
      setTableRows(data.rows || []);
      setTableTotal(data.total || 0);
    } catch { setTableRows([]); }
  };

  const fetchErrors = useCallback(async () => {
    try {
      const resp = await fetch('/api/control/errors');
      const data = await resp.json();
      setErrors(data.errors || []);
    } catch { /* ignore */ }
  }, []);

  const fetchFile = async (p: string) => {
    setFilePath(p);
    try {
      const resp = await fetch(`/api/control/files?path=${encodeURIComponent(p)}`);
      const data = await resp.json();
      if (data.type === 'directory') {
        setFileType('directory');
        setFileEntries(data.entries || []);
        setFileContent(null);
      } else {
        setFileType('file');
        setFileContent(data.content || '');
        setFileEntries([]);
      }
    } catch { setFileContent('Error loading file'); }
  };

  useEffect(() => {
    fetchHealth();
    fetchTables();
    fetchErrors();
    fetchFile('');
  }, [fetchHealth, fetchTables, fetchErrors]);

  // Auto-refresh errors every 10s
  useEffect(() => {
    const id = setInterval(fetchErrors, 10000);
    return () => clearInterval(id);
  }, [fetchErrors]);

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>Control Panel</h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {(['health', 'db', 'files', 'errors'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', background: tab === t ? '#333' : '#1a1a22',
            color: tab === t ? '#fff' : '#888', border: '1px solid #333',
            borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', textTransform: 'capitalize',
          }}>{t}{t === 'errors' && errors.length > 0 ? ` (${errors.length})` : ''}</button>
        ))}
      </div>

      {/* Health Tab */}
      {tab === 'health' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <button onClick={fetchHealth} disabled={healthLoading} style={{
              padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none',
              borderRadius: 6, cursor: 'pointer', opacity: healthLoading ? 0.5 : 1,
            }}>{healthLoading ? 'Testing...' : 'Run Health Check'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {health.map(h => (
              <div key={h.name} style={{
                background: '#1a1a22', padding: 16, borderRadius: 8,
                borderLeft: `4px solid ${STATUS_COLORS[h.status]}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold' }}>{h.name}</span>
                  <span style={{ color: STATUS_COLORS[h.status], fontSize: '1.2rem' }}>
                    {h.status === 'ok' ? '✓' : h.status === 'error' ? '✗' : '—'}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#888', marginTop: 4 }}>{h.message}</div>
                {h.latency_ms !== undefined && (
                  <div style={{ fontSize: '0.75rem', color: '#555', marginTop: 2 }}>{h.latency_ms}ms</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Database Tab */}
      {tab === 'db' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {tables.map(t => (
              <button key={t.table} onClick={() => fetchTableData(t.table)} style={{
                padding: '6px 14px', background: selectedTable === t.table ? '#3b82f6' : '#1a1a22',
                color: selectedTable === t.table ? '#fff' : '#aaa', border: '1px solid #333',
                borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem',
              }}>{t.table} <span style={{ color: '#666' }}>({t.rows})</span></button>
            ))}
          </div>
          {selectedTable && (
            <div>
              <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: 8 }}>{selectedTable}: {tableTotal} total rows (showing 30)</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  {tableRows.length > 0 && (
                    <thead>
                      <tr style={{ borderBottom: '1px solid #333' }}>
                        {Object.keys(tableRows[0] as Record<string, unknown>).map(k => (
                          <th key={k} style={{ padding: 6, textAlign: 'left', color: '#888', whiteSpace: 'nowrap' }}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {tableRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a1a22' }}>
                        {Object.values(row as Record<string, unknown>).map((v, j) => (
                          <td key={j} style={{ padding: 6, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v === null ? <span style={{ color: '#555' }}>null</span> : String(v).slice(0, 100)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* File Browser Tab */}
      {tab === 'files' && (
        <div>
          <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: 8 }}>
            <span style={{ cursor: 'pointer', color: '#60a5fa' }} onClick={() => fetchFile('')}>root</span>
            {filePath && filePath.split('/').map((part, i, arr) => (
              <span key={i}>
                {' / '}
                <span style={{ cursor: 'pointer', color: '#60a5fa' }}
                  onClick={() => fetchFile(arr.slice(0, i + 1).join('/'))}>{part}</span>
              </span>
            ))}
          </div>
          {fileType === 'directory' && (
            <div>
              {fileEntries.map(e => (
                <div key={e.name} onClick={() => fetchFile(filePath ? `${filePath}/${e.name}` : e.name)}
                  style={{ padding: '6px 12px', cursor: 'pointer', borderBottom: '1px solid #1a1a22', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{e.isDir ? '📁 ' : '📄 '}{e.name}</span>
                  {!e.isDir && <span style={{ color: '#555' }}>{(e.size / 1024).toFixed(1)}KB</span>}
                </div>
              ))}
            </div>
          )}
          {fileType === 'file' && fileContent !== null && (
            <pre style={{ background: '#111', padding: 16, borderRadius: 8, overflow: 'auto', maxHeight: 600, fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {fileContent}
            </pre>
          )}
        </div>
      )}

      {/* Errors Tab */}
      {tab === 'errors' && (
        <div>
          <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: 12 }}>Auto-refreshing every 10s · {errors.length} errors/warnings</div>
          {errors.map((e, i) => (
            <div key={i} style={{
              background: '#1a1a22', padding: 10, borderRadius: 6, marginBottom: 4, fontSize: '0.8rem',
              borderLeft: `3px solid ${e.severity === 'error' || e.severity === 'critical' ? '#ef4444' : '#f59e0b'}`,
            }}>
              <span style={{ color: '#888' }}>[{e.agent}]</span> {e.message}
              <span style={{ float: 'right', color: '#555', fontSize: '0.7rem' }}>
                {new Date(e.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {errors.length === 0 && <div style={{ color: '#666' }}>No errors recorded</div>}
        </div>
      )}
    </div>
  );
}
