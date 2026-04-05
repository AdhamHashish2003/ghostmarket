import { eq, sql } from 'drizzle-orm';
import { db, rawProducts, logger } from '@ghostmarket/shared';

// --- Text normalization ---

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

// --- Jaccard similarity ---

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// --- Levenshtein distance (for short normalized titles) ---

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Only compute for reasonably short strings
  if (a.length > 100 || b.length > 100) return 999;

  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

// --- Main deduplication ---

export async function deduplicateProducts(batchId: string): Promise<number> {
  logger.info({ batchId }, 'Starting cross-batch deduplication');

  // Fetch new batch products
  const batchProducts = await db
    .select({
      id: rawProducts.id,
      title: rawProducts.title,
      price_usd: rawProducts.price_usd,
      tags: rawProducts.tags,
    })
    .from(rawProducts)
    .where(eq(rawProducts.batch_id, batchId));

  if (batchProducts.length === 0) {
    logger.info({ batchId }, 'No products to deduplicate');
    return 0;
  }

  // Fetch ALL existing products (from other batches) that aren't already duplicates
  const existingProducts = await db
    .select({
      id: rawProducts.id,
      title: rawProducts.title,
      price_usd: rawProducts.price_usd,
      tags: rawProducts.tags,
      batch_id: rawProducts.batch_id,
    })
    .from(rawProducts)
    .where(sql`${rawProducts.batch_id} != ${batchId} AND NOT (${rawProducts.tags}::jsonb ? 'duplicate')`);

  // Build normalized representations for existing products
  const existingItems = existingProducts.map((p) => ({
    id: p.id,
    normalized: normalizeTitle(p.title),
    tokens: tokenize(p.title),
    priceUsd: parseFloat(p.price_usd),
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
  }));

  // Build normalized representations for batch products
  const batchItems = batchProducts.map((p) => ({
    id: p.id,
    normalized: normalizeTitle(p.title),
    tokens: tokenize(p.title),
    priceUsd: parseFloat(p.price_usd),
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
  }));

  const allItems = [...existingItems, ...batchItems];
  const duplicateIds: string[] = [];
  const processed = new Set<string>();

  // Compare all products against each other
  for (let i = 0; i < allItems.length; i++) {
    if (processed.has(allItems[i].id)) continue;

    const group: typeof allItems = [allItems[i]];

    for (let j = i + 1; j < allItems.length; j++) {
      if (processed.has(allItems[j].id)) continue;

      const isSimilar =
        levenshtein(allItems[i].normalized, allItems[j].normalized) < 5 ||
        jaccardSimilarity(allItems[i].tokens, allItems[j].tokens) > 0.7;

      if (isSimilar) {
        group.push(allItems[j]);
      }
    }

    if (group.length > 1) {
      // Keep the cheapest product, mark the rest as duplicates
      group.sort((a, b) => a.priceUsd - b.priceUsd);
      const keep = group[0];

      for (let k = 1; k < group.length; k++) {
        const dupe = group[k];
        duplicateIds.push(dupe.id);
        processed.add(dupe.id);

        // Add 'duplicate' tag
        const updatedTags = [...dupe.tags, 'duplicate'];
        await db
          .update(rawProducts)
          .set({ tags: updatedTags })
          .where(eq(rawProducts.id, dupe.id));
      }

      processed.add(keep.id);
    }
  }

  logger.info(
    { batchId, total: batchProducts.length, crossBatchTotal: allItems.length, duplicates: duplicateIds.length },
    'Cross-batch deduplication complete',
  );

  return duplicateIds.length;
}
