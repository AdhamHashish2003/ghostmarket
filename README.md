# GhostMarket Intelligence Layer

Autonomous product discovery and scoring engine. Scrapes trending products from AliExpress, Amazon, TikTok Shop, and Google Trends, scores them for dropshipping/wholesale potential, and surfaces the best opportunities through a command-center dashboard.

## Architecture

```
ghostmarket/
├── packages/
│   ├── shared/        @ghostmarket/shared    — Types, DB client (Drizzle + Postgres), logger
│   ├── scrapers/      @ghostmarket/scrapers  — ScraperFleet: 4 Playwright/HTTP scrapers + BullMQ
│   ├── scoring/       @ghostmarket/scoring   — ScoringAgent: weighted scoring + dedup + ranking
│   └── dashboard/     @ghostmarket/dashboard — GhostBrain: Next.js 14 dashboard + API
```

**Data flow:**

```
Scrapers (cron) → raw_products → ScoringAgent → scored_products → Dashboard
Google Trends   → trend_signals ──────────────────────────────────→ Dashboard
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 3005 | Next.js 14 app — product feed, trends, scraper management |
| Bull Board | 3006 | Job queue monitoring UI |
| Scraper API | 3007 | Manual triggers, fleet status, job listing |

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> ghostmarket && cd ghostmarket
cp .env.example .env

# 2. One-command setup (installs deps, starts Postgres + Redis, runs migrations)
npm run setup

# 3. Start all services
npm run dev
```

This starts the ScraperFleet, ScoringAgent, and Dashboard concurrently.

## Development Scripts

```bash
npm run dev              # Start all services (scrapers + scoring + dashboard)
npm run dev:scrapers     # ScraperFleet only
npm run dev:scoring      # ScoringAgent only
npm run dev:dashboard    # Dashboard only (port 3005)
npm run build            # Build all packages
npm run db:migrate       # Run database migrations
npm run docker:up        # Start Postgres + Redis containers
npm run docker:down      # Stop containers
npm run setup            # Full setup (install + docker + migrate)
```

## Deploy to Railway

Railway deploys each service as a separate Dockerfile.

### 1. Create Railway project

```bash
railway login
railway init
```

### 2. Add services

Create three services in your Railway project:

- **ghostmarket-scrapers** — Dockerfile: `packages/scrapers/Dockerfile`
- **ghostmarket-scoring** — Dockerfile: `packages/scoring/Dockerfile`
- **ghostmarket-dashboard** — Dockerfile: `packages/dashboard/Dockerfile`

### 3. Add infrastructure

Add from Railway's template library:
- **PostgreSQL** — note the `DATABASE_URL`
- **Redis** — note the `REDIS_URL`

### 4. Set environment variables

Set on each service:

```
DATABASE_URL=<from Railway Postgres>
REDIS_URL=<from Railway Redis>
NODE_ENV=production
```

Dashboard additionally needs:
```
SCRAPER_FLEET_URL=<internal URL of scrapers service>
```

### 5. Deploy

```bash
railway up
```

Or push to GitHub and connect Railway for automatic deploys.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:ghostmarket_dev@localhost:5432/ghostmarket` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `NODE_ENV` | `development` | Environment (`development` / `production`) |
| `SCRAPER_FLEET_URL` | `http://localhost:3007` | ScraperFleet API URL (used by dashboard) |
| `PORT_BULL_BOARD` | `3006` | Bull Board dashboard port |
| `PORT_API` | `3007` | Scraper API port |
| `LOG_LEVEL` | `info` | Pino log level |

## API Endpoints

### Dashboard API (port 3005)

```
GET  /api/products              — List scored products (?status=pending&limit=50&sort=score)
GET  /api/products/:id          — Product detail + price history
PATCH /api/products/:id         — Update status (approved/rejected)
GET  /api/trends                — List trend signals (?source=google_trends&min_score=50)
GET  /api/scrapers              — Scraper fleet status
POST /api/scrapers/trigger      — Trigger a scraper ({ scraper_name, config })
GET  /api/stats                 — Dashboard statistics
```

### ScraperFleet API (port 3007)

```
POST /api/trigger/:scraperName  — Trigger scraper (google-trends, aliexpress, amazon-trending, tiktok-shop)
GET  /api/status                — Fleet status
GET  /api/jobs                  — Recent jobs from all queues
```

## Database Schema

Four tables managed by Drizzle ORM:

- **raw_products** — Scraped product data from all sources
- **trend_signals** — Trending keywords from Google Trends and TikTok
- **scored_products** — Products scored by the ScoringAgent (FK to raw_products)
- **scrape_jobs** — Job run history for each scraper

## Scraper Schedule

| Scraper | Cron | Frequency |
|---------|------|-----------|
| Google Trends | `0 */2 * * *` | Every 2 hours |
| TikTok Shop | `0 */4 * * *` | Every 4 hours |
| Amazon Trending | `0 */6 * * *` | Every 6 hours |
| AliExpress | `0 */12 * * *` | Every 12 hours |

## Scoring Formula

Products are scored 0-100 using four weighted sub-scores:

| Sub-score | Weight | Method |
|-----------|--------|--------|
| Sales Velocity | 30% | Rate of change in estimated monthly sales across scrape snapshots |
| Margin | 25% | Estimated margin based on 2.5x retail markup minus COGS and shipping |
| Trend | 25% | Matched against recent trend_signals with velocity multiplier |
| Competition | 20% | Inverse of category saturation (fewer competitors = higher score) |
