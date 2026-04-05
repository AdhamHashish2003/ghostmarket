'use client';

export function SkeletonCard() {
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-5 animate-pulse">
      <div className="h-3 bg-zinc-700 rounded w-1/3 mb-3" />
      <div className="h-8 bg-zinc-700 rounded w-1/2" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-3 bg-zinc-800 border border-zinc-700 rounded-lg animate-pulse">
      <div className="w-10 h-10 bg-zinc-700 rounded" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-zinc-700 rounded w-2/3" />
        <div className="h-2 bg-zinc-700 rounded w-1/3" />
      </div>
      <div className="h-6 w-12 bg-zinc-700 rounded" />
    </div>
  );
}

export function SkeletonProductGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden animate-pulse">
          <div className="h-40 bg-zinc-700" />
          <div className="p-4 space-y-3">
            <div className="h-4 bg-zinc-700 rounded w-3/4" />
            <div className="h-3 bg-zinc-700 rounded w-1/2" />
            <div className="space-y-1.5">
              <div className="h-2 bg-zinc-700 rounded" />
              <div className="h-2 bg-zinc-700 rounded" />
              <div className="h-2 bg-zinc-700 rounded" />
              <div className="h-2 bg-zinc-700 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
