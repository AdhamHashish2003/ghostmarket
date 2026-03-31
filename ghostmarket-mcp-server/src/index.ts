import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "crypto";

import { registerPipelineTools } from "./tools/pipeline.js";
import { registerProductTools } from "./tools/products.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerTrainingTools } from "./tools/training.js";
import { registerTelegramTools } from "./tools/telegram.js";
import { registerSystemTools } from "./tools/system.js";
import { registerDatabaseTools } from "./tools/database.js";
import { registerBuilderTools } from "./tools/builder.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "ghostmarket-mcp-server",
    version: "1.0.0",
  });

  // Register all tool groups
  registerPipelineTools(server);
  registerProductTools(server);
  registerAgentTools(server);
  registerTrainingTools(server);
  registerTelegramTools(server);
  registerSystemTools(server);
  registerDatabaseTools(server);
  registerBuilderTools(server);

  return server;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--stdio")) {
    // Local Claude Code usage via stdio
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCP] GhostMarket MCP server running on stdio");
  } else {
    // Remote HTTP access via Streamable HTTP
    const app = express();
    app.use(express.json());

    // Track transports for session management
    const transports = new Map<string, StreamableHTTPServerTransport>();

    app.post("/mcp", async (req, res) => {
      // Check for existing session
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New session
        const newSessionId = randomUUID();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
        });
        transports.set(newSessionId, transport);
        const server = createServer();
        await server.connect(transport);

        transport.onclose = () => {
          transports.delete(newSessionId);
        };
      } else if (sessionId && !transports.has(sessionId)) {
        // Invalid session
        res.status(404).json({ error: "Session not found. Send an initialize request without a session ID to start a new session." });
        return;
      } else {
        // No session ID and not an initialize request
        res.status(400).json({ error: "Missing mcp-session-id header. Send an initialize request first." });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    });

    // Handle GET for SSE streams
    app.get("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    });

    // Handle DELETE for session cleanup
    app.delete("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.close();
        transports.delete(sessionId);
      }
      res.status(200).json({ success: true });
    });

    // Health check
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", server: "ghostmarket-mcp-server", version: "1.0.0", active_sessions: transports.size });
    });

    const port = Number(process.env.MCP_PORT) || 3001;
    app.listen(port, () => {
      console.log(`[MCP] GhostMarket MCP server listening on port ${port}`);
      console.log(`[MCP] Streamable HTTP endpoint: http://localhost:${port}/mcp`);
      console.log(`[MCP] Health check: http://localhost:${port}/health`);
    });
  }
}

function isInitializeRequest(body: unknown): boolean {
  if (typeof body === "object" && body !== null) {
    const msg = body as { method?: string };
    if (msg.method === "initialize") return true;
    // Batch request
    if (Array.isArray(body)) {
      return body.some((m: { method?: string }) => m.method === "initialize");
    }
  }
  return false;
}

main().catch((error) => {
  console.error("[MCP] Fatal error:", error);
  process.exit(1);
});
