'use client';

import { useEffect, useState, useCallback } from 'react';
import NeuralNetwork from '@/components/NeuralNetwork';
import AnimatedCounter from '@/components/AnimatedCounter';
import ScoreRing from '@/components/ScoreRing';
import ScoreDistribution from '@/components/ScoreDistribution';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Stats {
  products: { total: number; last_24h: number; last_7d: number };
  scoring: { total_scored: number; pending_review: number; approved: number; avg_approved_score: number };
  top_categories: Array<{ category: string; count: number }>;
  top_keywords: Array<{ keyword: string; interest_score: number }>;
  scraper_health: { success_rate_24h: number; total_runs_24h: number };
}

interface Product {
  id: string;
  score: string;
  sales_velocity_score: string;
  margin_score: string;
  trend_score: string;
  competition_score: string;
  title: string;
  source: string;
  price_usd: string;
  estimated_margin_pct: string;
  fulfillment_type: string;
  trend_keywords: string[];
  status: string;
}

interface Trend {
  id: string;
  keyword: string;
  interest_score: number;
  velocity: string;
  source: string;
  geo: string;
  captured_at: string;
}

interface Scraper {
  name: string;
  schedule: string;
  last_run: string | null;
  last_status: string | null;
  products_found_last_run: number;
  products_found_24h: number;
  runs_24h: number;
}

/* ------------------------------------------------------------------ */
/*  Demo data (used when API is unavailable)                           */
/* ------------------------------------------------------------------ */

const DEMO_STATS: Stats = {
  products: { total: 60, last_24h: 60, last_7d: 60 },
  scoring: { total_scored: 30, pending_review: 29, approved: 1, avg_approved_score: 77.5 },
  top_categories: [{ category: 'Consumer Electronics', count: 22 }, { category: 'Home & Kitchen', count: 18 }],
  top_keywords: [{ keyword: 'stanley cup', interest_score: 92 }, { keyword: 'cloud slides', interest_score: 88 }],
  scraper_health: { success_rate_24h: 100, total_runs_24h: 3 },
};

const DEMO_PRODUCTS: Product[] = [
  { id: '1', score: '77.500', sales_velocity_score: '70.000', margin_score: '70.000', trend_score: '100.000', competition_score: '70.000', title: 'Stanley Quencher H2.0 Tumbler 40oz Stainless Steel', source: 'amazon', price_usd: '35.00', estimated_margin_pct: '54.29', fulfillment_type: 'wholesale', trend_keywords: ['stanley cup'], status: 'pending' },
  { id: '2', score: '73.250', sales_velocity_score: '55.000', margin_score: '55.000', trend_score: '100.000', competition_score: '90.000', title: 'Cloud Slides Pillow Slippers Ultra Soft Recovery', source: 'tiktok_shop', price_usd: '14.99', estimated_margin_pct: '46.66', fulfillment_type: 'dropship', trend_keywords: ['cloud slides'], status: 'pending' },
  { id: '3', score: '73.000', sales_velocity_score: '55.000', margin_score: '70.000', trend_score: '100.000', competition_score: '70.000', title: 'Mini Projector 1080P WiFi Bluetooth Home Theater', source: 'aliexpress', price_usd: '42.50', estimated_margin_pct: '54.12', fulfillment_type: 'wholesale', trend_keywords: ['mini projector'], status: 'pending' },
  { id: '4', score: '70.250', sales_velocity_score: '70.000', margin_score: '25.000', trend_score: '100.000', competition_score: '90.000', title: 'Scalp Massager Shampoo Brush Silicone Head Scrubber', source: 'tiktok_shop', price_usd: '5.99', estimated_margin_pct: '26.67', fulfillment_type: 'dropship', trend_keywords: ['scalp massager'], status: 'pending' },
  { id: '5', score: '69.750', sales_velocity_score: '55.000', margin_score: '55.000', trend_score: '86.000', competition_score: '90.000', title: 'Air Fryer 5.8QT Large Capacity Oil-Free Digital Touch', source: 'amazon', price_usd: '44.99', estimated_margin_pct: '48.89', fulfillment_type: 'wholesale', trend_keywords: ['air fryer'], status: 'pending' },
  { id: '6', score: '65.500', sales_velocity_score: '55.000', margin_score: '40.000', trend_score: '100.000', competition_score: '70.000', title: 'LED Strip Lights 50ft RGB Color Changing with Remote', source: 'amazon', price_usd: '12.99', estimated_margin_pct: '36.52', fulfillment_type: 'dropship', trend_keywords: ['LED strip lights'], status: 'pending' },
  { id: '7', score: '63.250', sales_velocity_score: '40.000', margin_score: '55.000', trend_score: '78.000', competition_score: '90.000', title: 'Wireless Earbuds Bluetooth 5.3 IPX7 Waterproof', source: 'amazon', price_usd: '19.99', estimated_margin_pct: '47.50', fulfillment_type: 'wholesale', trend_keywords: ['wireless earbuds'], status: 'pending' },
  { id: '8', score: '61.000', sales_velocity_score: '70.000', margin_score: '25.000', trend_score: '72.000', competition_score: '70.000', title: 'Portable Neck Fan USB Rechargeable Bladeless 3-Speed', source: 'aliexpress', price_usd: '8.99', estimated_margin_pct: '22.22', fulfillment_type: 'dropship', trend_keywords: ['portable fan'], status: 'pending' },
  { id: '9', score: '58.500', sales_velocity_score: '40.000', margin_score: '55.000', trend_score: '66.000', competition_score: '70.000', title: 'Smart Watch Fitness Tracker Heart Rate Blood Oxygen', source: 'amazon', price_usd: '29.99', estimated_margin_pct: '53.33', fulfillment_type: 'wholesale', trend_keywords: ['smart watch'], status: 'pending' },
  { id: '10', score: '55.000', sales_velocity_score: '25.000', margin_score: '55.000', trend_score: '64.000', competition_score: '90.000', title: 'Pet Camera WiFi Dog Treat Dispenser 1080P Night Vision', source: 'tiktok_shop', price_usd: '32.99', estimated_margin_pct: '44.83', fulfillment_type: 'wholesale', trend_keywords: ['pet camera'], status: 'pending' },
];

const DEMO_TRENDS: Trend[] = [
  { id: 't1', keyword: 'stanley cup', interest_score: 92, velocity: '4.1000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't2', keyword: 'cloud slides', interest_score: 88, velocity: '9.1000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't3', keyword: 'air fryer', interest_score: 87, velocity: '3.4000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't4', keyword: 'portable fan', interest_score: 85, velocity: '7.2000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't5', keyword: 'smart watch', interest_score: 83, velocity: '2.0000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't6', keyword: 'mini projector', interest_score: 81, velocity: '6.1000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't7', keyword: 'wireless earbuds', interest_score: 78, velocity: '1.8000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't8', keyword: 'scalp massager', interest_score: 77, velocity: '8.3000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't9', keyword: 'posture corrector', interest_score: 74, velocity: '5.8000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't10', keyword: 'LED strip lights', interest_score: 72, velocity: '3.5000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't11', keyword: 'ice roller', interest_score: 71, velocity: '4.5000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't12', keyword: 'resistance bands', interest_score: 70, velocity: '2.9000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't13', keyword: 'ring light', interest_score: 68, velocity: '2.3000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't14', keyword: 'sunset lamp', interest_score: 66, velocity: '3.2000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
  { id: 't15', keyword: 'pet camera', interest_score: 64, velocity: '2.6000', source: 'google_trends', geo: 'US', captured_at: new Date().toISOString() },
];

const DEMO_SCRAPERS: Scraper[] = [
  { name: 'scrape:google-trends', schedule: '0 */2 * * *', last_run: new Date(Date.now() - 3600000).toISOString(), last_status: 'completed', products_found_last_run: 10, products_found_24h: 30, runs_24h: 12 },
  { name: 'scrape:aliexpress', schedule: '0 */12 * * *', last_run: new Date(Date.now() - 7200000).toISOString(), last_status: 'completed', products_found_last_run: 45, products_found_24h: 90, runs_24h: 2 },
  { name: 'scrape:amazon-trending', schedule: '0 */6 * * *', last_run: new Date(Date.now() - 5400000).toISOString(), last_status: 'completed', products_found_last_run: 32, products_found_24h: 128, runs_24h: 4 },
  { name: 'scrape:tiktok-shop', schedule: '0 */4 * * *', last_run: new Date(Date.now() - 1800000).toISOString(), last_status: 'completed', products_found_last_run: 28, products_found_24h: 168, runs_24h: 6 },
];

async function fetchWithFallback<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function sourceBadge(source: string) {
  const map: Record<string, { label: string; color: string }> = {
    aliexpress: { label: 'AliExpress', color: '#e44d26' },
    amazon: { label: 'Amazon', color: '#ff9900' },
    tiktok_shop: { label: 'TikTok', color: '#ff0050' },
    temu: { label: 'Temu', color: '#fb7701' },
    google_trends: { label: 'Google', color: '#4285f4' },
  };
  const s = map[source] ?? { label: source, color: '#888' };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider"
      style={{ backgroundColor: s.color + '20', color: s.color }}
    >
      {s.label}
    </span>
  );
}

function fulfillmentBadge(type: string) {
  const color = type === 'dropship' ? '#06b6d4' : type === 'wholesale' ? '#8b5cf6' : type === 'pod' ? '#f472b6' : '#6b7280';
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider"
      style={{ backgroundColor: color + '20', color }}
    >
      {type}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Section components                                                 */
/* ------------------------------------------------------------------ */

function SectionTitle({ children, live }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      {live && (
        <span className="relative flex h-2.5 w-2.5">
          <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
      )}
      <h2 className="font-display text-2xl font-bold text-white tracking-tight">{children}</h2>
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`skeleton ${className ?? 'h-4 w-full'}`} />;
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [scrapers, setScrapers] = useState<Scraper[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchWithFallback('/api/stats', DEMO_STATS),
      fetchWithFallback('/api/products?limit=10', { products: DEMO_PRODUCTS }),
      fetchWithFallback('/api/trends?limit=15', { trends: DEMO_TRENDS }),
      fetchWithFallback('/api/scrapers', { scrapers: DEMO_SCRAPERS }),
    ])
      .then(([s, p, t, sc]) => {
        setStats(s);
        setProducts(p.products ?? DEMO_PRODUCTS);
        setTrends(t.trends ?? DEMO_TRENDS);
        setScrapers(sc.scrapers ?? DEMO_SCRAPERS);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleAction = useCallback(async (id: string, status: 'approved' | 'rejected') => {
    setActionLoading(id);
    try {
      await fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error(e);
    }
    setActionLoading(null);
  }, []);

  const handleTrigger = useCallback(async (name: string) => {
    setTriggerLoading(name);
    try {
      await fetch('/api/scrapers/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraper_name: name }),
      });
      // Update the scraper status
      setScrapers((prev) =>
        prev.map((s) => s.name === name ? { ...s, last_status: 'running' } : s)
      );
    } catch (e) {
      console.error(e);
    }
    setTriggerLoading(null);
  }, []);

  return (
    <div className="relative min-h-screen">
      <NeuralNetwork />

      {/* ============================================================ */}
      {/* SECTION 1 — Hero                                              */}
      {/* ============================================================ */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 grid-overlay">
        <div className="text-center animate-fade-in-up">
          <h1 className="font-display text-6xl sm:text-7xl md:text-8xl font-900 tracking-tight glow-emerald text-white mb-4">
            Ghost<span className="text-emerald-400">Market</span>
          </h1>
          <p className="font-display text-lg sm:text-xl text-zinc-500 font-light tracking-wide mb-12">
            Autonomous Product Intelligence
          </p>

          {/* Live counters */}
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 font-mono text-sm text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-xl font-bold">
                <AnimatedCounter end={stats?.scoring.total_scored ?? 0} />
              </span>
              <span>products scored</span>
            </div>
            <span className="text-zinc-700 hidden sm:inline">•</span>
            <div className="flex items-center gap-2">
              <span className="text-cyan-400 text-xl font-bold">
                <AnimatedCounter end={stats ? (stats.products.total + (stats.scoring.total_scored || 0)) : 0} />
              </span>
              <span>trends tracked</span>
            </div>
            <span className="text-zinc-700 hidden sm:inline">•</span>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-xl font-bold">
                <AnimatedCounter end={scrapers.length || 4} />
              </span>
              <span>sources monitored</span>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* ============================================================ */}
      {/* SECTION 2 — Live Feed                                         */}
      {/* ============================================================ */}
      <section className="relative z-10 px-6 py-20 max-w-7xl mx-auto">
        <SectionTitle live>Top opportunities</SectionTitle>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-[#111] rounded-xl p-4 space-y-3 border border-zinc-800/50">
                <SkeletonBlock className="h-4 w-3/4" />
                <SkeletonBlock className="h-14 w-14 rounded-full mx-auto" />
                <SkeletonBlock className="h-3 w-1/2" />
                <SkeletonBlock className="h-3 w-full" />
                <div className="flex gap-2">
                  <SkeletonBlock className="h-7 flex-1" />
                  <SkeletonBlock className="h-7 flex-1" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="text-zinc-500 font-mono text-sm">No products to display</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {products.map((p, i) => {
              const score = parseFloat(p.score);
              return (
                <div
                  key={p.id}
                  className={`card-glow bg-[#111] rounded-xl p-4 border border-zinc-800/50 flex flex-col animate-fade-in-up`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {sourceBadge(p.source)}
                      {fulfillmentBadge(p.fulfillment_type)}
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-xs font-medium text-zinc-300 leading-snug mb-3 line-clamp-2 flex-1">
                    {p.title}
                  </h3>

                  {/* Score ring */}
                  <div className="flex justify-center mb-3">
                    <ScoreRing score={score} size={64} strokeWidth={5} />
                  </div>

                  {/* Data row */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-3 font-mono text-[10px]">
                    <div className="text-zinc-500">Price</div>
                    <div className="text-right text-zinc-300">${parseFloat(p.price_usd).toFixed(2)}</div>
                    <div className="text-zinc-500">Margin</div>
                    <div className="text-right text-emerald-400">{parseFloat(p.estimated_margin_pct).toFixed(0)}%</div>
                  </div>

                  {/* Trend keywords */}
                  {p.trend_keywords && p.trend_keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {p.trend_keywords.slice(0, 2).map((kw) => (
                        <span key={kw} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 mt-auto">
                    <button
                      onClick={() => handleAction(p.id, 'approved')}
                      disabled={actionLoading === p.id}
                      className="flex-1 py-1.5 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium transition-all disabled:opacity-50 border border-emerald-500/20 hover:border-emerald-500/40"
                    >
                      {actionLoading === p.id ? '...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleAction(p.id, 'rejected')}
                      disabled={actionLoading === p.id}
                      className="flex-1 py-1.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50 border border-red-500/15 hover:border-red-500/30"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/* SECTION 3 — Trend Radar                                       */}
      {/* ============================================================ */}
      <section className="relative z-10 px-6 py-20 max-w-7xl mx-auto">
        <SectionTitle>Trend radar</SectionTitle>

        {loading ? (
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-48 h-32 skeleton rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            {/* Bubble visualization */}
            <div className="relative h-64 mb-8 overflow-hidden rounded-2xl bg-[#0d0d0d] border border-zinc-800/30">
              {/* Radar circles */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {[0.3, 0.5, 0.7, 0.9].map((scale) => (
                  <div
                    key={scale}
                    className="absolute rounded-full border border-emerald-500/5"
                    style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}
                  />
                ))}
                {/* Sweep line */}
                <div className="radar-sweep absolute w-1/2 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-emerald-500/5 origin-left" />
              </div>

              {/* Bubbles */}
              <div className="absolute inset-0">
                {trends.slice(0, 15).map((t, i) => {
                  const size = Math.max(28, (t.interest_score / 100) * 90);
                  const vel = parseFloat(t.velocity ?? '0');
                  // Distribute in a cloud
                  const angle = (i / trends.length) * Math.PI * 2 + 0.5;
                  const dist = 0.15 + (1 - t.interest_score / 100) * 0.3;
                  const left = 50 + Math.cos(angle) * dist * 80;
                  const top = 50 + Math.sin(angle) * dist * 80;

                  return (
                    <div
                      key={t.id}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 group cursor-default animate-fade-in-up"
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        animationDelay: `${i * 0.08}s`,
                      }}
                    >
                      <div
                        className="rounded-full flex items-center justify-center transition-transform hover:scale-110"
                        style={{
                          width: size,
                          height: size,
                          background: `radial-gradient(circle, ${vel > 0 ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}, transparent)`,
                          border: `1px solid ${vel > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)'}`,
                          boxShadow: `0 0 ${size / 3}px ${vel > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.1)'}`,
                        }}
                      >
                        <span className="font-mono text-[9px] text-center leading-tight text-zinc-300 px-1 truncate max-w-full">
                          {t.keyword.length > 12 ? t.keyword.slice(0, 12) + '...' : t.keyword}
                        </span>
                      </div>

                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
                          <p className="text-xs font-medium text-white">{t.keyword}</p>
                          <div className="flex gap-3 mt-1 font-mono text-[10px]">
                            <span className="text-cyan-400">{t.interest_score}/100</span>
                            <span className={vel > 0 ? 'text-emerald-400' : 'text-red-400'}>
                              {vel > 0 ? '↑' : '↓'}{Math.abs(vel).toFixed(1)}/h
                            </span>
                            {sourceBadge(t.source)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scrolling cards */}
            <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2">
              {trends.map((t, i) => {
                const vel = parseFloat(t.velocity ?? '0');
                return (
                  <div
                    key={t.id}
                    className="card-glow flex-shrink-0 w-52 bg-[#111] rounded-xl p-4 border border-zinc-800/50 animate-fade-in-up"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="text-xs font-medium text-zinc-200 leading-snug line-clamp-2 flex-1 mr-2">
                        {t.keyword}
                      </h4>
                      <span
                        className={`font-mono text-lg font-bold ${
                          t.interest_score >= 80 ? 'text-emerald-400' :
                          t.interest_score >= 50 ? 'text-amber-400' :
                          'text-zinc-500'
                        }`}
                      >
                        {t.interest_score}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[10px]">
                      <span className={vel > 0 ? 'text-emerald-400' : vel < 0 ? 'text-red-400' : 'text-zinc-500'}>
                        {vel > 0 ? '▲' : vel < 0 ? '▼' : '–'} {Math.abs(vel).toFixed(1)}/h
                      </span>
                      {sourceBadge(t.source)}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* ============================================================ */}
      {/* SECTION 4 — Scraper Fleet                                     */}
      {/* ============================================================ */}
      <section className="relative z-10 px-6 py-20 max-w-7xl mx-auto">
        <SectionTitle>Scraper fleet</SectionTitle>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-40 rounded-xl" />
              ))
            : scrapers.map((s, i) => {
                const name = s.name.replace('scrape:', '');
                const displayName: Record<string, string> = {
                  'google-trends': 'Google Trends',
                  aliexpress: 'AliExpress',
                  'amazon-trending': 'Amazon',
                  'tiktok-shop': 'TikTok Shop',
                };
                const icons: Record<string, string> = {
                  'google-trends': '📊',
                  aliexpress: '🏪',
                  'amazon-trending': '📦',
                  'tiktok-shop': '🎵',
                };

                const isRunning = s.last_status === 'running' || triggerLoading === s.name;
                const isFailed = s.last_status === 'failed';

                return (
                  <div
                    key={s.name}
                    className={`card-glow bg-[#111] rounded-xl p-5 border border-zinc-800/50 animate-fade-in-up`}
                    style={{ animationDelay: `${i * 0.1}s` }}
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-xl">{icons[name] ?? '🔧'}</span>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-zinc-200">{displayName[name] ?? name}</h4>
                        <p className="font-mono text-[10px] text-zinc-600">{s.schedule}</p>
                      </div>
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          isRunning ? 'bg-emerald-500 pulse-dot' :
                          isFailed ? 'bg-red-500' :
                          'bg-zinc-600'
                        }`}
                      />
                    </div>

                    <div className="space-y-1.5 font-mono text-[11px] mb-4">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Last run</span>
                        <span className="text-zinc-300">{s.last_run ? timeAgo(s.last_run) : 'never'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Found</span>
                        <span className="text-zinc-300">{s.products_found_last_run} items</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">24h runs</span>
                        <span className="text-zinc-300">{s.runs_24h}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleTrigger(s.name)}
                      disabled={triggerLoading === s.name}
                      className="w-full py-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-mono font-medium transition-all disabled:opacity-50 border border-emerald-500/15 hover:border-emerald-500/30"
                    >
                      {triggerLoading === s.name ? 'Triggering...' : 'Run now'}
                    </button>
                  </div>
                );
              })}
        </div>
      </section>

      {/* ============================================================ */}
      {/* SECTION 5 — Score Distribution                                */}
      {/* ============================================================ */}
      <section className="relative z-10 px-6 py-20 max-w-7xl mx-auto">
        <SectionTitle>Score distribution</SectionTitle>

        <div className="card-glow bg-[#111] rounded-xl p-6 border border-zinc-800/50 max-w-xl">
          {loading ? (
            <div className="skeleton h-40 rounded-lg" />
          ) : (
            <ScoreDistribution products={products} />
          )}
        </div>
      </section>

      {/* ============================================================ */}
      {/* Footer                                                        */}
      {/* ============================================================ */}
      <footer className="relative z-10 px-6 py-12 border-t border-zinc-800/30">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot" />
            <span className="font-display text-sm font-semibold text-zinc-400">GhostMarket</span>
          </div>
          <span className="font-mono text-[10px] text-zinc-600">
            Autonomous Product Intelligence • v2.0
          </span>
        </div>
      </footer>
    </div>
  );
}
