import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb, safeQuery } from "../services/db.js";

export function registerDatabaseTools(server: McpServer): void {

  server.tool(
    "ghostmarket_query_database",
    "Run a read-only SQL query against GhostMarket's SQLite database. Only SELECT and WITH queries are allowed — no writes. Use this for custom analysis that other tools don't cover.",
    { sql: z.string().min(5).describe("SQL SELECT query to execute") },
    async ({ sql }) => {
      try {
        const rows = safeQuery(sql);
        return { content: [{ type: "text" as const, text: JSON.stringify({ row_count: rows.length, results: rows }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message, suggestion: "Only SELECT queries are allowed. Check table/column names with ghostmarket_get_table_stats." }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_table_stats",
    "Get row counts and last insert time for all GhostMarket database tables. Useful for understanding data volume and freshness.",
    {},
    async () => {
      try {
        const db = getDb();
        const tables = [
          "products", "trend_signals", "suppliers", "brand_kits", "landing_pages",
          "ad_creatives", "content_posts", "campaign_metrics", "outcomes",
          "learning_cycles", "operator_decisions", "system_events", "llm_calls",
        ];
        const stats: Record<string, { count: number; last_insert: string | null }> = {};
        for (const table of tables) {
          try {
            const count = (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
            const last = db.prepare(`SELECT MAX(created_at) as t FROM ${table}`).get() as { t: string | null };
            stats[table] = { count, last_insert: last.t };
          } catch {
            stats[table] = { count: -1, last_insert: null };
          }
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );
}
