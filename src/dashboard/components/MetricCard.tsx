'use client';

import { useEffect, useState, useRef } from 'react';

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
  color = '#00FFFF',
  icon,
}: MetricCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [displayValue, setDisplayValue] = useState<string | number>(typeof value === 'number' ? 0 : value);
  const [isHovered, setIsHovered] = useState(false);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Animated count-up for numeric values
  useEffect(() => {
    if (typeof value !== 'number') {
      setDisplayValue(value);
      return;
    }
    const target = value;
    const duration = 800;
    const start = Date.now();
    const startVal = 0;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (target - startVal) * eased);
      setDisplayValue(current);
      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick);
      }
    }
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [value]);

  const isPositive = typeof change === 'string'
    ? change.startsWith('+') || parseFloat(change) > 0
    : typeof change === 'number' ? change > 0 : false;
  const isNegative = typeof change === 'string'
    ? change.startsWith('-')
    : typeof change === 'number' ? change < 0 : false;
  const changeColor = isPositive ? '#00ff66' : isNegative ? '#ff3344' : '#666';
  const changePrefix = typeof change === 'number' && change > 0 ? '+' : '';

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: '#08080c',
        border: `1px solid ${isHovered ? `${color}55` : '#00FFFF33'}`,
        borderRadius: 8,
        padding: '16px 20px',
        minWidth: 160,
        position: 'relative',
        overflow: 'hidden',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease, border-color 0.3s ease, box-shadow 0.3s ease',
        boxShadow: isHovered ? `0 0 20px ${color}18, 0 0 40px ${color}08` : 'none',
      }}
    >
      {/* Top glow line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        opacity: 0.6,
      }} />
      {/* Background glow */}
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%',
        background: color, opacity: 0.03, filter: 'blur(20px)', pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontSize: '0.7rem', color: '#666', textTransform: 'uppercase',
          letterSpacing: '0.08em', fontFamily: "'JetBrains Mono', monospace",
        }}>
          {label}
        </span>
        {icon && <span style={{ fontSize: '1rem', opacity: 0.4, color }}>{icon}</span>}
      </div>

      <div style={{
        fontSize: '1.6rem', fontWeight: 'bold', color,
        fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.2,
        textShadow: `0 0 20px ${color}44`,
      }}>
        {displayValue}
      </div>

      {change !== undefined && change !== null && (
        <div style={{
          marginTop: 6, fontSize: '0.7rem', color: changeColor,
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 'bold',
        }}>
          {changePrefix}{change}
        </div>
      )}
    </div>
  );
}
