import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../services/db.js";
import { sendTelegramMessage, sendProductCard } from "../services/telegram-api.js";

export function registerTelegramTools(server: McpServer): void {

  server.tool(
    "ghostmarket_send_telegram",
    "Send a text message to the GhostMarket operator via Telegram. Use for alerts, status updates, or questions.",
    { message: z.string().min(1).max(4000).describe("Message text to send") },
    async ({ message }) => {
      try {
        const result = await sendTelegramMessage(message);
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, message_id: result.message_id }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_send_product_card",
    "Send a product card to Telegram with approve/skip inline keyboard buttons. The operator can approve or skip directly from Telegram.",
    { product_id: z.string().describe("Product ID to send as card") },
    async ({ product_id }) => {
      try {
        const db = getDb();
        const product = db.prepare("SELECT * FROM products WHERE id = ? OR id LIKE ?").get(product_id, `${product_id}%`) as { id: string; keyword: string; score: number } | undefined;
        if (!product) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Product ${product_id} not found` }) }], isError: true };
        const supplier = db.prepare("SELECT * FROM suppliers WHERE product_id = ? AND is_best = 1 LIMIT 1").get(product.id) as { platform: string; margin_pct: number; unit_cost: number; estimated_retail: number; warehouse: string } | undefined;
        const margin = supplier ? `~${supplier.margin_pct?.toFixed(0)}% ($${supplier.unit_cost} → $${supplier.estimated_retail})` : "N/A";
        const supplierStr = supplier ? `${supplier.platform} · ${supplier.warehouse} warehouse` : "Unknown";
        const result = await sendProductCard(product.id, product.keyword, product.score || 0, margin, supplierStr);
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, message_id: result.message_id, product: product.keyword }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_operator_decisions",
    "Get recent operator decisions from Telegram — approvals, skips, kills, and other actions.",
    { limit: z.number().min(1).max(100).default(20).describe("Number of decisions to return") },
    async ({ limit }) => {
      try {
        const db = getDb();
        const decisions = db.prepare(`
          SELECT od.id, od.product_id, od.decision, od.notes, od.product_score, od.created_at,
                 p.keyword, p.stage, p.outcome_label
          FROM operator_decisions od
          LEFT JOIN products p ON p.id = od.product_id
          ORDER BY od.created_at DESC LIMIT ?
        `).all(limit);
        return { content: [{ type: "text" as const, text: JSON.stringify(decisions, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );
}
