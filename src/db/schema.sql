-- GhostMarket SQLite Schema
-- WAL mode enabled at connection time, not in schema
-- All tables: id TEXT PRIMARY KEY (UUID), created_at TEXT ISO8601, updated_at TEXT ISO8601
-- Training data is APPEND-ONLY: no DELETE triggers, no UPDATE on training columns

PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    keyword TEXT NOT NULL,
    category TEXT,
    stage TEXT NOT NULL DEFAULT 'discovered' CHECK(stage IN (
        'discovered', 'scored', 'approved', 'building', 'live', 'tracking', 'completed', 'skipped', 'killed'
    )),
    score REAL,
    score_breakdown TEXT, -- JSON object
    model_version TEXT,
    decision TEXT CHECK(decision IN ('recommend', 'skip', 'borderline')),
    fulfillment_method TEXT CHECK(fulfillment_method IN ('dropship', 'pod', 'manual')),
    best_supplier_id TEXT,
    brand_kit_id TEXT,
    landing_page_url TEXT,
    buffer_post_ids TEXT, -- JSON array
    daily_budget REAL DEFAULT 0,
    outcome_label TEXT CHECK(outcome_label IN ('win', 'loss', 'breakeven')),
    total_revenue REAL DEFAULT 0,
    total_ad_spend REAL DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    roas REAL,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_stage ON products(stage);
CREATE INDEX IF NOT EXISTS idx_products_score ON products(score);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_outcome ON products(outcome_label);
CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at);

CREATE TABLE IF NOT EXISTS trend_signals (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT REFERENCES products(id),
    source TEXT NOT NULL CHECK(source IN (
        'tiktok_cc', 'reddit', 'google_trends', 'amazon', 'aliexpress', 'pinterest'
    )),
    product_keyword TEXT NOT NULL,
    category TEXT,
    raw_signal_strength REAL NOT NULL,
    trend_velocity TEXT CHECK(trend_velocity IN ('rising', 'peaking', 'declining')),
    time_series_7d TEXT, -- JSON array of 7 values
    source_url TEXT,
    competing_ads_count INTEGER,
    avg_engagement_rate REAL,
    cross_source_hits INTEGER DEFAULT 1,
    signal_metadata TEXT, -- JSON object for source-specific data
    eventual_outcome TEXT CHECK(eventual_outcome IN ('win', 'loss', 'breakeven'))
);

CREATE INDEX IF NOT EXISTS idx_signals_product ON trend_signals(product_id);
CREATE INDEX IF NOT EXISTS idx_signals_source ON trend_signals(source);
CREATE INDEX IF NOT EXISTS idx_signals_keyword ON trend_signals(product_keyword);
CREATE INDEX IF NOT EXISTS idx_signals_created ON trend_signals(created_at);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT NOT NULL REFERENCES products(id),
    platform TEXT NOT NULL CHECK(platform IN (
        'aliexpress', 'cj_dropshipping', '1688', 'printful', 'printify'
    )),
    supplier_url TEXT,
    unit_cost REAL NOT NULL,
    shipping_cost REAL DEFAULT 0,
    landed_cost REAL NOT NULL,
    estimated_retail REAL,
    margin_pct REAL,
    shipping_days_min INTEGER,
    shipping_days_max INTEGER,
    warehouse TEXT,
    seller_rating REAL,
    total_orders INTEGER,
    moq INTEGER DEFAULT 1,
    is_best INTEGER DEFAULT 0,
    raw_data TEXT, -- JSON: full supplier response
    eventual_outcome TEXT CHECK(eventual_outcome IN ('win', 'loss', 'breakeven'))
);

CREATE INDEX IF NOT EXISTS idx_suppliers_product ON suppliers(product_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_platform ON suppliers(platform);

CREATE TABLE IF NOT EXISTS brand_kits (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT NOT NULL REFERENCES products(id),
    brand_name TEXT NOT NULL,
    brand_names_options TEXT, -- JSON array of 3 options
    color_palette TEXT, -- JSON array of hex colors
    typography TEXT, -- JSON object {heading, body}
    logo_prompt TEXT,
    logo_path TEXT,
    instagram_bio TEXT,
    page_description TEXT,
    approved INTEGER DEFAULT 0,
    operator_feedback TEXT,
    eventual_outcome TEXT CHECK(eventual_outcome IN ('win', 'loss', 'breakeven'))
);

CREATE INDEX IF NOT EXISTS idx_brand_kits_product ON brand_kits(product_id);

CREATE TABLE IF NOT EXISTS landing_pages (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT NOT NULL REFERENCES products(id),
    variant_id TEXT NOT NULL, -- A, B, C
    url TEXT,
    copy_approach TEXT CHECK(copy_approach IN ('benefit', 'story', 'urgency')),
    headline TEXT,
    subheadline TEXT,
    benefits TEXT, -- JSON array
    html_path TEXT,
    word_count INTEGER,
    deployed INTEGER DEFAULT 0,
    visits INTEGER DEFAULT 0,
    bounce_rate REAL,
    avg_time_on_page REAL,
    conversion_rate REAL,
    eventual_outcome TEXT CHECK(eventual_outcome IN ('win', 'loss', 'breakeven'))
);

CREATE INDEX IF NOT EXISTS idx_landing_pages_product ON landing_pages(product_id);

CREATE TABLE IF NOT EXISTS ad_creatives (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT NOT NULL REFERENCES products(id),
    platform TEXT NOT NULL CHECK(platform IN ('instagram', 'tiktok', 'facebook')),
    format TEXT NOT NULL CHECK(format IN ('square', 'vertical_9_16', 'horizontal')),
    hook_type TEXT CHECK(hook_type IN ('problem_solution', 'transformation', 'curiosity', 'social_proof', 'urgency')),
    copy_text TEXT,
    file_path TEXT,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL,
    eventual_outcome TEXT CHECK(eventual_outcome IN ('win', 'loss', 'breakeven'))
);

CREATE INDEX IF NOT EXISTS idx_creatives_product ON ad_creatives(product_id);
CREATE INDEX IF NOT EXISTS idx_creatives_platform ON ad_creatives(platform);

CREATE TABLE IF NOT EXISTS content_posts (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT NOT NULL REFERENCES products(id),
    buffer_post_id TEXT,
    platform TEXT NOT NULL,
    post_type TEXT CHECK(post_type IN ('product_showcase', 'lifestyle', 'ugc_style', 'benefit_focused', 'urgency_scarcity')),
    copy_text TEXT,
    image_path TEXT,
    scheduled_at TEXT,
    published_at TEXT,
    utm_url TEXT,
    impressions INTEGER DEFAULT 0,
    engagement INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    eventual_outcome TEXT CHECK(eventual_outcome IN ('win', 'loss', 'breakeven'))
);

CREATE INDEX IF NOT EXISTS idx_posts_product ON content_posts(product_id);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON content_posts(scheduled_at);

CREATE TABLE IF NOT EXISTS campaign_metrics (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT NOT NULL REFERENCES products(id),
    date TEXT NOT NULL, -- YYYY-MM-DD
    source TEXT NOT NULL, -- 'landing_page', 'instagram', 'tiktok', 'facebook', 'manual'
    visits INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue REAL DEFAULT 0,
    ad_spend REAL DEFAULT 0,
    refunds REAL DEFAULT 0,
    raw_data TEXT -- JSON
);

CREATE INDEX IF NOT EXISTS idx_metrics_product ON campaign_metrics(product_id);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON campaign_metrics(date);

CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT NOT NULL REFERENCES products(id),
    outcome_label TEXT NOT NULL CHECK(outcome_label IN ('win', 'loss', 'breakeven')),
    total_revenue REAL DEFAULT 0,
    total_ad_spend REAL DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    roas REAL,
    conversion_rate REAL,
    refund_rate REAL,
    days_active INTEGER,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_outcomes_product ON outcomes(product_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_label ON outcomes(outcome_label);

CREATE TABLE IF NOT EXISTS learning_cycles (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    cycle_number INTEGER NOT NULL,
    cycle_type TEXT NOT NULL CHECK(cycle_type IN ('xgboost', 'qlora', 'reflection')),
    model_version_before TEXT,
    model_version_after TEXT,
    accuracy_before REAL,
    accuracy_after REAL,
    training_samples INTEGER,
    holdout_samples INTEGER,
    feature_importance TEXT, -- JSON array of [feature, weight] pairs
    source_hit_rates TEXT, -- JSON object
    strategy_summary TEXT,
    weight_adjustments TEXT, -- JSON object
    deployed INTEGER DEFAULT 0,
    error_log TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_cycle_num ON learning_cycles(cycle_number);
CREATE INDEX IF NOT EXISTS idx_learning_cycle_type ON learning_cycles(cycle_type);

CREATE TABLE IF NOT EXISTS operator_decisions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT NOT NULL REFERENCES products(id),
    decision TEXT NOT NULL CHECK(decision IN ('approve', 'skip', 'modify', 'kill')),
    product_score REAL,
    product_context TEXT, -- JSON: full product card data at decision time
    modification_notes TEXT,
    telegram_message_id TEXT,
    eventual_outcome TEXT CHECK(eventual_outcome IN ('win', 'loss', 'breakeven'))
);

CREATE INDEX IF NOT EXISTS idx_decisions_product ON operator_decisions(product_id);
CREATE INDEX IF NOT EXISTS idx_decisions_decision ON operator_decisions(decision);

CREATE TABLE IF NOT EXISTS human_actions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    product_id TEXT REFERENCES products(id),
    action_type TEXT NOT NULL,
    action_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'skipped')),
    telegram_message_id INTEGER,
    operator_data TEXT,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_human_actions_status ON human_actions(status);
CREATE INDEX IF NOT EXISTS idx_human_actions_product ON human_actions(product_id);

CREATE TABLE IF NOT EXISTS system_events (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    agent TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN (
        'error', 'retry', 'rate_limit', 'api_failure', 'scrape_failure',
        'failover', 'recovery', 'health_check', 'startup', 'shutdown'
    )),
    severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'error', 'critical')),
    message TEXT NOT NULL,
    metadata TEXT, -- JSON
    resolved INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_agent ON system_events(agent);
CREATE INDEX IF NOT EXISTS idx_events_type ON system_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_severity ON system_events(severity);
CREATE INDEX IF NOT EXISTS idx_events_created ON system_events(created_at);

CREATE TABLE IF NOT EXISTS llm_calls (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    task_type TEXT NOT NULL CHECK(task_type IN (
        'product_evaluation', 'ad_hook', 'brand_naming',
        'landing_page_copy', 'social_caption', 'pricing_strategy',
        'creative_direction', 'strategy_reflection'
    )),
    model_used TEXT NOT NULL,
    input_prompt TEXT NOT NULL,
    output_text TEXT NOT NULL,
    product_id TEXT REFERENCES products(id),
    tokens_in INTEGER,
    tokens_out INTEGER,
    latency_ms INTEGER,
    eventual_outcome TEXT CHECK(eventual_outcome IN ('win', 'loss', 'breakeven')),
    outcome_quality TEXT CHECK(outcome_quality IN ('keep', 'discard', 'flip')),
    included_in_training INTEGER DEFAULT 0,
    training_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_task ON llm_calls(task_type);
CREATE INDEX IF NOT EXISTS idx_llm_calls_product ON llm_calls(product_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_model ON llm_calls(model_used);
CREATE INDEX IF NOT EXISTS idx_llm_calls_outcome ON llm_calls(outcome_quality);
CREATE INDEX IF NOT EXISTS idx_llm_calls_training ON llm_calls(included_in_training);

-- ============================================================
-- TRAINING EXPORT VIEW (denormalized for ML)
-- ============================================================

CREATE VIEW IF NOT EXISTS training_export AS
SELECT
    p.id AS product_id,
    p.keyword,
    p.category,
    p.score,
    p.score_breakdown,
    p.model_version,
    p.decision,
    p.fulfillment_method,
    p.outcome_label,
    p.total_revenue,
    p.total_ad_spend,
    p.total_orders,
    p.roas,
    p.created_at AS product_created_at,
    -- Best supplier data
    s.platform AS supplier_platform,
    s.unit_cost,
    s.shipping_cost,
    s.landed_cost,
    s.estimated_retail,
    s.margin_pct,
    s.shipping_days_min,
    s.shipping_days_max,
    s.warehouse,
    s.seller_rating,
    s.total_orders AS supplier_total_orders,
    -- Aggregated trend signals
    (SELECT COUNT(*) FROM trend_signals ts WHERE ts.product_id = p.id) AS signal_count,
    (SELECT GROUP_CONCAT(DISTINCT ts.source) FROM trend_signals ts WHERE ts.product_id = p.id) AS signal_sources,
    (SELECT AVG(ts.raw_signal_strength) FROM trend_signals ts WHERE ts.product_id = p.id) AS avg_signal_strength,
    (SELECT MAX(ts.cross_source_hits) FROM trend_signals ts WHERE ts.product_id = p.id) AS max_cross_source_hits,
    -- Brand kit
    bk.brand_name,
    bk.approved AS brand_approved,
    -- Landing page performance (best variant)
    (SELECT lp.copy_approach FROM landing_pages lp WHERE lp.product_id = p.id ORDER BY lp.conversion_rate DESC LIMIT 1) AS best_copy_approach,
    (SELECT MAX(lp.conversion_rate) FROM landing_pages lp WHERE lp.product_id = p.id) AS best_conversion_rate,
    -- Ad creative performance
    (SELECT ac.hook_type FROM ad_creatives ac WHERE ac.product_id = p.id ORDER BY ac.ctr DESC LIMIT 1) AS best_hook_type,
    (SELECT MAX(ac.ctr) FROM ad_creatives ac WHERE ac.product_id = p.id) AS best_ctr,
    -- Content performance
    (SELECT SUM(cp.impressions) FROM content_posts cp WHERE cp.product_id = p.id) AS total_impressions,
    (SELECT SUM(cp.engagement) FROM content_posts cp WHERE cp.product_id = p.id) AS total_engagement,
    (SELECT SUM(cp.clicks) FROM content_posts cp WHERE cp.product_id = p.id) AS total_clicks,
    -- Operator decision
    od.decision AS operator_decision,
    od.modification_notes,
    -- Outcome
    o.days_active,
    o.refund_rate
FROM products p
LEFT JOIN suppliers s ON s.product_id = p.id AND s.is_best = 1
LEFT JOIN brand_kits bk ON bk.product_id = p.id AND bk.approved = 1
LEFT JOIN operator_decisions od ON od.product_id = p.id
LEFT JOIN outcomes o ON o.product_id = p.id
WHERE p.outcome_label IS NOT NULL;

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================

CREATE TRIGGER IF NOT EXISTS products_updated AFTER UPDATE ON products
BEGIN UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trend_signals_updated AFTER UPDATE ON trend_signals
BEGIN UPDATE trend_signals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS suppliers_updated AFTER UPDATE ON suppliers
BEGIN UPDATE suppliers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS brand_kits_updated AFTER UPDATE ON brand_kits
BEGIN UPDATE brand_kits SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS landing_pages_updated AFTER UPDATE ON landing_pages
BEGIN UPDATE landing_pages SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS ad_creatives_updated AFTER UPDATE ON ad_creatives
BEGIN UPDATE ad_creatives SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS content_posts_updated AFTER UPDATE ON content_posts
BEGIN UPDATE content_posts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS campaign_metrics_updated AFTER UPDATE ON campaign_metrics
BEGIN UPDATE campaign_metrics SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS outcomes_updated AFTER UPDATE ON outcomes
BEGIN UPDATE outcomes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS learning_cycles_updated AFTER UPDATE ON learning_cycles
BEGIN UPDATE learning_cycles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS operator_decisions_updated AFTER UPDATE ON operator_decisions
BEGIN UPDATE operator_decisions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS system_events_updated AFTER UPDATE ON system_events
BEGIN UPDATE system_events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS llm_calls_updated AFTER UPDATE ON llm_calls
BEGIN UPDATE llm_calls SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END;
