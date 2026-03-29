// GhostMarket PM2 Ecosystem Config
// Start all services: pm2 start ecosystem.config.js
// Monitor: pm2 monit

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const DB_PATH = path.resolve(__dirname, 'data/ghostmarket.db');
const DATA_DIR = path.resolve(__dirname, 'data');

const commonEnv = {
  GHOSTMARKET_DB: DB_PATH,
  DATA_DIR: DATA_DIR,
  NODE_ENV: 'production',
};

module.exports = {
  apps: [
    // ============================================================
    // Core Services
    // ============================================================
    {
      name: 'orchestrator',
      script: 'npx',
      args: 'tsx src/orchestrator/index.ts',
      cwd: __dirname,
      env: { ...commonEnv, PORT: '4000' },
      restart_delay: 5000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '500M',
      error_file: path.resolve(__dirname, 'logs/orchestrator-error.log'),
      out_file: path.resolve(__dirname, 'logs/orchestrator-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'telegram-bot',
      script: 'npx',
      args: 'tsx src/telegram/index.ts',
      cwd: __dirname,
      env: { ...commonEnv, ORCHESTRATOR_URL: 'http://localhost:4000' },
      restart_delay: 5000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '300M',
      error_file: path.resolve(__dirname, 'logs/telegram-error.log'),
      out_file: path.resolve(__dirname, 'logs/telegram-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ============================================================
    // Dashboard
    // ============================================================
    {
      name: 'dashboard',
      script: 'npx',
      args: 'next dev -p 3333',
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
      max_memory_restart: '500M',
      error_file: path.resolve(__dirname, 'logs/dashboard-error.log'),
      out_file: path.resolve(__dirname, 'logs/dashboard-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ============================================================
    // TypeScript Agents
    // ============================================================
    {
      name: 'builder',
      script: 'npx',
      args: 'tsx src/agents/builder/index.ts',
      cwd: __dirname,
      env: commonEnv,
      restart_delay: 10000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      error_file: path.resolve(__dirname, 'logs/builder-error.log'),
      out_file: path.resolve(__dirname, 'logs/builder-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'deployer',
      script: 'npx',
      args: 'tsx src/agents/deployer/index.ts',
      cwd: __dirname,
      env: commonEnv,
      restart_delay: 10000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      error_file: path.resolve(__dirname, 'logs/deployer-error.log'),
      out_file: path.resolve(__dirname, 'logs/deployer-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'tracker',
      script: 'npx',
      args: 'tsx src/agents/tracker/index.ts',
      cwd: __dirname,
      env: commonEnv,
      restart_delay: 10000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      error_file: path.resolve(__dirname, 'logs/tracker-error.log'),
      out_file: path.resolve(__dirname, 'logs/tracker-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ============================================================
    // Python Agents
    // ============================================================
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
      max_memory_restart: '400M',
      error_file: path.resolve(__dirname, 'logs/scout-error.log'),
      out_file: path.resolve(__dirname, 'logs/scout-out.log'),
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
      max_memory_restart: '300M',
      error_file: path.resolve(__dirname, 'logs/scorer-error.log'),
      out_file: path.resolve(__dirname, 'logs/scorer-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ============================================================
    // Cloudflare Tunnel (for public access)
    // ============================================================
    {
      name: 'tunnel',
      script: '/tmp/cloudflared',
      args: 'tunnel --url http://localhost:3333',
      interpreter: 'none',
      restart_delay: 5000,
      max_restarts: 100,
      autorestart: true,
      watch: false,
      error_file: path.resolve(__dirname, 'logs/tunnel-error.log'),
      out_file: path.resolve(__dirname, 'logs/tunnel-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
