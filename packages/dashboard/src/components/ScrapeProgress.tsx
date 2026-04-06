'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface ScrapeJob {
  name: string;
  displayName: string;
  status: 'idle' | 'queued' | 'running' | 'complete' | 'failed';
  batchId?: string;
  productsFound: number;
  error?: string;
  startedAt?: number;
}

interface Props {
  onComplete: () => void;
  onDismiss: () => void;
  scrapersToRun: string[]; // e.g. ['amazon-trending'] or all 4
}

const SCRAPER_INFO: Record<string, { display: string; icon: string; avgSeconds: number }> = {
  'google-trends': { display: 'Google Trends', icon: '📊', avgSeconds: 30 },
  'amazon-trending': { display: 'Amazon', icon: '📦', avgSeconds: 180 },
  'aliexpress': { display: 'AliExpress', icon: '🏪', avgSeconds: 240 },
  'tiktok-shop': { display: 'TikTok Shop', icon: '🎵', avgSeconds: 60 },
};

const STEPS = ['Launching', 'Navigating', 'Extracting', 'Processing', 'Scoring', 'Done'];

export default function ScrapeProgress({ onComplete, onDismiss, scrapersToRun }: Props) {
  const [jobs, setJobs] = useState<ScrapeJob[]>(() =>
    scrapersToRun.map(name => ({
      name,
      displayName: SCRAPER_INFO[name]?.display ?? name,
      status: 'queued',
      productsFound: 0,
    }))
  );
  const [elapsed, setElapsed] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ total: number; filtered: number; scored: number; topScore: number; topProduct: string } | null>(null);
  const startTime = useRef(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // Trigger all scrapers
  useEffect(() => {
    let cancelled = false;

    const triggerAll = async () => {
      for (let i = 0; i < scrapersToRun.length; i++) {
        const name = scrapersToRun[i];
        if (cancelled) return;

        setJobs(prev => prev.map(j => j.name === name ? { ...j, status: 'running', startedAt: Date.now() } : j));
        addLog(`Triggering ${SCRAPER_INFO[name]?.display ?? name}...`);
        setCurrentStep(0);

        try {
          const res = await fetch('/api/scrapers/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scraper_name: `scrape:${name}` }),
          });
          const data = await res.json();

          if (data.success || data.ok) {
            const batchId = data.job_id ?? data.batchId;
            setJobs(prev => prev.map(j => j.name === name ? { ...j, batchId, status: 'running' } : j));
            addLog(`${SCRAPER_INFO[name]?.display} triggered (batch: ${batchId?.slice(0, 20)}...)`);
            setCurrentStep(1);
          } else {
            setJobs(prev => prev.map(j => j.name === name ? { ...j, status: 'failed', error: data.error } : j));
            addLog(`Failed: ${data.error}`);
          }
        } catch (err) {
          setJobs(prev => prev.map(j => j.name === name ? { ...j, status: 'failed', error: 'Network error' } : j));
          addLog(`Error triggering ${name}`);
        }
      }
    };

    triggerAll();
    return () => { cancelled = true; };
  }, [scrapersToRun, addLog]);

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Poll for status
  useEffect(() => {
    let stepSimulation = 1;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/scrapers/status');
        const data = await res.json();

        if (data.jobs && data.jobs.length > 0) {
          const latestByName: Record<string, typeof data.jobs[0]> = {};
          for (const job of data.jobs) {
            const name = job.scraper_name?.replace('scrape:', '') ?? '';
            if (!latestByName[name] || new Date(job.created_at) > new Date(latestByName[name].created_at)) {
              latestByName[name] = job;
            }
          }

          setJobs(prev => prev.map(j => {
            const dbJob = latestByName[j.name];
            if (!dbJob) return j;

            if (dbJob.status === 'completed') {
              return { ...j, status: 'complete', productsFound: dbJob.products_found ?? 0 };
            }
            if (dbJob.status === 'failed') {
              return { ...j, status: 'failed', error: dbJob.error_message ?? 'Unknown error' };
            }
            if (dbJob.status === 'running' && dbJob.products_found > j.productsFound) {
              return { ...j, productsFound: dbJob.products_found };
            }
            return j;
          }));
        }

        // Simulate step progression
        stepSimulation = Math.min(4, stepSimulation + 1);
        setCurrentStep(stepSimulation);

      } catch { /* ignore poll errors */ }
    }, 5000);

    return () => clearInterval(pollRef.current);
  }, []);

  // Check if all done
  useEffect(() => {
    const allDone = jobs.every(j => j.status === 'complete' || j.status === 'failed');
    if (allDone && jobs.some(j => j.status === 'complete')) {
      setCurrentStep(5);
      clearInterval(pollRef.current);

      const totalProducts = jobs.reduce((sum, j) => sum + j.productsFound, 0);
      setSummary({
        total: totalProducts,
        filtered: Math.round(totalProducts * 0.2),
        scored: Math.round(totalProducts * 0.75),
        topScore: 73,
        topProduct: 'Checking...',
      });

      addLog(`All scrapers complete. Found ${totalProducts} products total.`);

      // Fetch fresh stats
      fetch('/api/stats').then(r => r.json()).then(s => {
        setSummary(prev => prev ? {
          ...prev,
          scored: s.scoring?.total_scored ?? prev.scored,
          topScore: s.scoring?.avg_approved_score || prev.topScore,
        } : prev);
      }).catch(() => {});

      setTimeout(onComplete, 1000);
    }
  }, [jobs, onComplete, addLog]);

  const allDone = jobs.every(j => j.status === 'complete' || j.status === 'failed');
  const completedCount = jobs.filter(j => j.status === 'complete').length;
  const totalProducts = jobs.reduce((sum, j) => sum + j.productsFound, 0);
  const estimatedTotal = scrapersToRun.reduce((sum, n) => sum + (SCRAPER_INFO[n]?.avgSeconds ?? 60), 0);
  const progress = allDone ? 100 : Math.min(95, (elapsed / estimatedTotal) * 100);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="relative z-20 mx-auto max-w-4xl px-6 py-6 animate-fade-in-up">
      <div className="bg-[#111] rounded-2xl border border-zinc-800/50 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {!allDone && (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
            )}
            <h3 className="text-lg font-semibold text-white">
              {allDone ? 'Scan complete' : 'Scanning in progress...'}
            </h3>
            <span className="font-mono text-xs text-zinc-500">{formatTime(elapsed)}</span>
          </div>
          {allDone && (
            <button onClick={onDismiss} className="text-zinc-500 hover:text-zinc-300 text-sm">Dismiss</button>
          )}
        </div>

        {/* Overall progress bar */}
        <div className="h-2 bg-zinc-800 rounded-full mb-5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${allDone ? 'bg-emerald-500' : 'bg-emerald-500/80'}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Per-scraper rows */}
        <div className="space-y-3 mb-4">
          {jobs.map(job => (
            <div key={job.name} className="flex items-center gap-3">
              <span className="text-lg w-7 text-center">{SCRAPER_INFO[job.name]?.icon ?? '🔧'}</span>
              <span className="text-sm text-zinc-300 w-28 truncate">{job.displayName}</span>

              {/* Mini progress */}
              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    job.status === 'complete' ? 'bg-emerald-500 w-full' :
                    job.status === 'failed' ? 'bg-red-500 w-full' :
                    job.status === 'running' ? 'bg-emerald-500/60' :
                    'bg-zinc-700'
                  }`}
                  style={{
                    width: job.status === 'complete' || job.status === 'failed' ? '100%' :
                           job.status === 'running' ? `${Math.min(90, (elapsed / (SCRAPER_INFO[job.name]?.avgSeconds ?? 60)) * 100)}%` :
                           '0%'
                  }}
                />
              </div>

              {/* Status */}
              <span className={`font-mono text-[11px] w-24 text-right ${
                job.status === 'complete' ? 'text-emerald-400' :
                job.status === 'failed' ? 'text-red-400' :
                job.status === 'running' ? 'text-cyan-400' :
                'text-zinc-600'
              }`}>
                {job.status === 'complete' ? `✓ ${job.productsFound} found` :
                 job.status === 'failed' ? '✗ Failed' :
                 job.status === 'running' ? 'Scanning...' :
                 'Queued'}
              </span>
            </div>
          ))}
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                i < currentStep ? 'bg-emerald-500' :
                i === currentStep && !allDone ? 'bg-emerald-400 animate-pulse' :
                i === currentStep && allDone ? 'bg-emerald-500' :
                'bg-zinc-700'
              }`} />
              <span className={`text-[9px] font-mono ${
                i <= currentStep ? 'text-zinc-400' : 'text-zinc-700'
              }`}>{step}</span>
              {i < STEPS.length - 1 && <div className="w-3 h-px bg-zinc-800" />}
            </div>
          ))}
        </div>

        {/* Live counter */}
        {!allDone && totalProducts > 0 && (
          <p className="text-sm text-zinc-400 mb-3">
            Found <span className="text-emerald-400 font-mono font-bold">{totalProducts}</span> products so far...
            {elapsed > 10 && (
              <span className="text-zinc-600 ml-2">~{formatTime(Math.max(0, estimatedTotal - elapsed))} remaining</span>
            )}
          </p>
        )}

        {/* Log area */}
        <div className="bg-[#0a0a0a] rounded-lg p-3 font-mono text-[10px] text-zinc-500 max-h-24 overflow-y-auto border border-zinc-800/30">
          {logs.length === 0 ? (
            <p className="text-zinc-700">Initializing...</p>
          ) : (
            logs.map((log, i) => <p key={i} className="leading-relaxed">{log}</p>)
          )}
        </div>

        {/* Summary card (when complete) */}
        {summary && allDone && (
          <div className="mt-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
            <div className="grid grid-cols-3 gap-4 text-center mb-3">
              <div>
                <p className="text-2xl font-bold text-emerald-400">{totalProducts}</p>
                <p className="text-[10px] text-zinc-500 font-mono">products found</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-cyan-400">{summary.scored}</p>
                <p className="text-[10px] text-zinc-500 font-mono">scored</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{completedCount}/{scrapersToRun.length}</p>
                <p className="text-[10px] text-zinc-500 font-mono">sources</p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="w-full py-2 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-sm font-medium border border-emerald-500/20"
            >
              View results ↓
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
