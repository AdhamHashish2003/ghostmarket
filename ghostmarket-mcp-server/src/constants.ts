import path from "path";

export const DB_PATH = process.env.GHOSTMARKET_DB || path.resolve(process.cwd(), "../data/ghostmarket.db");
export const ROG_WORKER_URL = process.env.ROG_WORKER_URL || "http://192.168.1.100:8500";
export const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:4000";
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
export const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
export const ROG_ENABLED = process.env.ROG_ENABLED === "true";
