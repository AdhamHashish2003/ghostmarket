import Database from "better-sqlite3";
import { DB_PATH } from "../constants.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { fileMustExist: true });
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function safeQuery(sql: string): unknown[] {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
    throw new Error("Only SELECT/WITH queries allowed. Use specific tools for write operations.");
  }
  const blocked = ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "ATTACH", "DETACH", "REPLACE", "PRAGMA"];
  for (const keyword of blocked) {
    const pattern = new RegExp(`\\b${keyword}\\b`);
    if (pattern.test(normalized)) {
      throw new Error(`Query contains blocked keyword: ${keyword}. Use specific tools for write operations.`);
    }
  }
  return getDb().prepare(sql).all();
}
