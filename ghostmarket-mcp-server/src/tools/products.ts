import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../services/db.js";
import { ORCHESTRATOR_URL } from "../constants.js";

function uuid(): string { return crypto.randomUUID(); }

export function registerProductTools(server: McpServer): void {

  server.tool(
    "ghostmarket_list_products",
    "List products in the GhostMarket pipeline with optional filters for stage, score range, source, and outcome. Returns paginated results sorted by score descending.",
    {
      stage: z.enum(["discovered", "scored", "approved", "building", "live", "tracking", "completed", "skipped", "killed"]).optional().describe("Filter by pipeline stage"),
      min_score: z.number().min(0).max(100).optional().describe("Minimum score threshold"),
      max_score: z.number().min(0).max(100).optional().describe("Maximum score threshold"),
      outcome: z.enum(["win", "loss", "breakeven"]).optional().describe("Filter by outcome label"),
      limit: z.number().min(1).max(100).default(20).describe("Number of results"),
      offset: z.number().min(0).default(0).describe("Pagination offset"),
    },
    async ({ stage, min_score, max_score, outcome, limit, offset }) => {
      try {
        const db = getDb();
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (stage) { conditions.push("p.stage = ?"); params.push(stage); }
        if (min_score !== undefined) { conditions.push("p.score >= ?"); params.push(min_score); }
        if (max_score !== undefined) { conditions.push("p.score <= ?"); params.push(max_score); }
        if (outcome) { conditions.push("p.outcome_label = ?"); params.push(outcome); }
        const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
        const total = (db.prepare(`SELECT COUNT(*) as c FROM products p ${where}`).get(...params) as { c: number }).c;
        const rows = db.prepare(`
          SELECT p.id, p.keyword, p.category, p.stage, p.score, p.model_version,
                 p.decision, p.fulfillment_method, p.outcome_label, p.landing_page_url,
                 p.total_revenue, p.total_ad_spend, p.roas, p.created_at, p.updated_at
          FROM products p ${where}
          ORDER BY p.score DESC NULLS LAST
          LIMIT ? OFFSET ?
        `).all(...params, limit, offset);
        return { content: [{ type: "text" as const, text: JSON.stringify({ products: rows, total, has_more: offset + limit < total, next_offset: offset + limit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_product",
    "Get complete details for a single product — signals, score breakdown, suppliers, brand kit, landing pages, creatives, content posts, metrics, and outcome.",
    { product_id: z.string().describe("Product ID (full UUID or prefix)") },
    async ({ product_id }) => {
      try {
        const db = getDb();
        const product = db.prepare("SELECT * FROM products WHERE id = ? OR id LIKE ?").get(product_id, `${product_id}%`);
        if (!product) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Product ${product_id} not found` }) }], isError: true };
        const pid = (product as { id: string }).id;
        const signals = db.prepare("SELECT * FROM trend_signals WHERE product_id = ?").all(pid);
        const suppliers = db.prepare("SELECT * FROM suppliers WHERE product_id = ? ORDER BY is_best DESC, landed_cost ASC").all(pid);
        const brandKit = db.prepare("SELECT * FROM brand_kits WHERE product_id = ? LIMIT 1").get(pid);
        const pages = db.prepare("SELECT * FROM landing_pages WHERE product_id = ?").all(pid);
        const creatives = db.prepare("SELECT * FROM ad_creatives WHERE product_id = ?").all(pid);
        const posts = db.prepare("SELECT * FROM content_posts WHERE product_id = ?").all(pid);
        const metrics = db.prepare("SELECT * FROM campaign_metrics WHERE product_id = ? ORDER BY date DESC").all(pid);
        const decisions = db.prepare("SELECT * FROM operator_decisions WHERE product_id = ? ORDER BY created_at DESC").all(pid);
        return { content: [{ type: "text" as const, text: JSON.stringify({ product, signals, suppliers, brandKit, pages, creatives, posts, metrics, decisions }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_approve_product",
    "Approve a product — moves it to 'approved' stage and triggers the Builder agent to generate brand kit, landing pages, ad creatives, and content calendar.",
    { product_id: z.string().describe("Product ID to approve") },
    async ({ product_id }) => {
      try {
        const db = getDb();
        const product = db.prepare("SELECT * FROM products WHERE id = ? OR id LIKE ?").get(product_id, `${product_id}%`) as { id: string; keyword: string; score: number } | undefined;
        if (!product) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Product ${product_id} not found` }) }], isError: true };
        db.prepare("UPDATE products SET stage = 'approved' WHERE id = ?").run(product.id);
        db.prepare("INSERT INTO operator_decisions (id, product_id, decision, product_score) VALUES (?, ?, 'approve', ?)").run(uuid(), product.id, product.score);
        // Trigger builder
        try {
          await fetch(`${ORCHESTRATOR_URL}/trigger/build`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: product.id }) });
        } catch { /* orchestrator may not be running */ }
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, product_id: product.id, keyword: product.keyword, stage: "approved", message: "Builder agent triggered" }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_skip_product",
    "Skip a product — marks it as skipped and logs the decision as training data.",
    { product_id: z.string().describe("Product ID to skip"), reason: z.string().optional().describe("Reason for skipping") },
    async ({ product_id, reason }) => {
      try {
        const db = getDb();
        const product = db.prepare("SELECT * FROM products WHERE id = ? OR id LIKE ?").get(product_id, `${product_id}%`) as { id: string; keyword: string; score: number } | undefined;
        if (!product) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Product ${product_id} not found` }) }], isError: true };
        db.prepare("UPDATE products SET stage = 'skipped' WHERE id = ?").run(product.id);
        db.prepare("INSERT INTO operator_decisions (id, product_id, decision, product_score, notes) VALUES (?, ?, 'skip', ?, ?)").run(uuid(), product.id, product.score, reason || null);
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, product_id: product.id, keyword: product.keyword, stage: "skipped" }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_kill_product",
    "Kill a product — stops all activity and marks it as killed. This is destructive and cannot be undone.",
    { product_id: z.string().describe("Product ID to kill") },
    async ({ product_id }) => {
      try {
        const db = getDb();
        const product = db.prepare("SELECT * FROM products WHERE id = ? OR id LIKE ?").get(product_id, `${product_id}%`) as { id: string; keyword: string } | undefined;
        if (!product) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Product ${product_id} not found` }) }], isError: true };
        db.prepare("UPDATE products SET stage = 'killed' WHERE id = ?").run(product.id);
        db.prepare("INSERT INTO operator_decisions (id, product_id, decision) VALUES (?, ?, 'kill')").run(uuid(), product.id);
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, product_id: product.id, keyword: product.keyword, stage: "killed" }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_rescore_product",
    "Rescore a specific product using the latest scoring model. Triggers the Scorer agent via the orchestrator.",
    { product_id: z.string().describe("Product ID to rescore") },
    async ({ product_id }) => {
      try {
        const resp = await fetch(`${ORCHESTRATOR_URL}/trigger/score`, { method: "POST" });
        const data = await resp.json() as { triggered?: string; scored?: number; error?: string };
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...data, note: `Scorer triggered — will rescore product ${product_id} along with other pending products` }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message, suggestion: "Is the orchestrator running on port 4000?" }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_log_revenue",
    "Log revenue for a product. Adds to the running total.",
    { product_id: z.string().describe("Product ID"), amount: z.number().min(0).describe("Revenue amount in USD") },
    async ({ product_id, amount }) => {
      try {
        const db = getDb();
        const product = db.prepare("SELECT id, keyword, total_revenue FROM products WHERE id = ? OR id LIKE ?").get(product_id, `${product_id}%`) as { id: string; keyword: string; total_revenue: number } | undefined;
        if (!product) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Product ${product_id} not found` }) }], isError: true };
        db.prepare("UPDATE products SET total_revenue = total_revenue + ? WHERE id = ?").run(amount, product.id);
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, product_id: product.id, keyword: product.keyword, amount_added: amount, new_total: product.total_revenue + amount }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_log_outcome",
    "Log the final outcome for a product (win/loss/breakeven). Triggers the training data labeling cascade — labels all LLM calls, trend signals, and other child records for this product.",
    {
      product_id: z.string().describe("Product ID"),
      outcome: z.enum(["win", "loss", "breakeven"]).describe("Product outcome"),
      revenue: z.number().optional().describe("Total revenue in USD"),
      ad_spend: z.number().optional().describe("Total ad spend in USD"),
    },
    async ({ product_id, outcome, revenue, ad_spend }) => {
      try {
        const db = getDb();
        const product = db.prepare("SELECT id, keyword FROM products WHERE id = ? OR id LIKE ?").get(product_id, `${product_id}%`) as { id: string; keyword: string } | undefined;
        if (!product) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Product ${product_id} not found` }) }], isError: true };
        const pid = product.id;

        // Update product
        if (revenue !== undefined) db.prepare("UPDATE products SET total_revenue = ? WHERE id = ?").run(revenue, pid);
        if (ad_spend !== undefined) db.prepare("UPDATE products SET total_ad_spend = ? WHERE id = ?").run(ad_spend, pid);
        db.prepare("UPDATE products SET outcome_label = ?, stage = 'completed' WHERE id = ?").run(outcome, pid);

        // Cascade to training tables
        db.prepare("UPDATE trend_signals SET eventual_outcome = ? WHERE product_id = ?").run(outcome, pid);
        db.prepare("UPDATE suppliers SET eventual_outcome = ? WHERE product_id = ?").run(outcome, pid);
        db.prepare("UPDATE brand_kits SET eventual_outcome = ? WHERE product_id = ?").run(outcome, pid);
        db.prepare("UPDATE landing_pages SET eventual_outcome = ? WHERE product_id = ?").run(outcome, pid);
        db.prepare("UPDATE ad_creatives SET eventual_outcome = ? WHERE product_id = ?").run(outcome, pid);
        db.prepare("UPDATE content_posts SET eventual_outcome = ? WHERE product_id = ?").run(outcome, pid);
        db.prepare("UPDATE operator_decisions SET eventual_outcome = ? WHERE product_id = ?").run(outcome, pid);

        // Label LLM calls
        if (outcome === "win") {
          db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'keep' WHERE product_id = ?").run(outcome, pid);
        } else if (outcome === "loss") {
          db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'flip' WHERE product_id = ? AND task_type = 'product_evaluation'").run(outcome, pid);
          db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'discard' WHERE product_id = ? AND task_type != 'product_evaluation'").run(outcome, pid);
        } else {
          db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'keep' WHERE product_id = ? AND task_type = 'product_evaluation'").run(outcome, pid);
          db.prepare("UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'discard' WHERE product_id = ? AND task_type != 'product_evaluation'").run(outcome, pid);
        }

        // Create outcome record
        db.prepare("INSERT OR IGNORE INTO outcomes (id, product_id, outcome_label, total_revenue, total_ad_spend) VALUES (?, ?, ?, ?, ?)").run(uuid(), pid, outcome, revenue || 0, ad_spend || 0);

        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, product_id: pid, keyword: product.keyword, outcome, message: "All training data labeled" }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );
}
