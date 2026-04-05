'use client';

import { useEffect, useState } from 'react';

interface ScoreDistributionProps {
  products: Array<{ score: string }>;
}

const BUCKETS = ['0-20', '20-40', '40-60', '60-80', '80-100'];
const BUCKET_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4'];

export default function ScoreDistribution({ products }: ScoreDistributionProps) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 300);
    return () => clearTimeout(timer);
  }, []);

  const counts = [0, 0, 0, 0, 0];
  for (const p of products) {
    const s = parseFloat(p.score);
    if (s < 20) counts[0]++;
    else if (s < 40) counts[1]++;
    else if (s < 60) counts[2]++;
    else if (s < 80) counts[3]++;
    else counts[4]++;
  }

  const maxCount = Math.max(...counts, 1);

  return (
    <div className="flex items-end gap-3 h-40 px-2">
      {BUCKETS.map((label, i) => {
        const pct = (counts[i] / maxCount) * 100;
        return (
          <div key={label} className="flex-1 flex flex-col items-center gap-2">
            <span className="font-mono text-xs text-zinc-400">{counts[i]}</span>
            <div className="w-full relative" style={{ height: '100px' }}>
              <div
                className="absolute bottom-0 w-full rounded-t-sm transition-all duration-1000 ease-out"
                style={{
                  height: animated ? `${Math.max(pct, 4)}%` : '4%',
                  backgroundColor: BUCKET_COLORS[i],
                  opacity: 0.8,
                  boxShadow: `0 0 10px ${BUCKET_COLORS[i]}40`,
                }}
              />
            </div>
            <span className="font-mono text-[10px] text-zinc-500">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
