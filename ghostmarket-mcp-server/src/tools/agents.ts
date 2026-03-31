import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ORCHESTRATOR_URL } from "../constants.js";

async function orchestratorPost(path: string, body?: Record<string, unknown>): Promise<unknown> {
  const resp = await fetch(`${ORCHESTRATOR_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  return resp.json();
}

export function registerAgentTools(server: McpServer): void {

  server.tool(
    "ghostmarket_pause_all",
    "Pause all GhostMarket agents. No new products will be discovered, scored, or deployed until resumed.",
    {},
    async () => {
      try {
        const data = await orchestratorPost("/control/pause");
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...data as object, message: "All agents paused" }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message, suggestion: "Is the orchestrator running on port 4000?" }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_resume_all",
    "Resume all paused GhostMarket agents. Pipeline will continue discovering, scoring, and deploying products.",
    {},
    async () => {
      try {
        const data = await orchestratorPost("/control/resume");
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...data as object, message: "All agents resumed" }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_trigger_scout",
    "Trigger the Scout agent to discover new trending products. Light sources (Reddit, Google Trends) run locally; heavy sources (TikTok, Amazon, AliExpress) require ROG worker.",
    { sources: z.array(z.string()).optional().describe("Specific sources to scout (e.g. ['reddit','google_trends']). Omit for default light sources.") },
    async ({ sources }) => {
      try {
        const data = await orchestratorPost("/trigger/scout");
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...data as object, sources_requested: sources || "default (light)" }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message, suggestion: "Scout may have timed out. Check pm2 logs scout-light for details." }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_trigger_sourcer",
    "Trigger the Sourcer agent to find suppliers for a product. Searches AliExpress, CJ Dropshipping, and Printful for pricing, margins, and shipping info.",
    { product_id: z.string().optional().describe("Product ID to source"), keyword: z.string().optional().describe("Product keyword to source") },
    async ({ product_id, keyword }) => {
      try {
        if (!product_id && !keyword) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Provide either product_id or keyword" }) }], isError: true };
        // Sourcer runs as part of the scout/score pipeline; trigger via scorer
        const data = await orchestratorPost("/trigger/scorer");
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...data as object, note: "Sourcer runs as part of the scoring pipeline" }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_trigger_builder",
    "Trigger the Builder agent for an approved product. Generates brand kit, 3 landing page variants, 6 ad creatives, and 10-day content calendar.",
    { product_id: z.string().describe("Product ID to build") },
    async ({ product_id }) => {
      try {
        const data = await orchestratorPost("/trigger/build", { product_id });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...data as object }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_trigger_deployer",
    "Trigger the Deployer agent for a built product. Deploys the landing page and schedules content posts to Buffer (if configured).",
    { product_id: z.string().describe("Product ID to deploy") },
    async ({ product_id }) => {
      try {
        const data = await orchestratorPost("/trigger/deploy", { product_id });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...data as object }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_set_budget",
    "Set the daily advertising budget ceiling in USD.",
    { daily_max: z.number().min(0).describe("Maximum daily ad spend in USD") },
    async ({ daily_max }) => {
      try {
        const data = await orchestratorPost("/control/budget", { amount: daily_max });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, daily_budget: daily_max, ...data as object }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );
}
