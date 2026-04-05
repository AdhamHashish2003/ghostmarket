'use client';

interface ScoreBarProps {
  label: string;
  value: number;
  max?: number;
}

function barColor(value: number): string {
  if (value >= 70) return 'bg-emerald-500';
  if (value >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

export default function ScoreBar({ label, value, max = 100 }: ScoreBarProps) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-zinc-400 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor(value)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-zinc-300 w-8 text-right">{Math.round(value)}</span>
    </div>
  );
}
