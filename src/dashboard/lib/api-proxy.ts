import { NextResponse } from 'next/server';
import fs from 'fs';

const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:4000';

/**
 * Check if local SQLite DB is available (localhost dev / PM2).
 * On Vercel, the DB file won't exist so we proxy to the orchestrator.
 */
export function isLocal(): boolean {
  try {
    return fs.existsSync(DB_PATH);
  } catch {
    return false;
  }
}

/**
 * Proxy a GET request to the home orchestrator.
 * Used when running on Vercel (no local SQLite).
 */
export async function proxyToOrchestrator(apiPath: string): Promise<Response> {
  if (!ORCHESTRATOR_URL || ORCHESTRATOR_URL === 'http://localhost:4000') {
    return NextResponse.json(
      { error: 'Dashboard deployed without ORCHESTRATOR_URL — set it to your tunnel URL in Vercel env vars' },
      { status: 503 },
    );
  }
  try {
    const resp = await fetch(`${ORCHESTRATOR_URL}${apiPath}`, {
      signal: AbortSignal.timeout(25000),
      headers: { 'Accept': 'application/json' },
    });
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: `Orchestrator unreachable at ${ORCHESTRATOR_URL}: ${e}` },
      { status: 502 },
    );
  }
}
