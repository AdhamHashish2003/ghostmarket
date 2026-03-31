import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../services/db.js";

export function registerBuilderTools(server: McpServer): void {

  // Builder-specific read tools are covered by get_product.
  // This file is a placeholder for future builder tools like:
  // - regenerate_landing_page
  // - regenerate_ad_creatives
  // - update_brand_kit
  // For now, the builder is triggered via ghostmarket_trigger_builder.
}
