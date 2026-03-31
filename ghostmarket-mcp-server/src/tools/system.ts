import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../services/db.js";
import { TELEGRAM_BOT_TOKEN, GROQ_API_KEY, ROG_WORKER_URL, ROG_ENABLED } from "../constants.js";
import { sendToROG } from "../services/rog-worker.js";

export function registerSystemTools(server: McpServer): void {

  server.tool(
    "ghostmarket_validate_integrations",
    "Validate all API keys and external service connections. Returns ok/error/not_configured for each integration.",
    {},
    async () => {
      const results: Record<string, string> = {};

      // Telegram
      if (TELEGRAM_BOT_TOKEN) {
        try {
          const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
          results.telegram = resp.ok ? "ok" : `error (${resp.status})`;
        } catch (e) { results.telegram = `error: ${(e as Error).message}`; }
      } else { results.telegram = "not_configured"; }

      // Groq
      if (GROQ_API_KEY) {
        try {
          const resp = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
          results.groq = resp.ok ? "ok" : resp.status === 429 ? "rate_limited" : `error (${resp.status})`;
        } catch (e) { results.groq = `error: ${(e as Error).message}`; }
      } else { results.groq = "not_configured"; }

      // Buffer
      const bufferToken = process.env.BUFFER_ACCESS_TOKEN || "";
      if (bufferToken && !bufferToken.startsWith("your_")) {
        try {
          const resp = await fetch(`https://api.bufferapp.com/1/user.json?access_token=${bufferToken}`);
          results.buffer = resp.ok ? "ok" : `error (${resp.status})`;
        } catch (e) { results.buffer = `error: ${(e as Error).message}`; }
      } else { results.buffer = "not_configured"; }

      // ROG Worker
      if (ROG_ENABLED) {
        try {
          const resp = await fetch(`${ROG_WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) });
          results.rog_worker = resp.ok ? "ok" : `error (${resp.status})`;
        } catch { results.rog_worker = "unreachable"; }
      } else { results.rog_worker = "disabled (ROG_ENABLED=false)"; }

      // Database
      try {
        const db = getDb();
        db.prepare("SELECT 1").get();
        results.database = "ok";
      } catch (e) { results.database = `error: ${(e as Error).message}`; }

      // Orchestrator
      try {
        const resp = await fetch("http://localhost:4000/health", { signal: AbortSignal.timeout(5000) });
        results.orchestrator = resp.ok ? "ok" : `error (${resp.status})`;
      } catch { results.orchestrator = "unreachable"; }

      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    "ghostmarket_get_errors",
    "Get recent system errors from all agents. Use to diagnose problems.",
    {
      limit: z.number().min(1).max(100).default(20).describe("Number of errors to return"),
      agent: z.string().optional().describe("Filter by agent name"),
      since: z.string().optional().describe("ISO datetime — only errors after this time"),
    },
    async ({ limit, agent, since }) => {
      try {
        const db = getDb();
        const conditions = ["severity IN ('error','critical')"];
        const params: unknown[] = [];
        if (agent) { conditions.push("agent = ?"); params.push(agent); }
        if (since) { conditions.push("created_at > ?"); params.push(since); }
        const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
        const errors = db.prepare(`SELECT id, agent, event_type, severity, message, created_at FROM system_events ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit);
        return { content: [{ type: "text" as const, text: JSON.stringify(errors, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_trigger_claude_code",
    "Send a task to Claude Code running on the ROG worker for self-improvement. Example: 'Fix the TikTok scraper' or 'Add retry logic to the sourcer'. Requires ROG_ENABLED=true.",
    { task: z.string().min(5).describe("Task description for Claude Code") },
    async ({ task }) => {
      try {
        const data = await sendToROG("/claude-code", {
          job_id: crypto.randomUUID(),
          prompt: `You are working on GhostMarket, an autonomous e-commerce discovery system.\n\nTASK: ${task}\n\nRULES:\n- Read existing code before modifying\n- Follow established patterns\n- Commit with a descriptive message`,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, message: "Task sent to Claude Code on ROG", ...data as object }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );
}
