import fs from 'fs';

const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:4000';

/** Returns true when we can read from the local SQLite file */
export function canUseLocalDb(): boolean {
  try {
    return fs.existsSync(DB_PATH);
  } catch {
    return false;
  }
}

/** Fetch JSON from the orchestrator (used on Vercel when SQLite is unavailable) */
export async function fetchOrchestrator<T = unknown>(apiPath: string): Promise<T> {
  const resp = await fetch(`${ORCHESTRATOR_URL}${apiPath}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Orchestrator ${apiPath}: ${resp.status}`);
  return resp.json() as Promise<T>;
}
