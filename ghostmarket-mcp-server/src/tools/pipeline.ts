import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../services/db.js";

export function registerPipelineTools(server: McpServer): void {

  server.tool(
    "ghostmarket_get_pipeline_status",
    "Returns the count of products in each pipeline stage: discovered, scored, approved, building, live, tracking, completed, skipped, killed. Use this to get an overview of what GhostMarket is doing right now.",
    {},
    async () => {
      try {
        const db = getDb();
        const stages = db.prepare("SELECT stage, COUNT(*) as count FROM products GROUP BY stage ORDER BY count DESC").all() as Array<{ stage: string; count: number }>;
        const result = Object.fromEntries(stages.map(s => [s.stage, s.count]));
        const total = stages.reduce((sum, s) => sum + s.count, 0);
        return { content: [{ type: "text" as const, text: JSON.stringify({ total, stages: result }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message, suggestion: "Check GHOSTMARKET_DB env var points to the correct database" }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_events",
    "Get the most recent system events from all GhostMarket agents. Use to monitor what the system has been doing.",
    { limit: z.number().min(1).max(200).default(50).describe("Number of events to return"), event_type: z.string().optional().describe("Filter by event type (e.g. startup, health_check, error, api_failure)") },
    async ({ limit, event_type }) => {
      try {
        const db = getDb();
        let sql = "SELECT id, agent, event_type, severity, message, created_at FROM system_events";
        const params: unknown[] = [];
        if (event_type) { sql += " WHERE event_type = ?"; params.push(event_type); }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(limit);
        const events = db.prepare(sql).all(...params);
        return { content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_health",
    "Get agent health status — green/yellow/red per agent based on error counts in last 24 hours. Green = 0 errors, Yellow = 1-5 errors, Red = 6+ errors.",
    {},
    async () => {
      try {
        const db = getDb();
        const agents = db.prepare(`
          SELECT agent,
            COUNT(CASE WHEN severity IN ('error','critical') THEN 1 END) as errors,
            COUNT(CASE WHEN severity = 'warning' THEN 1 END) as warnings,
            MAX(created_at) as last_seen
          FROM system_events
          WHERE created_at > datetime('now', '-24 hours')
          GROUP BY agent
        `).all() as Array<{ agent: string; errors: number; warnings: number; last_seen: string }>;
        const health: Record<string, { status: string; errors: number; warnings: number; last_seen: string }> = {};
        for (const a of agents) {
          health[a.agent] = {
            status: a.errors >= 6 ? "red" : a.errors >= 1 ? "yellow" : "green",
            errors: a.errors, warnings: a.warnings, last_seen: a.last_seen,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(health, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_metrics",
    "Get key metrics summary — total products, scored today, approved, live, revenue, ROAS, current model version.",
    {},
    async () => {
      try {
        const db = getDb();
        const todayStr = new Date().toISOString().slice(0, 10);
        const total = (db.prepare("SELECT COUNT(*) as c FROM products").get() as { c: number }).c;
        const scoredToday = (db.prepare("SELECT COUNT(*) as c FROM products WHERE stage != 'discovered' AND updated_at >= ?").get(todayStr) as { c: number }).c;
        const approved = (db.prepare("SELECT COUNT(*) as c FROM products WHERE stage = 'approved'").get() as { c: number }).c;
        const live = (db.prepare("SELECT COUNT(*) as c FROM products WHERE stage IN ('live','tracking')").get() as { c: number }).c;
        const rev = db.prepare("SELECT COALESCE(SUM(total_revenue),0) as rev, COALESCE(SUM(total_ad_spend),0) as spend FROM products").get() as { rev: number; spend: number };
        const labeled = (db.prepare("SELECT COUNT(*) as c FROM products WHERE outcome_label IS NOT NULL").get() as { c: number }).c;
        const result = { total_products: total, scored_today: scoredToday, approved, live, total_revenue: rev.rev, total_ad_spend: rev.spend, roas: rev.spend > 0 ? +(rev.rev / rev.spend).toFixed(2) : null, labeled_products: labeled };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_source_stats",
    "Get discovery source performance — signal counts, win rates, and hit rates per source (reddit, tiktok_cc, google_trends, amazon, aliexpress, pinterest).",
    {},
    async () => {
      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT ts.source,
            COUNT(*) as total_signals,
            COUNT(DISTINCT ts.product_id) as unique_products,
            SUM(CASE WHEN ts.eventual_outcome = 'win' THEN 1 ELSE 0 END) as winners,
            SUM(CASE WHEN ts.eventual_outcome = 'loss' THEN 1 ELSE 0 END) as losers
          FROM trend_signals ts
          GROUP BY ts.source ORDER BY total_signals DESC
        `).all() as Array<{ source: string; total_signals: number; unique_products: number; winners: number; losers: number }>;
        const result: Record<string, unknown> = {};
        for (const r of rows) {
          const labeled = r.winners + r.losers;
          result[r.source] = { signals: r.total_signals, products: r.unique_products, winners: r.winners, losers: r.losers, hit_rate: labeled > 0 ? +(r.winners / labeled).toFixed(3) : null };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_costs",
    "Get API usage and estimated costs — LLM calls by model, image generation, total token usage.",
    {},
    async () => {
      try {
        const db = getDb();
        const byModel = db.prepare(`
          SELECT model_used, COUNT(*) as calls, COALESCE(SUM(tokens_in),0) as tokens_in, COALESCE(SUM(tokens_out),0) as tokens_out
          FROM llm_calls GROUP BY model_used
        `).all() as Array<{ model_used: string; calls: number; tokens_in: number; tokens_out: number }>;
        const totals = db.prepare("SELECT COUNT(*) as calls, COALESCE(SUM(tokens_in),0) as tin, COALESCE(SUM(tokens_out),0) as tout FROM llm_calls").get() as { calls: number; tin: number; tout: number };
        // Rough cost estimates: Groq free tier, Gemini free tier, Replicate ~$0.003/image
        const result = { total_llm_calls: totals.calls, total_tokens_in: totals.tin, total_tokens_out: totals.tout, by_model: byModel, estimated_cost_note: "Groq and Gemini are on free tiers. Replicate images ~$0.003/each." };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );
}
