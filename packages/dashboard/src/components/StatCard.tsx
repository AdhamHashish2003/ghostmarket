'use client';

interface StatCardProps {
  label: string;
  value: string | number;
  delta?: string;
  color?: 'emerald' | 'amber' | 'red' | 'zinc';
}

const colorMap = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  zinc: 'text-zinc-400',
};

export default function StatCard({ label, value, delta, color = 'zinc' }: StatCardProps) {
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-5">
      <p className="text-zinc-400 text-sm mb-1">{label}</p>
      <p className={`text-3xl font-bold ${colorMap[color]}`}>{value}</p>
      {delta && <p className="text-emerald-500 text-sm mt-1">{delta}</p>}
    </div>
  );
}
