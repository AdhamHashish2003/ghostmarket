// GhostMarket — Shared SQLite database access for all TypeScript services
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.GHOSTMARKET_DB || '/data/ghostmarket.db';
const SCHEMA_PATH = path.resolve(__dirname, '../db/schema.sql');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('foreign_keys = ON');

  // Initialize schema if tables don't exist
  const tableCheck = _db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='products'"
  ).get();

  if (!tableCheck) {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    _db.exec(schema);
  }

  return _db;
}

export function uuid(): string {
  return randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}

// Retry wrapper for SQLITE_BUSY
export function withRetry<T>(fn: () => T, maxRetries = 3): T {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SQLITE_BUSY') && attempt < maxRetries - 1) {
        const delay = 500 * Math.pow(2, attempt);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error('withRetry: unreachable');
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
