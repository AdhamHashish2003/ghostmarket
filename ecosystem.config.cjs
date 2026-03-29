// GhostMarket PM2 Ecosystem Config
// Start:   pm2 start ecosystem.config.cjs
// Monitor: pm2 monit
// Logs:    pm2 logs

const path = require('path');
const fs = require('fs');

// ── Load .env manually (no dotenv dependency) ──────────────────
const envPath = path.resolve(__dirname, '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    envVars[key] = val;
  }
}

const DB_PATH = path.resolve(__dirname, 'data/ghostmarket.db');
const DATA_DIR = path.resolve(__dirname, 'data');
const LOGS_DIR = path.resolve(__dirname, 'logs');

// Ensure logs dir exists
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// Common env vars shared by all services
const commonEnv = {
  ...envVars,
  GHOSTMARKET_DB: DB_PATH,
  DATA_DIR: DATA_DIR,
  NODE_ENV: 'production',
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};

module.exports = {
  apps: [
    // ─── Core Services ─────────────────────────────────────────
    {
      name: 'orchestrator',
      script: 'node',
      args: '--import tsx src/orchestrator/index.ts',
      cwd: __dirname,
      env: { ...commonEnv, PORT: '4000' },
      restart_delay: 5000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      error_file: path.join(LOGS_DIR, 'orchestrator-error.log'),
      out_file: path.join(LOGS_DIR, 'orchestrator-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'telegram-bot',
      script: 'node',
      args: '--import tsx src/telegram/index.ts',
      cwd: __dirname,
      env: { ...commonEnv, ORCHESTRATOR_URL: 'http://localhost:4000' },
      restart_delay: 5000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      error_file: path.join(LOGS_DIR, 'telegram-error.log'),
      out_file: path.join(LOGS_DIR, 'telegram-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ─── Dashboard ─────────────────────────────────────────────
    {
      name: 'dashboard',
      script: './node_modules/.bin/next',
      args: 'dev -p 3333',
      cwd: path.resolve(__dirname, 'src/dashboard'),
      env: {
        ...commonEnv,
        NODE_ENV: 'development',
        ORCHESTRATOR_URL: 'http://localhost:4000',
      },
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
      error_file: path.join(LOGS_DIR, 'dashboard-error.log'),
      out_file: path.join(LOGS_DIR, 'dashboard-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ─── TypeScript Agents ─────────────────────────────────────
    {
      name: 'builder',
      script: 'node',
      args: '--import tsx src/agents/builder/index.ts',
      cwd: __dirname,
      env: commonEnv,
      restart_delay: 10000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      error_file: path.join(LOGS_DIR, 'builder-error.log'),
      out_file: path.join(LOGS_DIR, 'builder-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'deployer',
      script: 'node',
      args: '--import tsx src/agents/deployer/index.ts',
      cwd: __dirname,
      env: commonEnv,
      restart_delay: 10000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      error_file: path.join(LOGS_DIR, 'deployer-error.log'),
      out_file: path.join(LOGS_DIR, 'deployer-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'tracker',
      script: 'node',
      args: '--import tsx src/agents/tracker/index.ts',
      cwd: __dirname,
      env: commonEnv,
      restart_delay: 10000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      error_file: path.join(LOGS_DIR, 'tracker-error.log'),
      out_file: path.join(LOGS_DIR, 'tracker-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ─── Python Agents ─────────────────────────────────────────
    {
      name: 'scout-light',
      script: 'python3',
      args: 'src/agents/scout/light_sources.py',
      cwd: __dirname,
      interpreter: 'none',
      env: {
        ...commonEnv,
        PYTHONPATH: path.resolve(__dirname, 'src'),
      },
      restart_delay: 10000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      error_file: path.join(LOGS_DIR, 'scout-error.log'),
      out_file: path.join(LOGS_DIR, 'scout-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'scorer',
      script: 'python3',
      args: 'src/agents/scorer/main.py',
      cwd: __dirname,
      interpreter: 'none',
      env: {
        ...commonEnv,
        PYTHONPATH: path.resolve(__dirname, 'src'),
      },
      restart_delay: 10000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      error_file: path.join(LOGS_DIR, 'scorer-error.log'),
      out_file: path.join(LOGS_DIR, 'scorer-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ─── Cloudflare Tunnel ─────────────────────────────────────
    {
      name: 'tunnel',
      script: '/tmp/cloudflared',
      args: 'tunnel --url http://localhost:3333',
      interpreter: 'none',
      restart_delay: 5000,
      max_restarts: 100,
      autorestart: true,
      watch: false,
      error_file: path.join(LOGS_DIR, 'tunnel-error.log'),
      out_file: path.join(LOGS_DIR, 'tunnel-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
