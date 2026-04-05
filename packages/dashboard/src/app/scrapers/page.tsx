'use client';

import { useEffect, useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { SkeletonCard } from '@/components/Skeleton';

const CRON_LABELS: Record<string, string> = {
  'scrape:google-trends': 'Every 2 hours',
  'scrape:aliexpress': 'Every 12 hours',
  'scrape:amazon-trending': 'Every 6 hours',
  'scrape:tiktok-shop': 'Every 4 hours',
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ScrapersPage() {
  const [scrapers, setScrapers] = useState<any[]>([]);
  const [overall, setOverall] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, any[]>>({});
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/scrapers')
      .then((r) => r.json())
      .then((data) => {
        setScrapers(data.scrapers ?? []);
        setOverall(data.overall ?? {});
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function triggerScraper(name: string) {
    setTriggering(name);
    try {
      await fetch('/api/scrapers/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraper_name: name }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setTriggering(null), 2000);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Scrapers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Scraper Management</h2>

      {/* Overall stats */}
      <div className="flex gap-6 text-sm">
        <div>
          <span className="text-zinc-500">Total Products: </span>
          <span className="text-zinc-200 font-semibold">{(overall.total_products ?? 0).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-zinc-500">Scored: </span>
          <span className="text-zinc-200 font-semibold">{(overall.total_scored ?? 0).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-zinc-500">Pending: </span>
          <span className="text-amber-400 font-semibold">{overall.pending_review ?? 0}</span>
        </div>
      </div>

      {/* Scraper cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scrapers.map((s: any) => {
          const isTriggering = triggering === s.name;

          return (
            <div key={s.name} className="bg-zinc-800 border border-zinc-700 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-200">
                    {s.name.replace('scrape:', '')}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {CRON_LABELS[s.name] ?? s.schedule}
                  </p>
                </div>
                <StatusBadge status={s.last_status} />
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                <div className="bg-zinc-900 rounded p-2">
                  <p className="text-lg font-bold text-zinc-200">{s.runs_24h ?? 0}</p>
                  <p className="text-[10px] text-zinc-500">Runs (24h)</p>
                </div>
                <div className="bg-zinc-900 rounded p-2">
                  <p className="text-lg font-bold text-zinc-200">{(s.products_found_24h ?? 0).toLocaleString()}</p>
                  <p className="text-[10px] text-zinc-500">Products (24h)</p>
                </div>
                <div className="bg-zinc-900 rounded p-2">
                  <p className="text-lg font-bold text-zinc-200">{s.products_found_last_run ?? 0}</p>
                  <p className="text-[10px] text-zinc-500">Last Run</p>
                </div>
              </div>

              <p className="text-xs text-zinc-500 mb-4">
                Last run: {timeAgo(s.last_run)}
              </p>

              {/* Last 5 runs dots (mock — we only have last_status) */}
              <div className="flex gap-1 mb-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full ${
                      i === 0
                        ? s.last_status === 'completed'
                          ? 'bg-emerald-500'
                          : s.last_status === 'failed'
                            ? 'bg-red-500'
                            : 'bg-zinc-600'
                        : 'bg-zinc-700'
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={() => triggerScraper(s.name)}
                disabled={isTriggering}
                className={`w-full py-2 rounded font-medium text-sm transition-colors ${
                  isTriggering
                    ? 'bg-emerald-500/10 text-emerald-600 cursor-wait'
                    : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                }`}
              >
                {isTriggering ? 'Triggered...' : 'Run Now'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
