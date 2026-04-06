'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface Trend {
  id: string;
  keyword: string;
  interest_score: number;
  velocity: string;
  source: string;
  related_queries?: unknown;
}

interface TrendNode {
  x: number;
  y: number;
  r: number;
  trend: Trend;
  vel: number;
}

interface Props {
  trends: Trend[];
  onSelectTrend?: (keyword: string) => void;
}

export default function TrendRadar({ trends, onSelectTrend }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<TrendNode[]>([]);
  const [hovered, setHovered] = useState<TrendNode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const sweepRef = useRef(0);
  const rafRef = useRef<number>(0);

  // Layout nodes in spiral from center (highest interest) to edges
  const layoutNodes = useCallback((w: number, h: number) => {
    const sorted = [...trends].sort((a, b) => b.interest_score - a.interest_score);
    const cx = w / 2;
    const cy = h / 2;
    const nodes: TrendNode[] = [];

    for (let i = 0; i < Math.min(sorted.length, 25); i++) {
      const t = sorted[i];
      const vel = parseFloat(t.velocity ?? '0');
      const r = Math.max(16, (t.interest_score / 100) * 36);

      // Spiral layout: highest interest near center
      const angle = i * 2.4; // golden angle in radians
      const dist = i === 0 ? 0 : 30 + Math.sqrt(i) * 42;
      let x = cx + Math.cos(angle) * dist;
      let y = cy + Math.sin(angle) * dist;

      // Clamp to bounds
      x = Math.max(r + 10, Math.min(w - r - 10, x));
      y = Math.max(r + 10, Math.min(h - r - 10, y));

      // Collision avoidance
      for (const existing of nodes) {
        const dx = x - existing.x;
        const dy = y - existing.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const minDist = r + existing.r + 12;
        if (d < minDist && d > 0) {
          const push = (minDist - d) / d;
          x += dx * push * 0.6;
          y += dy * push * 0.6;
          x = Math.max(r + 10, Math.min(w - r - 10, x));
          y = Math.max(r + 10, Math.min(h - r - 10, y));
        }
      }

      nodes.push({ x, y, r, trend: t, vel });
    }

    nodesRef.current = nodes;
  }, [trends]);

  // Draw everything on canvas
  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);

    const nodes = nodesRef.current;

    // Grid lines
    ctx.strokeStyle = 'rgba(39, 39, 42, 0.3)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Radar sweep line
    sweepRef.current = (sweepRef.current + 0.3) % h;
    const sweepY = sweepRef.current;
    const sweepGrad = ctx.createLinearGradient(0, sweepY - 2, 0, sweepY + 2);
    sweepGrad.addColorStop(0, 'transparent');
    sweepGrad.addColorStop(0.5, 'rgba(16, 185, 129, 0.08)');
    sweepGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sweepGrad;
    ctx.fillRect(0, sweepY - 30, w, 60);

    // Connection lines between related nodes
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < Math.min(nodes.length, i + 4); j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 200) {
          ctx.globalAlpha = Math.max(0, 1 - dist / 200) * 0.3;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // Draw nodes
    for (const node of nodes) {
      const isHovered = hovered?.trend.id === node.trend.id;
      const isSelected = selected === node.trend.keyword;
      const pulse = Math.sin(time / 1000 + node.x * 0.01) * 0.15 + 0.85;

      // Glow color based on velocity
      const color = node.vel > 5 ? [16, 185, 129]  // emerald (fast rising)
        : node.vel > 0 ? [6, 182, 212]              // cyan (moderate)
        : [113, 113, 122];                           // gray (declining)

      // Outer glow
      const glowR = node.r * (isHovered ? 2.5 : 1.8) * pulse;
      const glow = ctx.createRadialGradient(node.x, node.y, node.r * 0.5, node.x, node.y, glowR);
      glow.addColorStop(0, `rgba(${color.join(',')}, ${isHovered ? 0.3 : 0.12})`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color.join(',')}, ${isHovered || isSelected ? 0.35 : 0.15})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${color.join(',')}, ${isHovered || isSelected ? 0.8 : 0.4})`;
      ctx.lineWidth = isHovered || isSelected ? 2 : 1;
      ctx.stroke();

      // Label
      const fontSize = Math.max(9, Math.min(12, node.r * 0.55));
      ctx.font = `${fontSize}px ui-monospace, monospace`;
      ctx.fillStyle = isHovered || isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(228,228,231,0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = node.trend.keyword.length > 14 ? node.trend.keyword.slice(0, 13) + '\u2026' : node.trend.keyword;
      ctx.fillText(label, node.x, node.y);
    }

    ctx.restore();
  }, [hovered, selected]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      layoutNodes(rect.width, rect.height);
    };

    resize();
    window.addEventListener('resize', resize);

    const animate = (time: number) => {
      const rect = container.getBoundingClientRect();
      draw(ctx, rect.width, rect.height, time);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [layoutNodes, draw]);

  // Mouse events
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x: e.clientX, y: e.clientY });

    const hit = nodesRef.current.find(n => {
      const dx = n.x - x, dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= n.r + 5;
    });
    setHovered(hit ?? null);
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'default';
  }, []);

  const handleClick = useCallback(() => {
    if (hovered) {
      setSelected(hovered.trend.keyword);
      onSelectTrend?.(hovered.trend.keyword);
    }
  }, [hovered, onSelectTrend]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="relative h-[400px] rounded-2xl bg-[#0a0a0a] border border-zinc-800/40 overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
          onClick={handleClick}
          className="w-full h-full"
        />
      </div>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: mousePos.x + 12, top: mousePos.y - 10 }}
        >
          <div className="bg-zinc-900/95 backdrop-blur border border-zinc-700 rounded-xl px-4 py-3 shadow-2xl min-w-[180px]">
            <p className="text-sm font-semibold text-white mb-1.5">{hovered.trend.keyword}</p>
            <div className="space-y-1 font-mono text-[11px]">
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Interest</span>
                <span className="text-cyan-400 font-bold">{hovered.trend.interest_score}/100</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Velocity</span>
                <span className={hovered.vel > 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {hovered.vel > 0 ? '\u2191' : '\u2193'} {Math.abs(hovered.vel).toFixed(1)}%/h
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Source</span>
                <span className="text-zinc-300">{hovered.trend.source.replace('_', ' ')}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
