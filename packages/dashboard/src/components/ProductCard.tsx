'use client';

import ScoreBar from './ScoreBar';
import StatusBadge from './StatusBadge';

interface ProductCardProps {
  product: {
    id: string;
    title: string;
    source: string;
    price_usd: string;
    original_price_usd: string | null;
    score: string;
    sales_velocity_score: string | null;
    margin_score: string | null;
    trend_score: string | null;
    competition_score: string | null;
    fulfillment_type: string | null;
    estimated_monthly_sales: number | null;
    image_urls: string[] | unknown;
    trend_keywords: string[] | unknown;
    status: string | null;
  };
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  compact?: boolean;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

const sourceBadge: Record<string, string> = {
  aliexpress: 'bg-orange-500/20 text-orange-400',
  amazon: 'bg-yellow-500/20 text-yellow-400',
  tiktok_shop: 'bg-pink-500/20 text-pink-400',
  temu: 'bg-purple-500/20 text-purple-400',
};

export default function ProductCard({ product, onApprove, onReject, compact }: ProductCardProps) {
  const score = parseFloat(product.score);
  const images = Array.isArray(product.image_urls) ? product.image_urls as string[] : [];
  const keywords = Array.isArray(product.trend_keywords) ? product.trend_keywords as string[] : [];
  const discount =
    product.original_price_usd && parseFloat(product.original_price_usd) > 0
      ? Math.round(
          ((parseFloat(product.original_price_usd) - parseFloat(product.price_usd)) /
            parseFloat(product.original_price_usd)) *
            100,
        )
      : null;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-zinc-800 border border-zinc-700 rounded-lg hover:border-zinc-600 transition-colors">
        {images[0] && (
          <img src={images[0]} alt="" className="w-12 h-12 rounded object-cover bg-zinc-700" loading="lazy" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 truncate">{product.title}</p>
          <p className="text-xs text-zinc-500">${product.price_usd}</p>
        </div>
        <span className={`text-xl font-bold ${scoreColor(score)}`}>{score.toFixed(1)}</span>
        {onApprove && product.status === 'pending' && (
          <div className="flex gap-1">
            <button onClick={() => onApprove(product.id)} className="p-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-sm">&#10003;</button>
            <button onClick={() => onReject?.(product.id)} className="p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 text-sm">&#10005;</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden hover:border-zinc-600 transition-colors">
      {images[0] && (
        <img src={images[0]} alt="" className="w-full h-40 object-cover bg-zinc-700" loading="lazy" />
      )}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm text-zinc-200 line-clamp-2 flex-1">{product.title}</h3>
          <span className={`text-2xl font-bold ml-3 ${scoreColor(score)}`}>{score.toFixed(1)}</span>
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded ${sourceBadge[product.source] ?? 'bg-zinc-600 text-zinc-300'}`}>
            {product.source}
          </span>
          {product.fulfillment_type && product.fulfillment_type !== 'unknown' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-600 text-zinc-300">
              {product.fulfillment_type}
            </span>
          )}
          {product.status && <StatusBadge status={product.status} />}
        </div>

        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-lg font-semibold text-zinc-100">${product.price_usd}</span>
          {product.original_price_usd && (
            <span className="text-sm text-zinc-500 line-through">${product.original_price_usd}</span>
          )}
          {discount && discount > 0 && (
            <span className="text-xs text-emerald-400">-{discount}%</span>
          )}
        </div>

        {product.estimated_monthly_sales && (
          <p className="text-xs text-zinc-500 mb-3">~{product.estimated_monthly_sales.toLocaleString()} sales/mo</p>
        )}

        <div className="space-y-1.5 mb-3">
          <ScoreBar label="Sales" value={parseFloat(product.sales_velocity_score ?? '0')} />
          <ScoreBar label="Margin" value={parseFloat(product.margin_score ?? '0')} />
          <ScoreBar label="Trend" value={parseFloat(product.trend_score ?? '0')} />
          <ScoreBar label="Comp" value={parseFloat(product.competition_score ?? '0')} />
        </div>

        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {keywords.slice(0, 5).map((kw) => (
              <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
                {String(kw)}
              </span>
            ))}
          </div>
        )}

        {onApprove && product.status === 'pending' && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onApprove(product.id)}
              className="flex-1 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-sm font-medium transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => onReject?.(product.id)}
              className="flex-1 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 text-sm font-medium transition-colors"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
