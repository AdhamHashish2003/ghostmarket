'use client';

import { useState, useCallback } from 'react';

interface Column {
  key: string;
  label: string;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  render?: (value: any, row: any) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: Array<Record<string, any>>;
  onRowClick?: (row: Record<string, any>, index: number) => void;
  sortable?: boolean;
}

type SortDirection = 'asc' | 'desc' | null;

export default function DataTable({ columns, data, onRowClick, sortable = true }: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  const handleSort = useCallback((key: string) => {
    if (!sortable) return;
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else if (sortDir === 'desc') {
        setSortKey(null);
        setSortDir(null);
      } else {
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortable, sortKey, sortDir]);

  // Sort data
  const sortedData = sortKey && sortDir
    ? [...data].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        let cmp: number;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal;
        } else {
          cmp = String(aVal).localeCompare(String(bVal));
        }
        return sortDir === 'desc' ? -cmp : cmp;
      })
    : data;

  const getSortIndicator = (key: string) => {
    if (!sortable) return null;
    if (sortKey !== key) return <span style={{ color: '#333', marginLeft: 4 }}>{'\u2195'}</span>;
    if (sortDir === 'asc') return <span style={{ color: '#00f0ff', marginLeft: 4 }}>{'\u2191'}</span>;
    if (sortDir === 'desc') return <span style={{ color: '#00f0ff', marginLeft: 4 }}>{'\u2193'}</span>;
    return null;
  };

  return (
    <div style={{
      background: '#111118',
      border: '1px solid #1a1a24',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
        }}>
          <thead>
            <tr style={{
              background: '#0d0d14',
              borderBottom: '1px solid #1a1a24',
            }}>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: '10px 14px',
                    textAlign: (col.align || 'left') as any,
                    color: '#666',
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    cursor: sortable ? 'pointer' : 'default',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    width: col.width,
                    borderBottom: sortKey === col.key ? '2px solid #00f0ff44' : '2px solid transparent',
                    transition: 'border-color 0.2s ease',
                  }}
                >
                  {col.label}
                  {getSortIndicator(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: '30px 14px',
                    textAlign: 'center',
                    color: '#333',
                    fontSize: '0.75rem',
                  }}
                >
                  No data available
                </td>
              </tr>
            )}
            {sortedData.map((row, idx) => {
              const isHovered = hoveredRow === idx;
              const isEven = idx % 2 === 0;

              return (
                <tr
                  key={idx}
                  onClick={() => onRowClick?.(row, idx)}
                  onMouseEnter={() => setHoveredRow(idx)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    background: isHovered
                      ? '#1a1a2488'
                      : isEven
                        ? '#111118'
                        : '#0f0f16',
                    cursor: onRowClick ? 'pointer' : 'default',
                    borderBottom: '1px solid #1a1a2444',
                    transition: 'background 0.15s ease',
                    boxShadow: isHovered ? 'inset 0 0 20px #00f0ff08, 0 0 8px #00f0ff06' : 'none',
                  }}
                >
                  {columns.map(col => {
                    const value = row[col.key];
                    const rendered = col.render ? col.render(value, row) : value;

                    return (
                      <td
                        key={col.key}
                        style={{
                          padding: '8px 14px',
                          textAlign: (col.align || 'left') as any,
                          color: isHovered ? '#e0e0e0' : '#aaa',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: 300,
                          transition: 'color 0.15s ease',
                        }}
                      >
                        {rendered ?? '-'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.length > 0 && (
        <div style={{
          padding: '8px 14px',
          borderTop: '1px solid #1a1a24',
          fontSize: '0.65rem',
          color: '#444',
          fontFamily: 'monospace',
          textAlign: 'right',
        }}>
          {sortedData.length} row{sortedData.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
