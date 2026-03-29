import Database from 'better-sqlite3';
import path from 'path';

// Use env var first, then find DB relative to this file's location
const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { readonly: true });
  _db.pragma('journal_mode = WAL');
  return _db;
}
