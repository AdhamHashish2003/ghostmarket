export interface RawProduct {
  id: string;
  source: 'aliexpress' | 'alibaba' | 'amazon' | 'tiktok_shop' | 'temu';
  external_id: string;
  title: string;
  price_usd: number;
  original_price_usd: number | null;
  currency: string;
  estimated_monthly_sales: number | null;
  review_count: number;
  rating: number | null;
  category: string;
  sub_category: string | null;
  supplier_name: string | null;
  supplier_url: string | null;
  product_url: string;
  image_urls: string[];
  tags: string[];
  scraped_at: Date;
  batch_id: string;
}

export interface TrendSignal {
  id: string;
  keyword: string;
  source: 'google_trends' | 'tiktok' | 'twitter' | 'news';
  interest_score: number;
  velocity: number;
  related_queries: string[];
  geo: string;
  captured_at: Date;
}

export interface ScoredProduct {
  id: string;
  raw_product_id: string;
  score: number;
  sales_velocity_score: number;
  margin_score: number;
  trend_score: number;
  competition_score: number;
  fulfillment_type: 'pod' | 'dropship' | 'wholesale' | 'digital' | 'unknown';
  estimated_margin_pct: number;
  trend_keywords: string[];
  scored_at: Date;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ScrapeJob {
  id: string;
  scraper_name: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  started_at: Date | null;
  completed_at: Date | null;
  products_found: number;
  error_message: string | null;
  batch_id: string;
}
