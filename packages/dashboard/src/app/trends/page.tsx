'use client';

import { useEffect, useState, useCallback } from 'react';
import TrendRow from '@/components/TrendRow';
import { SkeletonRow } from '@/components/Skeleton';

type Source = '' | 'google_trends' | 'tiktok' | 'twitter' | 'news';

const SOURCES: { key: Source; label: string }[] = [
  { key: '', label: 'All Sources' },
  { key: 'google_trends', label: 'Google Trends' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'twitter', label: 'Twitter' },
  { key: 'news', label: 'News' },
];

export default function TrendsPage() {
  const [trends, setTrends] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<Source>('');
  const [sortKey, setSortKey] = useState<'interest_score' | 'velocity' | 'captured_at'>('interest_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchTrends = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (source) params.set('source', source);
      const res = await fetch(`/api/trends?${params}`);
      const data = await res.json();
      setTrends(data.trends ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  // Client-side filter and sort
  const filtered = trends
    .filter((t) => !search || t.keyword.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortKey === 'interest_score') {
        aVal = a.interest_score;
        bVal = b.interest_score;
      } else if (sortKey === 'velocity') {
        aVal = parseFloat(a.velocity ?? '0');
        bVal = parseFloat(b.velocity ?? '0');
      } else {
        aVal = new Date(a.captured_at).getTime();
        bVal = new Date(b.captured_at).getTime();
      }
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sortArrow = (key: typeof sortKey) =>
    sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Trends Explorer</h2>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <input
          type="text"
          placeholder="Search keywords..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 w-64 focus:outline-none focus:border-zinc-500"
        />
        <div className="flex gap-1">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                source === s.key
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500 ml-auto">{filtered.length} trends</span>
      </div>

      {/* Sort headers */}
      <div className="flex items-center gap-4 px-3 text-xs text-zinc-500">
        <span className="flex-1">Keyword</span>
        <button className="w-32 text-right hover:text-zinc-300" onClick={() => toggleSort('interest_score')}>
          Score{sortArrow('interest_score')}
        </button>
        <button className="w-16 text-right hover:text-zinc-300" onClick={() => toggleSort('velocity')}>
          Velocity{sortArrow('velocity')}
        </button>
        <span className="w-20 text-center">Source</span>
        <span className="w-6 text-center">Geo</span>
      </div>

      {/* Trend rows */}
      <div className="space-y-2">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
          : filtered.length === 0
            ? <p className="text-zinc-500 text-center py-12">No trends found</p>
            : filtered.map((t: any) => (
                <TrendRow
                  key={t.id}
                  keyword={t.keyword}
                  interestScore={t.interest_score}
                  velocity={parseFloat(t.velocity ?? '0')}
                  source={t.source}
                  geo={t.geo ?? 'US'}
                  capturedAt={t.captured_at}
                  relatedQueries={t.related_queries}
                />
              ))}
      </div>
    </div>
  );
}
