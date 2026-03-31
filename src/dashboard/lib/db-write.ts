import Database from 'better-sqlite3';

const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';

let _db: Database.Database | null = null;

/** Write-capable DB connection for A/B tracking inserts. */
export function getWriteDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');

  // Ensure A/B tables exist
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ab_impressions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      product_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      copy_approach TEXT
    );
    CREATE TABLE IF NOT EXISTS ab_clicks (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      impression_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      email TEXT NOT NULL,
      product_id TEXT NOT NULL,
      UNIQUE(email, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ab_impressions_product ON ab_impressions(product_id);
    CREATE INDEX IF NOT EXISTS idx_ab_impressions_variant ON ab_impressions(product_id, variant);
    CREATE INDEX IF NOT EXISTS idx_ab_clicks_impression ON ab_clicks(impression_id);
    CREATE INDEX IF NOT EXISTS idx_ab_clicks_product ON ab_clicks(product_id);
    CREATE INDEX IF NOT EXISTS idx_waitlist_product ON waitlist(product_id);
    CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
  `);

  // Migrate: add checkout_url to products if missing
  const cols = _db.prepare("PRAGMA table_info(products)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'checkout_url')) {
    _db.exec("ALTER TABLE products ADD COLUMN checkout_url TEXT");
  }

  return _db;
}
