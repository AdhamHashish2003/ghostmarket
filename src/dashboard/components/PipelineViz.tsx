'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface StageData {
  name: string;
  label: string;
  count: number;
  lastActivity: string | null;
}

interface Particle {
  id: number;
  fromIndex: number;
  toIndex: number;
  progress: number; // 0 to 1
  startTime: number;
}

const STAGES = [
  { name: 'scout', label: 'SCOUT' },
  { name: 'sourcer', label: 'SOURCER' },
  { name: 'scorer', label: 'SCORER' },
  { name: 'telegram', label: 'TELEGRAM' },
  { name: 'builder', label: 'BUILDER' },
  { name: 'deployer', label: 'DEPLOYER' },
  { name: 'tracker', label: 'TRACKER' },
  { name: 'learner', label: 'LEARNER' },
];

// Map DB pipeline stages to visualization stages
const STAGE_MAP: Record<string, string> = {
  discovered: 'scout',
  sourced: 'sourcer',
  scored: 'scorer',
  approved: 'telegram',
  building: 'builder',
  deploying: 'deployer',
  deployed: 'deployer',
  live: 'tracker',
  tracking: 'tracker',
  completed: 'learner',
};

const CYAN = '#00f0ff';
const MAGENTA = '#ff00aa';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '--';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isActive(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return Date.now() - new Date(dateStr).getTime() < 5 * 60 * 1000;
}

function HexShape({ active, children, label, count, lastActivity }: {
  active: boolean;
  children?: React.ReactNode;
  label: string;
  count: number;
  lastActivity: string | null;
}) {
  const glowStyle = active
    ? { boxShadow: `0 0 15px ${CYAN}44, 0 0 30px ${CYAN}22, inset 0 0 15px ${CYAN}11` }
    : {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div
        style={{
          width: 80,
          height: 80,
          clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          background: active ? '#111118' : '#0d0d14',
          border: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          ...glowStyle,
        }}
      >
        {/* Hex outline via an outer clip-path wrapper */}
        <div style={{
          position: 'absolute',
          inset: -1,
          clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          background: active ? CYAN : '#1a1a24',
          zIndex: 0,
        }} />
        <div style={{
          position: 'absolute',
          inset: 1,
          clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          background: active ? '#111118' : '#0d0d14',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            fontSize: '1.2rem',
            fontWeight: 'bold',
            color: active ? CYAN : '#444',
            fontFamily: 'monospace',
          }}>
            {count}
          </div>
        </div>
      </div>
      <div style={{
        fontSize: '0.65rem',
        fontWeight: 'bold',
        color: active ? CYAN : '#555',
        letterSpacing: '0.05em',
        fontFamily: 'monospace',
        textAlign: 'center',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.55rem',
        color: active ? '#00f0ff88' : '#333',
        fontFamily: 'monospace',
      }}>
        {timeAgo(lastActivity)}
      </div>
      {children}
    </div>
  );
}

export default function PipelineViz() {
  const [stages, setStages] = useState<StageData[]>(
    STAGES.map(s => ({ ...s, count: 0, lastActivity: null }))
  );
  const [particles, setParticles] = useState<Particle[]>([]);
  const particleIdRef = useRef(0);
  const prevCountsRef = useRef<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline');
      if (!res.ok) return;
      const data = await res.json();

      // API returns { stageCounts: [{stage, count}], lastActivity: [{stage, last_activity}], ... }
      const stageInfo: Record<string, { count: number; lastActivity: string | null }> = {};

      // Map stageCounts array into stageInfo
      const stageCounts = Array.isArray(data.stageCounts) ? data.stageCounts : [];
      for (const item of stageCounts) {
        const vizStage = STAGE_MAP[item.stage] || item.stage;
        if (!stageInfo[vizStage]) {
          stageInfo[vizStage] = { count: 0, lastActivity: null };
        }
        stageInfo[vizStage].count += item.count || 0;
      }

      // Map lastActivity array into stageInfo
      const lastActivity = Array.isArray(data.lastActivity) ? data.lastActivity : [];
      for (const item of lastActivity) {
        const vizStage = STAGE_MAP[item.stage] || item.stage;
        if (!stageInfo[vizStage]) {
          stageInfo[vizStage] = { count: 0, lastActivity: null };
        }
        const act = item.last_activity || item.lastActivity;
        if (act) {
          if (!stageInfo[vizStage].lastActivity ||
              new Date(act) > new Date(stageInfo[vizStage].lastActivity!)) {
            stageInfo[vizStage].lastActivity = act;
          }
        }
      }

      // Detect count changes and spawn particles
      const newCounts: Record<string, number> = {};
      STAGES.forEach((s, idx) => {
        const count = stageInfo[s.name]?.count || 0;
        newCounts[s.name] = count;
        const prevCount = prevCountsRef.current[s.name] || 0;
        if (count > prevCount && idx > 0) {
          // Spawn particle from previous stage to this one
          const newId = ++particleIdRef.current;
          setParticles(prev => [...prev, {
            id: newId,
            fromIndex: idx - 1,
            toIndex: idx,
            progress: 0,
            startTime: Date.now(),
          }]);
        }
      });
      prevCountsRef.current = newCounts;

      setStages(
        STAGES.map(s => ({
          ...s,
          count: stageInfo[s.name]?.count || 0,
          lastActivity: stageInfo[s.name]?.lastActivity || null,
        }))
      );
    } catch {
      // silently fail
    }
  }, []);

  // Polling
  useEffect(() => {
    fetchPipeline();
    const interval = setInterval(fetchPipeline, 3000);
    return () => clearInterval(interval);
  }, [fetchPipeline]);

  // Animate particles
  useEffect(() => {
    const PARTICLE_DURATION = 800; // ms

    const animate = () => {
      setParticles(prev => {
        const now = Date.now();
        return prev
          .map(p => ({
            ...p,
            progress: Math.min(1, (now - p.startTime) / PARTICLE_DURATION),
          }))
          .filter(p => p.progress < 1);
      });
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // Compute node positions for particle rendering
  const NODE_WIDTH = 80;
  const NODE_GAP = 32;
  const TOTAL_PER_NODE = NODE_WIDTH + NODE_GAP;

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: NODE_GAP,
          overflowX: 'auto',
          padding: '16px 8px',
          position: 'relative',
        }}
      >
        {stages.map((stage, idx) => (
          <div key={stage.name} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <HexShape
              active={isActive(stage.lastActivity)}
              label={stage.label}
              count={stage.count}
              lastActivity={stage.lastActivity}
            />
            {idx < stages.length - 1 && (
              <div style={{
                width: NODE_GAP,
                height: 2,
                background: `linear-gradient(90deg, ${CYAN}33, ${CYAN}11)`,
                marginLeft: 0,
                position: 'relative',
              }}>
                {/* Arrow indicator */}
                <div style={{
                  position: 'absolute',
                  right: -4,
                  top: -3,
                  width: 0,
                  height: 0,
                  borderTop: '4px solid transparent',
                  borderBottom: '4px solid transparent',
                  borderLeft: `6px solid ${CYAN}33`,
                }} />
              </div>
            )}
          </div>
        ))}

        {/* Particles overlay */}
        {particles.map(particle => {
          const fromX = particle.fromIndex * TOTAL_PER_NODE + NODE_WIDTH / 2;
          const toX = particle.toIndex * TOTAL_PER_NODE + NODE_WIDTH / 2;
          const currentX = fromX + (toX - fromX) * particle.progress;
          // Ease-out for smooth deceleration
          const eased = 1 - Math.pow(1 - particle.progress, 3);
          const easedX = fromX + (toX - fromX) * eased;

          return (
            <div
              key={particle.id}
              style={{
                position: 'absolute',
                left: easedX - 3,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: MAGENTA,
                boxShadow: `0 0 8px ${MAGENTA}, 0 0 16px ${MAGENTA}88`,
                pointerEvents: 'none',
                opacity: 1 - particle.progress * 0.5,
              }}
            />
          );
        })}
      </div>

      {/* Animated glow keyframes via style tag */}
      <style>{`
        @keyframes hexGlow {
          0%, 100% { filter: drop-shadow(0 0 4px #00f0ff44); }
          50% { filter: drop-shadow(0 0 12px #00f0ff88); }
        }
      `}</style>
    </div>
  );
}
