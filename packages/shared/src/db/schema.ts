import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const rawProducts = pgTable(
  'raw_products',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    source: text('source').notNull(),
    external_id: text('external_id').notNull(),
    title: text('title').notNull(),
    price_usd: numeric('price_usd', { precision: 10, scale: 2 }).notNull(),
    original_price_usd: numeric('original_price_usd', { precision: 10, scale: 2 }),
    currency: text('currency').default('USD'),
    estimated_monthly_sales: integer('estimated_monthly_sales'),
    review_count: integer('review_count').default(0),
    rating: numeric('rating', { precision: 3, scale: 2 }),
    category: text('category').notNull(),
    sub_category: text('sub_category'),
    supplier_name: text('supplier_name'),
    supplier_url: text('supplier_url'),
    product_url: text('product_url').notNull(),
    image_urls: jsonb('image_urls').default([]),
    tags: jsonb('tags').default([]),
    scraped_at: timestamp('scraped_at').defaultNow(),
    batch_id: text('batch_id').notNull(),
  },
  (table) => ({
    sourceExternalIdx: index('raw_products_source_external_id_idx').on(
      table.source,
      table.external_id,
    ),
    batchIdx: index('raw_products_batch_id_idx').on(table.batch_id),
    scrapedAtIdx: index('raw_products_scraped_at_idx').on(table.scraped_at),
    categoryIdx: index('raw_products_category_idx').on(table.category),
  }),
);

export const trendSignals = pgTable(
  'trend_signals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    keyword: text('keyword').notNull(),
    source: text('source').notNull(),
    interest_score: integer('interest_score').notNull(),
    velocity: numeric('velocity', { precision: 10, scale: 4 }).default('0'),
    related_queries: jsonb('related_queries').default([]),
    geo: text('geo').default('US'),
    captured_at: timestamp('captured_at').defaultNow(),
  },
  (table) => ({
    keywordIdx: index('trend_signals_keyword_idx').on(table.keyword),
    sourceCapturedIdx: index('trend_signals_source_captured_at_idx').on(
      table.source,
      table.captured_at,
    ),
  }),
);

export const scoredProducts = pgTable(
  'scored_products',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    raw_product_id: uuid('raw_product_id')
      .notNull()
      .references(() => rawProducts.id),
    score: numeric('score', { precision: 6, scale: 3 }).notNull(),
    sales_velocity_score: numeric('sales_velocity_score', { precision: 6, scale: 3 }),
    margin_score: numeric('margin_score', { precision: 6, scale: 3 }),
    trend_score: numeric('trend_score', { precision: 6, scale: 3 }),
    competition_score: numeric('competition_score', { precision: 6, scale: 3 }),
    fulfillment_type: text('fulfillment_type').default('unknown'),
    estimated_margin_pct: numeric('estimated_margin_pct', { precision: 5, scale: 2 }),
    trend_keywords: jsonb('trend_keywords').default([]),
    opportunity_reason: text('opportunity_reason'),
    fulfillment_strategy: text('fulfillment_strategy'),
    supplier_action: text('supplier_action'),
    estimated_startup_cost: numeric('estimated_startup_cost', { precision: 10, scale: 2 }),
    risk_level: text('risk_level'),
    scored_at: timestamp('scored_at').defaultNow(),
    status: text('status').default('pending'),
  },
  (table) => ({
    scoreIdx: index('scored_products_score_idx').on(table.score),
    statusIdx: index('scored_products_status_idx').on(table.status),
    rawProductIdx: uniqueIndex('scored_products_raw_product_id_idx').on(table.raw_product_id),
  }),
);

export const scrapeJobs = pgTable(
  'scrape_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    scraper_name: text('scraper_name').notNull(),
    status: text('status').default('queued'),
    started_at: timestamp('started_at'),
    completed_at: timestamp('completed_at'),
    products_found: integer('products_found').default(0),
    error_message: text('error_message'),
    batch_id: text('batch_id').notNull().unique(),
    created_at: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    statusIdx: index('scrape_jobs_status_idx').on(table.status),
    scraperNameIdx: index('scrape_jobs_scraper_name_idx').on(table.scraper_name),
  }),
);
