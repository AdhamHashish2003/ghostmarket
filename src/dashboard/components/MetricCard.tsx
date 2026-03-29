'use client';

import { useEffect, useState } from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: string | number;
  color?: string;
  icon?: string;
}

export default function MetricCard({
  label,
  value,
  change,
  color = '#00f0ff',
  icon,
}: MetricCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Animate value changes
  useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  const isPositive = typeof change === 'string'
    ? change.startsWith('+') || change.startsWith('$') || parseFloat(change) > 0
    : typeof change === 'number'
      ? change > 0
      : false;

  const isNegative = typeof change === 'string'
    ? change.startsWith('-')
    : typeof change === 'number'
      ? change < 0
      : false;

  const changeColor = isPositive ? '#00ff66' : isNegative ? '#ff3344' : '#666';
  const changePrefix = typeof change === 'number' && change > 0 ? '+' : '';

  return (
    <div
      style={{
        background: '#111118',
        border: '1px solid #1a1a24',
        borderRadius: 8,
        padding: '16px 20px',
        minWidth: 160,
        position: 'relative',
        overflow: 'hidden',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      {/* Top glow line */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        opacity: 0.6,
      }} />

      {/* Background glow */}
      <div style={{
        position: 'absolute',
        top: -20,
        right: -20,
        width: 80,
        height: 80,
        borderRadius: '50%',
        background: color,
        opacity: 0.03,
        filter: 'blur(20px)',
        pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: '0.7rem',
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontFamily: 'monospace',
        }}>
          {label}
        </span>
        {icon && (
          <span style={{ fontSize: '1rem', opacity: 0.6 }}>
            {icon}
          </span>
        )}
      </div>

      <div style={{
        fontSize: '1.6rem',
        fontWeight: 'bold',
        color,
        fontFamily: 'monospace',
        lineHeight: 1.2,
        textShadow: `0 0 20px ${color}44`,
      }}>
        {displayValue}
      </div>

      {change !== undefined && change !== null && (
        <div style={{
          marginTop: 6,
          fontSize: '0.7rem',
          color: changeColor,
          fontFamily: 'monospace',
          fontWeight: 'bold',
        }}>
          {changePrefix}{change}
        </div>
      )}
    </div>
  );
}
