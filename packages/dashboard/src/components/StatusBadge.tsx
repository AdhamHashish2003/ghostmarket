'use client';

interface StatusBadgeProps {
  status: string;
}

const styles: Record<string, string> = {
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  queued: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  idle: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  never: 'bg-zinc-500/20 text-zinc-500 border-zinc-600/30',
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const cls = styles[status] ?? styles.idle;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}
