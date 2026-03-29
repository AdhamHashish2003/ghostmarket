# GhostMarket — Claude Code Context

You are maintaining GhostMarket, an autonomous e-commerce discovery and launch system.

## Architecture
- Two machines: PC (orchestrator, dashboard, Telegram) + ASUS ROG (scraping, GPU, model serving)
- Communication: HTTP API between PC orchestrator (port 4000) and ROG worker (port 8500)
- Database: SQLite with WAL mode at /data/ghostmarket.db
- LLM: Groq API (llama-3.3-70b) for fast scoring, local Ollama for creative gen (fine-tuned Llama-3.1-8B)
- Failover chain: Groq → Gemini → NVIDIA NIM

## Critical Rules
- EVERY scraper output must be logged to trend_signals table
- EVERY LLM call must be logged to llm_calls table (this is training data)
- NEVER delete or overwrite training data — append only
- NEVER bypass Telegram approval for money-spending actions
- All Python code must have type hints
- All TypeScript code must be strict mode
- Follow patterns established in existing code — read before writing

## File Structure
```
ghostmarket/
├── docker-compose.yml          # PC services
├── docker-compose.rog.yml      # ROG services
├── package.json                # Node.js deps
├── tsconfig.json               # TypeScript strict config
├── src/
│   ├── orchestrator/           # Event bus, cron scheduler, agent coordination (TypeScript)
│   ├── dashboard/              # Next.js app at localhost:3000
│   ├── telegram/               # Telegram war room bot (TypeScript)
│   ├── shared/
│   │   ├── types.ts            # All TypeScript interfaces
│   │   ├── db.ts               # SQLite access utilities
│   │   ├── llm.ts              # LLM failover chain
│   │   └── training.py         # Python training data utilities
│   ├── db/
│   │   └── schema.sql          # SQLite schema (13 tables + training_export view)
│   ├── agents/
│   │   ├── scout/              # Trend discovery (Python) — light (PC) + heavy (ROG)
│   │   ├── sourcer/            # Supplier search (Python, runs on ROG)
│   │   ├── scorer/             # ML scoring (Python, runs on PC)
│   │   ├── builder/            # Landing page + brand + creative gen (TypeScript)
│   │   ├── image/              # CarveKit + Replicate pipeline (Python, ROG GPU)
│   │   ├── deployer/           # Vercel deploy + Buffer scheduling (TypeScript)
│   │   ├── tracker/            # Analytics collection (TypeScript)
│   │   └── learner/            # XGBoost + QLoRA retraining (Python, ROG GPU)
│   └── rog-worker/             # FastAPI service on ROG (accepts jobs from PC)
├── data/                       # SQLite DB + generated assets
└── models/                     # XGBoost weights + QLoRA adapters
```

## Database Schema
See src/db/schema.sql for full schema. Key tables:
- products: every product, all stages, scoring, outcomes
- trend_signals: raw signals from 6 sources
- suppliers: sourcing data per product
- llm_calls: every LLM interaction (training data for fine-tuning)
- learning_cycles: model versions, accuracy metrics
- operator_decisions: every Telegram approval/skip (highest quality labels)
- training_export: denormalized view joining products → signals → suppliers → outcomes

## Agent Communication
- PC → ROG: HTTP POST to ROG_WORKER_URL (port 8500) endpoints:
  /scrape, /remove-bg, /generate-image, /evaluate, /train, /claude-code
- ROG → PC: HTTP POST to ORCHESTRATOR_CALLBACK_URL (port 4000) /callback endpoint
- Inter-agent on same machine: SQLite polling + Node.js EventEmitter

## Config Constants
- Score threshold: 65/100 (send to Telegram)
- High priority: 90+ (🔥 flag)
- Max Telegram products/day: 10
- Seed categories: home_decor, gadgets, fitness, kitchen, car_accessories, pet_products
- Seed category bonus: 5%
- Daily budget: $0 (operator raises via /budget)

## Recent Git Log
[auto-populated by nightly script]

## Current Agent Status
[auto-populated by health check]
