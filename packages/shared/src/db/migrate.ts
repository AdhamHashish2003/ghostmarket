import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { rawProducts, trendSignals, scoredProducts, scrapeJobs } from './schema.js';
import logger from '../utils/logger.js';

async function migrate() {
  logger.info('Starting database migration...');

  try {
    // Create tables using raw SQL to ensure exact column specs
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS raw_products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        price_usd NUMERIC(10,2) NOT NULL,
        original_price_usd NUMERIC(10,2),
        currency TEXT DEFAULT 'USD',
        estimated_monthly_sales INTEGER,
        review_count INTEGER DEFAULT 0,
        rating NUMERIC(3,2),
        category TEXT NOT NULL,
        sub_category TEXT,
        supplier_name TEXT,
        supplier_url TEXT,
        product_url TEXT NOT NULL,
        image_urls JSONB DEFAULT '[]'::jsonb,
        tags JSONB DEFAULT '[]'::jsonb,
        scraped_at TIMESTAMP DEFAULT now(),
        batch_id TEXT NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trend_signals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        keyword TEXT NOT NULL,
        source TEXT NOT NULL,
        interest_score INTEGER NOT NULL,
        velocity NUMERIC(10,4) DEFAULT 0,
        related_queries JSONB DEFAULT '[]'::jsonb,
        geo TEXT DEFAULT 'US',
        captured_at TIMESTAMP DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scored_products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_product_id UUID NOT NULL REFERENCES raw_products(id),
        score NUMERIC(6,3) NOT NULL,
        sales_velocity_score NUMERIC(6,3),
        margin_score NUMERIC(6,3),
        trend_score NUMERIC(6,3),
        competition_score NUMERIC(6,3),
        fulfillment_type TEXT DEFAULT 'unknown',
        estimated_margin_pct NUMERIC(5,2),
        trend_keywords JSONB DEFAULT '[]'::jsonb,
        scored_at TIMESTAMP DEFAULT now(),
        status TEXT DEFAULT 'pending'
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scrape_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scraper_name TEXT NOT NULL,
        status TEXT DEFAULT 'queued',
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        products_found INTEGER DEFAULT 0,
        error_message TEXT,
        batch_id TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    // Create indexes (IF NOT EXISTS requires PG 9.5+)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS raw_products_source_external_id_idx ON raw_products (source, external_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS raw_products_batch_id_idx ON raw_products (batch_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS raw_products_scraped_at_idx ON raw_products (scraped_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS raw_products_category_idx ON raw_products (category)`);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS trend_signals_keyword_idx ON trend_signals (keyword)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS trend_signals_source_captured_at_idx ON trend_signals (source, captured_at)`);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS scored_products_score_idx ON scored_products (score DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS scored_products_status_idx ON scored_products (status)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS scored_products_raw_product_id_idx ON scored_products (raw_product_id)`);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS scrape_jobs_status_idx ON scrape_jobs (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS scrape_jobs_scraper_name_idx ON scrape_jobs (scraper_name)`);

    logger.info('Migration completed successfully — all tables and indexes created');
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    throw err;
  } finally {
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
