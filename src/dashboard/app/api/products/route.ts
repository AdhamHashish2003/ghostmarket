import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';

function getDb(): Database.Database {
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

const VALID_STAGES = [
  'discovered', 'scored', 'approved', 'building', 'live', 'tracking', 'completed', 'skipped', 'killed',
];
const VALID_OUTCOMES = ['win', 'loss', 'breakeven'];
const VALID_SORT_FIELDS = ['score', 'created_at', 'revenue', 'total_revenue', 'total_ad_spend', 'roas'];
const VALID_SORT_DIRS = ['asc', 'desc'];

export async function GET(request: Request) {
  let db: Database.Database | null = null;
  try {
    const { searchParams } = new URL(request.url);

    // Pagination
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    // Filters
    const stage = searchParams.get('stage');
    const minScore = searchParams.get('minScore');
    const maxScore = searchParams.get('maxScore');
    const source = searchParams.get('source');
    const outcome = searchParams.get('outcome');
    const search = searchParams.get('search');

    // Sorting
    let sortField = searchParams.get('sort') || 'created_at';
    let sortDir = (searchParams.get('dir') || 'desc').toLowerCase();

    // Map 'revenue' alias to actual column
    if (sortField === 'revenue') sortField = 'total_revenue';

    if (!VALID_SORT_FIELDS.includes(sortField)) sortField = 'created_at';
    if (!VALID_SORT_DIRS.includes(sortDir)) sortDir = 'desc';

    // Build query
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (stage && VALID_STAGES.includes(stage)) {
      conditions.push('p.stage = ?');
      params.push(stage);
    }

    if (minScore !== null && minScore !== '') {
      const val = parseFloat(minScore);
      if (!isNaN(val)) {
        conditions.push('p.score >= ?');
        params.push(val);
      }
    }

    if (maxScore !== null && maxScore !== '') {
      const val = parseFloat(maxScore);
      if (!isNaN(val)) {
        conditions.push('p.score <= ?');
        params.push(val);
      }
    }

    if (outcome && VALID_OUTCOMES.includes(outcome)) {
      conditions.push('p.outcome_label = ?');
      params.push(outcome);
    }

    if (search) {
      conditions.push('p.keyword LIKE ?');
      params.push(`%${search}%`);
    }

    // Source filter: join with trend_signals
    let sourceJoin = '';
    if (source) {
      sourceJoin = 'INNER JOIN trend_signals ts ON ts.product_id = p.id AND ts.source = ?';
      params.unshift(source); // source param comes first due to JOIN position
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    db = getDb();

    // Total count
    const countQuery = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM products p
      ${sourceJoin}
      ${whereClause}
    `;
    const totalResult = db.prepare(countQuery).get(...params) as { total: number };

    // Products query
    const dataQuery = `
      SELECT DISTINCT
        p.id, p.keyword, p.category, p.stage, p.score, p.score_breakdown,
        p.model_version, p.decision, p.fulfillment_method,
        p.outcome_label, p.total_revenue, p.total_ad_spend, p.total_orders,
        p.roas, p.daily_budget, p.notes, p.created_at, p.updated_at
      FROM products p
      ${sourceJoin}
      ${whereClause}
      ORDER BY p.${sortField} ${sortDir} NULLS LAST
      LIMIT ? OFFSET ?
    `;
    const products = db.prepare(dataQuery).all(...params, limit, offset);

    // Parse JSON fields
    const enriched = (products as Record<string, unknown>[]).map((p) => ({
      ...p,
      score_breakdown: p.score_breakdown ? tryParseJson(p.score_breakdown as string) : null,
    }));

    return NextResponse.json({
      products: enriched,
      pagination: {
        page,
        limit,
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / limit),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
