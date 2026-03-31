import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../services/db.js";
import { ORCHESTRATOR_URL } from "../constants.js";
import { sendToROG } from "../services/rog-worker.js";

export function registerTrainingTools(server: McpServer): void {

  server.tool(
    "ghostmarket_get_model_info",
    "Get current ML model information — scoring model version, accuracy, training data counts, feature importance, and QLoRA adapter status.",
    {},
    async () => {
      try {
        const db = getDb();
        const latest = db.prepare("SELECT * FROM learning_cycles ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
        const labeled = (db.prepare("SELECT COUNT(*) as c FROM products WHERE outcome_label IS NOT NULL").get() as { c: number }).c;
        const pairs = (db.prepare("SELECT COUNT(*) as c FROM llm_calls WHERE outcome_quality IN ('keep','flip')").get() as { c: number }).c;
        const result = {
          scoring_model: latest?.model_version_after || "rule_v1",
          cycle_type: latest?.cycle_type || "none",
          accuracy: latest?.accuracy_after || null,
          training_samples: latest?.training_samples || 0,
          feature_importance: latest?.feature_importance ? JSON.parse(latest.feature_importance as string) : null,
          strategy_summary: latest?.strategy_summary || null,
          labeled_products: labeled,
          qlora_training_pairs: pairs,
          xgb_threshold: labeled >= 50 ? "MET" : `${labeled}/50`,
          qlora_threshold: pairs >= 50 ? "MET" : `${pairs}/50`,
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_retrain_scorer",
    "Trigger XGBoost scoring model retraining. Requires at least 50 labeled products. Returns accuracy before/after and whether the new model was deployed.",
    {},
    async () => {
      try {
        const db = getDb();
        const labeled = (db.prepare("SELECT COUNT(*) as c FROM products WHERE outcome_label IS NOT NULL").get() as { c: number }).c;
        if (labeled < 50) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ skipped: true, reason: `Not enough labeled data (${labeled}/50). Label more product outcomes with ghostmarket_log_outcome first.` }) }] };
        }
        await fetch(`${ORCHESTRATOR_URL}/trigger/learn`, { method: "POST" });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, message: "XGBoost retraining triggered via learning cycle. Check results with ghostmarket_get_model_info." }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_retrain_llm",
    "Trigger QLoRA fine-tuning of the LLM on the ROG worker. Requires at least 50 training pairs and the ROG machine to be running. Takes 1-2 hours.",
    {},
    async () => {
      try {
        const db = getDb();
        const pairs = (db.prepare("SELECT COUNT(*) as c FROM llm_calls WHERE outcome_quality IN ('keep','flip')").get() as { c: number }).c;
        if (pairs < 50) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ skipped: true, reason: `Not enough training pairs (${pairs}/50). Label more product outcomes to generate pairs.` }) }] };
        }
        const data = await sendToROG("/train", { job_id: crypto.randomUUID(), train_type: "qlora" });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, message: "QLoRA fine-tuning started on ROG. Takes 1-2 hours.", ...data as object }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_run_learning_cycle",
    "Trigger a full learning cycle: XGBoost retraining + QLoRA fine-tuning + Groq strategy reflection. Each sub-task runs if thresholds are met, skips gracefully otherwise.",
    {},
    async () => {
      try {
        await fetch(`${ORCHESTRATOR_URL}/trigger/learn`, { method: "POST" });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, message: "Full learning cycle triggered. The Learner will run XGBoost, QLoRA, and strategy reflection as appropriate. Results will be posted to Telegram." }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_get_strategy_insights",
    "Get the latest strategy reflection — winning/losing patterns, ad hook performance, content strategy, source recommendations, and action items.",
    {},
    async () => {
      try {
        const db = getDb();
        const latest = db.prepare(`
          SELECT strategy_summary, source_hit_rates, weight_adjustments, created_at
          FROM learning_cycles
          WHERE cycle_type = 'reflection' AND strategy_summary IS NOT NULL
          ORDER BY created_at DESC LIMIT 1
        `).get() as { strategy_summary: string; source_hit_rates: string | null; weight_adjustments: string | null; created_at: string } | undefined;
        if (!latest) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ message: "No strategy insights yet. Run ghostmarket_run_learning_cycle after labeling some product outcomes." }) }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({
          strategy: latest.strategy_summary,
          source_hit_rates: latest.source_hit_rates ? JSON.parse(latest.source_hit_rates) : null,
          weight_adjustments: latest.weight_adjustments ? JSON.parse(latest.weight_adjustments) : null,
          generated_at: latest.created_at,
        }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );

  server.tool(
    "ghostmarket_export_training_data",
    "Export LLM training data as JSONL or CSV. Useful for fine-tuning or analysis outside GhostMarket.",
    { task_type: z.string().optional().describe("Filter by task type (product_evaluation, ad_hook, brand_naming, etc.)"), format: z.enum(["jsonl", "csv"]).default("jsonl").describe("Output format") },
    async ({ task_type, format }) => {
      try {
        const db = getDb();
        let sql = "SELECT task_type, input_prompt, output_text, eventual_outcome, outcome_quality FROM llm_calls WHERE outcome_quality IN ('keep','flip')";
        const params: string[] = [];
        if (task_type) { sql += " AND task_type = ?"; params.push(task_type); }
        sql += " ORDER BY created_at";
        const rows = db.prepare(sql).all(...params) as Array<{ task_type: string; input_prompt: string; output_text: string; eventual_outcome: string; outcome_quality: string }>;
        if (format === "csv") {
          const header = "task_type,input_prompt,output_text,eventual_outcome,outcome_quality";
          const csvRows = rows.map(r => [r.task_type, `"${(r.input_prompt || "").replace(/"/g, '""')}"`, `"${(r.output_text || "").replace(/"/g, '""')}"`, r.eventual_outcome, r.outcome_quality].join(","));
          return { content: [{ type: "text" as const, text: header + "\n" + csvRows.join("\n") }] };
        }
        const jsonl = rows.map(r => JSON.stringify({ instruction: `Complete this ${r.task_type} task.`, input: r.input_prompt, output: r.output_text })).join("\n");
        return { content: [{ type: "text" as const, text: jsonl || "No training data available. Label product outcomes first." }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
      }
    }
  );
}
