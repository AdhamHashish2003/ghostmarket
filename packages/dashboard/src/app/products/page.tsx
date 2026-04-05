'use client';

import { useEffect, useState, useCallback } from 'react';
import ProductCard from '@/components/ProductCard';
import { SkeletonProductGrid } from '@/components/Skeleton';

type Tab = 'pending' | 'approved' | 'rejected' | 'all';
type Sort = 'score' | 'sales' | 'margin' | 'trend';

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export default function ProductsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [sort, setSort] = useState<Sort>('score');
  const [products, setProducts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 24;

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = tab === 'all' ? '' : `&status=${tab}`;
      const res = await fetch(`/api/products?limit=${limit}&offset=${page * limit}&sort=${sort}${statusParam}`);
      const data = await res.json();
      setProducts(data.products ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tab, sort, page]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  async function handleAction(id: string, status: 'approved' | 'rejected') {
    await fetch(`/api/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setTotal((prev) => prev - 1);
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Products</h2>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-zinc-800 pb-3">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setPage(0); }}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-500">Sort:</span>
          {(['score', 'sales', 'margin', 'trend'] as Sort[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`text-xs px-2 py-1 rounded ${
                sort === s ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-zinc-500">{total} products</p>

      {/* Product grid */}
      {loading ? (
        <SkeletonProductGrid count={6} />
      ) : products.length === 0 ? (
        <p className="text-zinc-500 text-center py-12">No products found</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onApprove={tab === 'pending' ? (id) => handleAction(id, 'approved') : undefined}
              onReject={tab === 'pending' ? (id) => handleAction(id, 'rejected') : undefined}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 rounded bg-zinc-800 text-zinc-400 text-sm disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-xs text-zinc-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 rounded bg-zinc-800 text-zinc-400 text-sm disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
