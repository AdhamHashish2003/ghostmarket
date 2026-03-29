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
    // TypeScript services (via tsx)
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
    },
    {
      name: 'telegram-bot',
      script: 'npx',
      args: 'tsx src/telegram/index.ts',
      cwd: __dirname,
      env: commonEnv,
      restart_delay: 5000,
      max_restarts: 50,
      autorestart: true,
      watch: false,
      kill_timeout: 10000,
    },
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
    },
    {
      name: 'dashboard',
      script: 'npx',
      args: 'next dev -p 3333',
      cwd: path.resolve(__dirname, 'src/dashboard'),
      env: { ...commonEnv, NODE_ENV: 'development' },
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
    },

    // Python services
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
    },
  ],
};
