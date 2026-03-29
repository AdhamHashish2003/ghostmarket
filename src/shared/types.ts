// GhostMarket — Shared TypeScript Interfaces
// All interfaces mirror SQLite schema for type safety across services

export type ProductStage =
  | 'discovered'
  | 'scored'
  | 'approved'
  | 'building'
  | 'live'
  | 'tracking'
  | 'completed'
  | 'skipped'
  | 'killed';

export type OutcomeLabel = 'win' | 'loss' | 'breakeven';
export type Decision = 'recommend' | 'skip' | 'borderline';
export type FulfillmentMethod = 'dropship' | 'pod' | 'manual';
export type TrendVelocity = 'rising' | 'peaking' | 'declining';
export type OperatorAction = 'approve' | 'skip' | 'modify' | 'kill';

export type TrendSource =
  | 'tiktok_cc'
  | 'reddit'
  | 'google_trends'
  | 'amazon'
  | 'aliexpress'
  | 'pinterest';

export type SupplierPlatform =
  | 'aliexpress'
  | 'cj_dropshipping'
  | '1688'
  | 'printful'
  | 'printify';

export type AdPlatform = 'instagram' | 'tiktok' | 'facebook';
export type AdFormat = 'square' | 'vertical_9_16' | 'horizontal';
export type HookType =
  | 'problem_solution'
  | 'transformation'
  | 'curiosity'
  | 'social_proof'
  | 'urgency';

export type CopyApproach = 'benefit' | 'story' | 'urgency';

export type PostType =
  | 'product_showcase'
  | 'lifestyle'
  | 'ugc_style'
  | 'benefit_focused'
  | 'urgency_scarcity';

export type LLMTaskType =
  | 'product_evaluation'
  | 'ad_hook'
  | 'brand_naming'
  | 'landing_page_copy'
  | 'social_caption'
  | 'pricing_strategy'
  | 'creative_direction'
  | 'strategy_reflection';

export type SystemEventType =
  | 'error'
  | 'retry'
  | 'rate_limit'
  | 'api_failure'
  | 'scrape_failure'
  | 'failover'
  | 'recovery'
  | 'health_check'
  | 'startup'
  | 'shutdown';

export type Severity = 'info' | 'warning' | 'error' | 'critical';
export type LearningCycleType = 'xgboost' | 'qlora' | 'reflection';
export type OutcomeQuality = 'keep' | 'discard' | 'flip';

// ============================================================
// ENTITY INTERFACES
// ============================================================

export interface Product {
  id: string;
  created_at: string;
  updated_at: string;
  keyword: string;
  category: string | null;
  stage: ProductStage;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  model_version: string | null;
  decision: Decision | null;
  fulfillment_method: FulfillmentMethod | null;
  best_supplier_id: string | null;
  brand_kit_id: string | null;
  landing_page_url: string | null;
  buffer_post_ids: string[] | null;
  daily_budget: number;
  outcome_label: OutcomeLabel | null;
  total_revenue: number;
  total_ad_spend: number;
  total_orders: number;
  roas: number | null;
  notes: string | null;
}

export interface ScoreBreakdown {
  trend_velocity: number;
  margin_potential: number;
  competition_level: number;
  fulfillment_ease: number;
  content_potential: number;
  cross_source_validation: number;
  seasonality_fit: number;
}

export interface TrendSignal {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string | null;
  source: TrendSource;
  product_keyword: string;
  category: string | null;
  raw_signal_strength: number;
  trend_velocity: TrendVelocity | null;
  time_series_7d: number[] | null;
  source_url: string | null;
  competing_ads_count: number | null;
  avg_engagement_rate: number | null;
  cross_source_hits: number;
  signal_metadata: Record<string, unknown> | null;
  eventual_outcome: OutcomeLabel | null;
}

export interface Supplier {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string;
  platform: SupplierPlatform;
  supplier_url: string | null;
  unit_cost: number;
  shipping_cost: number;
  landed_cost: number;
  estimated_retail: number | null;
  margin_pct: number | null;
  shipping_days_min: number | null;
  shipping_days_max: number | null;
  warehouse: string | null;
  seller_rating: number | null;
  total_orders: number | null;
  moq: number;
  is_best: boolean;
  raw_data: Record<string, unknown> | null;
  eventual_outcome: OutcomeLabel | null;
}

export interface BrandKit {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string;
  brand_name: string;
  brand_names_options: string[] | null;
  color_palette: string[] | null;
  typography: { heading: string; body: string } | null;
  logo_prompt: string | null;
  logo_path: string | null;
  instagram_bio: string | null;
  page_description: string | null;
  approved: boolean;
  operator_feedback: string | null;
  eventual_outcome: OutcomeLabel | null;
}

export interface LandingPage {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string;
  variant_id: string;
  url: string | null;
  copy_approach: CopyApproach | null;
  headline: string | null;
  subheadline: string | null;
  benefits: string[] | null;
  html_path: string | null;
  word_count: number | null;
  deployed: boolean;
  visits: number;
  bounce_rate: number | null;
  avg_time_on_page: number | null;
  conversion_rate: number | null;
  eventual_outcome: OutcomeLabel | null;
}

export interface AdCreative {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string;
  platform: AdPlatform;
  format: AdFormat;
  hook_type: HookType | null;
  copy_text: string | null;
  file_path: string | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
  eventual_outcome: OutcomeLabel | null;
}

export interface ContentPost {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string;
  buffer_post_id: string | null;
  platform: string;
  post_type: PostType | null;
  copy_text: string | null;
  image_path: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  utm_url: string | null;
  impressions: number;
  engagement: number;
  clicks: number;
  eventual_outcome: OutcomeLabel | null;
}

export interface CampaignMetric {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string;
  date: string;
  source: string;
  visits: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ad_spend: number;
  refunds: number;
  raw_data: Record<string, unknown> | null;
}

export interface Outcome {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string;
  outcome_label: OutcomeLabel;
  total_revenue: number;
  total_ad_spend: number;
  total_orders: number;
  roas: number | null;
  conversion_rate: number | null;
  refund_rate: number | null;
  days_active: number | null;
  notes: string | null;
}

export interface LearningCycle {
  id: string;
  created_at: string;
  updated_at: string;
  cycle_number: number;
  cycle_type: LearningCycleType;
  model_version_before: string | null;
  model_version_after: string | null;
  accuracy_before: number | null;
  accuracy_after: number | null;
  training_samples: number | null;
  holdout_samples: number | null;
  feature_importance: Array<[string, number]> | null;
  source_hit_rates: Record<string, number> | null;
  strategy_summary: string | null;
  weight_adjustments: Record<string, string> | null;
  deployed: boolean;
  error_log: string | null;
}

export interface OperatorDecision {
  id: string;
  created_at: string;
  updated_at: string;
  product_id: string;
  decision: OperatorAction;
  product_score: number | null;
  product_context: Record<string, unknown> | null;
  modification_notes: string | null;
  telegram_message_id: string | null;
  eventual_outcome: OutcomeLabel | null;
}

export interface SystemEvent {
  id: string;
  created_at: string;
  updated_at: string;
  agent: string;
  event_type: SystemEventType;
  severity: Severity;
  message: string;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
}

export interface LLMCall {
  id: string;
  created_at: string;
  updated_at: string;
  task_type: LLMTaskType;
  model_used: string;
  input_prompt: string;
  output_text: string;
  product_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  eventual_outcome: OutcomeLabel | null;
  outcome_quality: OutcomeQuality | null;
  included_in_training: boolean;
  training_version: string | null;
}

// ============================================================
// AGENT COMMUNICATION
// ============================================================

export interface AgentEvent {
  agent: string;
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ROGWorkerJob {
  job_id: string;
  job_type: 'scrape' | 'remove_bg' | 'generate_image' | 'evaluate' | 'train' | 'claude_code';
  payload: Record<string, unknown>;
  callback_url: string;
}

export interface ROGWorkerResult {
  job_id: string;
  job_type: string;
  success: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
}

// ============================================================
// TELEGRAM
// ============================================================

export interface ProductCard {
  product: Product;
  signals: TrendSignal[];
  best_supplier: Supplier | null;
  score_breakdown: ScoreBreakdown;
  brand_suggestion: string | null;
  is_high_priority: boolean; // score >= 90
}

export interface TelegramCommand {
  command: string;
  args: string[];
  chat_id: number;
  message_id: number;
}

// ============================================================
// CONFIG
// ============================================================

export const SEED_CATEGORIES = [
  'home_decor',
  'gadgets',
  'fitness',
  'kitchen',
  'car_accessories',
  'pet_products',
] as const;

export type SeedCategory = (typeof SEED_CATEGORIES)[number];

export const SCORE_THRESHOLD = 65;
export const HIGH_PRIORITY_THRESHOLD = 90;
export const MAX_TELEGRAM_PRODUCTS_PER_DAY = 10;

export const SCORING_WEIGHTS = {
  trend_velocity: 0.25,
  margin_potential: 0.25,
  competition_level: 0.15,
  fulfillment_ease: 0.10,
  content_potential: 0.10,
  cross_source_validation: 0.10,
  seasonality_fit: 0.05,
} as const;

export const SEED_CATEGORY_BONUS = 0.05; // 5% bonus for seed categories
