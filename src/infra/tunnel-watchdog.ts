/**
 * Tunnel Watchdog — auto-updates Vercel ORCHESTRATOR_URL when cloudflared restarts.
 *
 * Polls `pm2 logs tunnel` every 60s, extracts the trycloudflare URL.
 * If URL changed from last known: updates Vercel env var, triggers redeploy.
 * Stores state in data/tunnel_state.json.
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb, uuid, withRetry } from '../shared/db.js';

const POLL_INTERVAL = 60_000; // 60 seconds
const STATE_FILE = path.resolve(process.cwd(), 'data', 'tunnel_state.json');
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_SCOPE = process.env.VERCEL_ORG_ID || '';
const DASHBOARD_DIR = path.resolve(process.cwd(), 'src', 'dashboard');

interface TunnelState {
  url: string;
  updated_at: string;
  deploy_count: number;
}

function loadState(): TunnelState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveState(state: TunnelState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function logEvent(message: string, severity: 'info' | 'warning' | 'error' = 'info'): void {
  console.log(`[Watchdog] ${message}`);
  try {
    const db = getDb();
    withRetry(() => {
      db.prepare(
        `INSERT INTO system_events (id, agent, event_type, severity, message) VALUES (?, 'tunnel-watchdog', 'health_check', ?, ?)`
      ).run(uuid(), severity, message);
    });
  } catch {}
}

function extractTunnelUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    exec('pm2 logs tunnel --lines 50 --nostream 2>&1', { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const matches = stdout.match(/https:\/\/[a-z-]+\.trycloudflare\.com/g);
      resolve(matches ? matches[matches.length - 1] : null);
    });
  });
}

function runVercelCommand(cmd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd: DASHBOARD_DIR, timeout: 300_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || '') + (stderr || '') });
    });
  });
}

async function updateVercelAndRedeploy(newUrl: string): Promise<boolean> {
  if (!VERCEL_TOKEN) {
    logEvent('VERCEL_TOKEN not set — cannot update Vercel', 'warning');
    return false;
  }

  const scopeFlag = VERCEL_SCOPE ? ` --scope ${VERCEL_SCOPE}` : '';
  const tokenFlag = ` --token="${VERCEL_TOKEN}"`;

  // Step 1: Remove old env var
  logEvent(`Removing old ORCHESTRATOR_URL from Vercel...`);
  await runVercelCommand(
    `npx vercel env rm ORCHESTRATOR_URL production --yes${tokenFlag}${scopeFlag}`
  );

  // Step 2: Add new env var
  logEvent(`Setting ORCHESTRATOR_URL to ${newUrl}`);
  const addResult = await runVercelCommand(
    `echo "${newUrl}" | npx vercel env add ORCHESTRATOR_URL production${tokenFlag}${scopeFlag}`
  );
  if (!addResult.ok) {
    logEvent(`Failed to set env var: ${addResult.output.substring(0, 200)}`, 'error');
    return false;
  }

  // Step 3: Redeploy
  logEvent('Triggering Vercel production deploy...');
  const deployResult = await runVercelCommand(
    `npx vercel --prod --yes${tokenFlag}${scopeFlag}`
  );
  if (!deployResult.ok) {
    logEvent(`Vercel deploy failed: ${deployResult.output.substring(0, 200)}`, 'error');
    return false;
  }

  logEvent(`Vercel redeployed with ORCHESTRATOR_URL=${newUrl}`);
  return true;
}

async function poll(): Promise<void> {
  const currentUrl = await extractTunnelUrl();
  if (!currentUrl) return; // No URL found, tunnel might be starting

  const state = loadState();
  if (state?.url === currentUrl) return; // No change

  // URL changed!
  const oldUrl = state?.url || '(none)';
  logEvent(`Tunnel URL changed: ${oldUrl} → ${currentUrl}`);

  const ok = await updateVercelAndRedeploy(currentUrl);
  if (ok) {
    saveState({
      url: currentUrl,
      updated_at: new Date().toISOString(),
      deploy_count: (state?.deploy_count || 0) + 1,
    });
    logEvent(`State saved. Total deploys: ${(state?.deploy_count || 0) + 1}`);
  } else {
    logEvent('Vercel update failed — will retry next cycle', 'warning');
  }
}

// ── Main ──

console.log('[Watchdog] Starting tunnel watchdog');
console.log(`[Watchdog] Poll interval: ${POLL_INTERVAL / 1000}s`);
console.log(`[Watchdog] State file: ${STATE_FILE}`);
console.log(`[Watchdog] Vercel token: ${VERCEL_TOKEN ? 'set' : 'NOT SET'}`);

logEvent('Tunnel watchdog started');

// Initial poll immediately
poll().catch((e) => console.error('[Watchdog] Initial poll failed:', e));

// Then poll every 60s
setInterval(() => {
  poll().catch((e) => console.error('[Watchdog] Poll failed:', e));
}, POLL_INTERVAL);
