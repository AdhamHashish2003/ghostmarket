'use client';

interface TrendRowProps {
  keyword: string;
  interestScore: number;
  velocity: number;
  source: string;
  geo: string;
  capturedAt: string;
  relatedQueries?: string[];
}

const sourceColors: Record<string, string> = {
  google_trends: 'bg-blue-500/20 text-blue-400',
  tiktok: 'bg-pink-500/20 text-pink-400',
  twitter: 'bg-sky-500/20 text-sky-400',
  news: 'bg-amber-500/20 text-amber-400',
};

export default function TrendRow({
  keyword,
  interestScore,
  velocity,
  source,
  geo,
  capturedAt,
  relatedQueries,
}: TrendRowProps) {
  const velSign = velocity > 0 ? '+' : '';
  const velColor = velocity > 0 ? 'text-emerald-400' : velocity < 0 ? 'text-red-400' : 'text-zinc-500';
  const barWidth = Math.min(100, interestScore);

  return (
    <div className="flex items-center gap-4 p-3 bg-zinc-800 border border-zinc-700 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-200 truncate">{keyword}</p>
        {relatedQueries && relatedQueries.length > 0 && (
          <p className="text-[10px] text-zinc-500 truncate mt-0.5">
            {(relatedQueries as string[]).slice(0, 3).join(', ')}
          </p>
        )}
      </div>

      <div className="w-32 shrink-0">
        <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full"
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <p className="text-[10px] text-zinc-500 mt-0.5 text-right">{interestScore}/100</p>
      </div>

      <span className={`text-sm font-mono w-16 text-right ${velColor}`}>
        {velocity !== 0 ? `${velSign}${velocity.toFixed(1)}` : '--'}
      </span>

      <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${sourceColors[source] ?? 'bg-zinc-600 text-zinc-400'}`}>
        {source.replace('_', ' ')}
      </span>

      <span className="text-xs text-zinc-500 w-6 text-center">{geo}</span>
    </div>
  );
}
