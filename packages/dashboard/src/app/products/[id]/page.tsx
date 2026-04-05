'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ScoreBar from '@/components/ScoreBar';
import StatusBadge from '@/components/StatusBadge';
import { SkeletonCard } from '@/components/Skeleton';

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [product, setProduct] = useState<any>(null);
  const [priceHistory, setPriceHistory] = useState<{ date: string; price: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setProduct(data.product);
        setPriceHistory(data.priceHistory ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleAction(status: 'approved' | 'rejected') {
    await fetch(`/api/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setProduct((p: any) => ({ ...p, status }));
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!product) {
    return <p className="text-zinc-500">Product not found</p>;
  }

  const images = Array.isArray(product.image_urls) ? product.image_urls as string[] : [];
  const keywords = Array.isArray(product.trend_keywords) ? product.trend_keywords as string[] : [];
  const score = parseFloat(product.score ?? '0');
  const scoreColor = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
  const maxPrice = priceHistory.length > 0 ? Math.max(...priceHistory.map((p) => p.price)) : 1;

  return (
    <div className="max-w-4xl space-y-6">
      <button onClick={() => router.back()} className="text-sm text-zinc-500 hover:text-zinc-300">
        &larr; Back
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Images */}
        <div>
          {images.length > 0 ? (
            <div className="space-y-2">
              <img src={images[0]} alt="" className="w-full rounded-lg bg-zinc-800 object-cover max-h-80" />
              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto">
                  {images.slice(1, 5).map((url, i) => (
                    <img key={i} src={url} alt="" className="w-20 h-20 rounded bg-zinc-800 object-cover shrink-0" />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-64 bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-600">
              No image
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-100">{product.title}</h2>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">{product.source}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">{product.category}</span>
              {product.fulfillment_type && product.fulfillment_type !== 'unknown' && (
                <span className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">{product.fulfillment_type}</span>
              )}
              <StatusBadge status={product.status ?? 'pending'} />
            </div>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-zinc-100">${product.price_usd}</span>
            {product.original_price_usd && (
              <span className="text-lg text-zinc-500 line-through">${product.original_price_usd}</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <span className={`text-4xl font-bold ${scoreColor}`}>{score.toFixed(1)}</span>
            <span className="text-sm text-zinc-500">/ 100</span>
          </div>

          <div className="space-y-2">
            <ScoreBar label="Sales" value={parseFloat(product.sales_velocity_score ?? '0')} />
            <ScoreBar label="Margin" value={parseFloat(product.margin_score ?? '0')} />
            <ScoreBar label="Trend" value={parseFloat(product.trend_score ?? '0')} />
            <ScoreBar label="Comp" value={parseFloat(product.competition_score ?? '0')} />
          </div>

          {product.estimated_monthly_sales && (
            <p className="text-sm text-zinc-400">
              Est. monthly sales: <span className="text-zinc-200">{product.estimated_monthly_sales.toLocaleString()}</span>
            </p>
          )}

          {product.estimated_margin_pct && (
            <p className="text-sm text-zinc-400">
              Est. margin: <span className="text-zinc-200">{product.estimated_margin_pct}%</span>
            </p>
          )}

          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {keywords.map((kw) => (
                <span key={String(kw)} className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {String(kw)}
                </span>
              ))}
            </div>
          )}

          <a
            href={product.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-emerald-400 hover:text-emerald-300 underline"
          >
            View original listing &rarr;
          </a>
        </div>
      </div>

      {/* Price history */}
      {priceHistory.length > 1 && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3">Price History</h3>
          <div className="flex items-end gap-1 h-32">
            {priceHistory.slice().reverse().map((p, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-emerald-500/50 rounded-t"
                  style={{ height: `${(p.price / maxPrice) * 100}%` }}
                  title={`$${p.price.toFixed(2)} — ${p.date.split('T')[0]}`}
                />
                <span className="text-[8px] text-zinc-600 rotate-[-45deg] origin-top-left whitespace-nowrap">
                  {p.date.split('T')[0]?.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {product.status === 'pending' && (
          <>
            <button
              onClick={() => handleAction('approved')}
              className="px-6 py-2 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 font-medium transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => handleAction('rejected')}
              className="px-6 py-2 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 font-medium transition-colors"
            >
              Reject
            </button>
          </>
        )}
        <button onClick={() => router.push('/products')} className="px-6 py-2 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 font-medium transition-colors">
          Skip
        </button>
        <button disabled className="px-6 py-2 rounded bg-zinc-800 text-zinc-600 cursor-not-allowed font-medium">
          Send to ListingForge
        </button>
        <button disabled className="px-6 py-2 rounded bg-zinc-800 text-zinc-600 cursor-not-allowed font-medium">
          Send to SocialForge
        </button>
      </div>
    </div>
  );
}
