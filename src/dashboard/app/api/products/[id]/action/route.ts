import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const DB_PATH = process.env.GHOSTMARKET_DB || path.resolve(process.cwd(), '../../data/ghostmarket.db');

function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

const VALID_ACTIONS = ['approve', 'skip', 'rescore', 'kill'] as const;
type Action = typeof VALID_ACTIONS[number];

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  let db: Database.Database | null = null;
  try {
    const body = await request.json();
    const action = body.action as string;

    if (!VALID_ACTIONS.includes(action as Action)) {
      return NextResponse.json(
        { success: false, error: `Invalid action: ${action}. Valid actions: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 },
      );
    }

    db = getDb();
    const productId = params.id;

    // Verify product exists
    const product = db.prepare('SELECT id, keyword, score, stage FROM products WHERE id = ?').get(productId) as
      { id: string; keyword: string; score: number | null; stage: string } | undefined;

    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Product not found' },
        { status: 404 },
      );
    }

    const decisionId = randomUUID();
    const now = new Date().toISOString();

    switch (action as Action) {
      case 'approve': {
        db.prepare('UPDATE products SET stage = ?, updated_at = ? WHERE id = ?')
          .run('approved', now, productId);
        db.prepare(
          `INSERT INTO operator_decisions (id, product_id, decision, product_score, product_context, created_at)
           VALUES (?, ?, 'approve', ?, ?, ?)`,
        ).run(decisionId, productId, product.score || 0, JSON.stringify(product), now);
        return NextResponse.json({
          success: true,
          message: `Product "${product.keyword}" approved. Builder agent will activate.`,
        });
      }

      case 'skip': {
        db.prepare('UPDATE products SET stage = ?, updated_at = ? WHERE id = ?')
          .run('skipped', now, productId);
        db.prepare(
          `INSERT INTO operator_decisions (id, product_id, decision, product_score, product_context, created_at)
           VALUES (?, ?, 'skip', ?, ?, ?)`,
        ).run(decisionId, productId, product.score || 0, JSON.stringify(product), now);
        return NextResponse.json({
          success: true,
          message: `Product "${product.keyword}" skipped.`,
        });
      }

      case 'rescore': {
        db.prepare('UPDATE products SET stage = ?, score = NULL, score_breakdown = NULL, updated_at = ? WHERE id = ?')
          .run('discovered', now, productId);
        return NextResponse.json({
          success: true,
          message: `Product "${product.keyword}" reset to discovered. Will be rescored in next cycle.`,
        });
      }

      case 'kill': {
        db.prepare('UPDATE products SET stage = ?, updated_at = ? WHERE id = ?')
          .run('killed', now, productId);
        db.prepare(
          `INSERT INTO operator_decisions (id, product_id, decision, product_score, product_context, created_at)
           VALUES (?, ?, 'kill', ?, ?, ?)`,
        ).run(decisionId, productId, product.score || 0, JSON.stringify(product), now);
        return NextResponse.json({
          success: true,
          message: `Product "${product.keyword}" killed. All activity stopped.`,
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    db?.close();
  }
}
