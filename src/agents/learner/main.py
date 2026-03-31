"""GhostMarket Learner Agent — The Self-Improving Brain

Orchestrates all learning pipelines:
A. XGBoost retraining (WHAT to pick) — CPU, fast (~30 seconds)
B. QLoRA fine-tuning (HOW to sell) — GPU, slow (~1-2 hours)
C. Strategy reflection via Groq/Kimi — qualitative analysis
D. Source evaluation — which discovery channels produce winners
E. Creative pattern analysis — which ad/copy approaches convert

Runs weekly (Sunday 3 AM) and on-demand via /learn or /train commands.
Handles low-data gracefully — reports "need more data" instead of crashing.
"""

import asyncio
import json
import logging
import os
import sys
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from shared.training import get_db, get_source_hit_rates, log_system_event, log_training_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Learner] %(message)s")
log = logging.getLogger("learner")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
NIM_API_KEY = os.getenv("NIM_API_KEY", "")
CALLBACK_URL = os.getenv("ORCHESTRATOR_CALLBACK_URL", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")


# ============================================================
# Telegram reporting
# ============================================================

async def send_telegram(text: str) -> None:
    """Send a message to the operator via Telegram."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        log.warning("Telegram not configured, skipping report")
        return
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": text},
            )
    except Exception as e:
        log.warning(f"Telegram send failed: {e}")


# ============================================================
# Strategy Reflection (Groq/Kimi analysis)
# ============================================================

async def _call_reflection_llm(prompt: str) -> str | None:
    """Call LLMs with fallback chain for strategy reflection."""
    sys_msg = "You are a senior e-commerce strategist. Analyze data and provide specific, actionable insights. Output valid JSON only."
    for attempt in range(2):
        if attempt > 0:
            await asyncio.sleep(15)
        # Groq
        if GROQ_API_KEY:
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                        json={"model": "llama-3.3-70b-versatile", "messages": [{"role": "system", "content": sys_msg}, {"role": "user", "content": prompt}], "temperature": 0.5, "max_tokens": 2048},
                    )
                    if resp.status_code == 200:
                        return resp.json()["choices"][0]["message"]["content"]
            except Exception:
                pass
        # NIM
        if NIM_API_KEY:
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(
                        "https://integrate.api.nvidia.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {NIM_API_KEY}", "Content-Type": "application/json"},
                        json={"model": "meta/llama-3.3-70b-instruct", "messages": [{"role": "system", "content": sys_msg}, {"role": "user", "content": prompt}], "temperature": 0.5, "max_tokens": 2048},
                    )
                    if resp.status_code == 200:
                        return resp.json()["choices"][0]["message"]["content"]
            except Exception:
                pass
    return None


async def run_strategy_reflection() -> dict[str, Any]:
    """Feed recent launches to LLM for qualitative strategy analysis."""
    log.info("Running strategy reflection")

    with get_db() as conn:
        # Get recent products with outcomes
        products = conn.execute("""
            SELECT p.keyword, p.category, p.score, p.score_breakdown, p.model_version,
                   p.fulfillment_method, p.outcome_label, p.total_revenue, p.total_ad_spend, p.roas,
                   s.platform as supplier_platform, s.landed_cost, s.estimated_retail, s.margin_pct, s.warehouse,
                   bk.brand_name,
                   (SELECT GROUP_CONCAT(DISTINCT ts.source) FROM trend_signals ts WHERE ts.product_id = p.id) as sources
            FROM products p
            LEFT JOIN suppliers s ON s.product_id = p.id AND s.is_best = 1
            LEFT JOIN brand_kits bk ON bk.product_id = p.id
            WHERE p.outcome_label IS NOT NULL
            ORDER BY p.created_at DESC
            LIMIT 30
        """).fetchall()

        # Also get ALL scored products for analysis even without outcomes
        all_products = conn.execute("""
            SELECT p.keyword, p.category, p.score, p.stage, p.outcome_label
            FROM products p
            WHERE p.stage NOT IN ('discovered')
            ORDER BY p.score DESC
            LIMIT 50
        """).fetchall()

        # Get best/worst performing ad hooks
        hooks = conn.execute("""
            SELECT hook_type, platform,
                   AVG(ctr) as avg_ctr,
                   COUNT(*) as count
            FROM ad_creatives
            WHERE ctr IS NOT NULL
            GROUP BY hook_type, platform
            ORDER BY avg_ctr DESC
        """).fetchall()

        # Get content post performance by type
        post_perf = conn.execute("""
            SELECT post_type,
                   AVG(engagement) as avg_engagement,
                   AVG(clicks) as avg_clicks,
                   COUNT(*) as count
            FROM content_posts
            WHERE engagement > 0
            GROUP BY post_type
            ORDER BY avg_engagement DESC
        """).fetchall()

    labeled_count = len(products)
    total_scored = len(all_products)

    if labeled_count == 0 and total_scored == 0:
        return {"skipped": True, "reason": "No scored or labeled products for reflection"}

    # Format data for LLM
    product_summaries = []
    for p in products:
        p = dict(p)
        product_summaries.append(
            f"- {p['keyword']} ({p['category']}): {p['outcome_label']} | "
            f"Score: {p['score']} | ROAS: {p['roas'] or 'N/A'} | "
            f"Margin: {p['margin_pct'] or 'N/A'}% | Warehouse: {p['warehouse'] or '?'} | "
            f"Sources: {p['sources'] or '?'}"
        )

    # Include unlabeled products too for broader context
    unlabeled_summaries = []
    for p in all_products:
        p = dict(p)
        if p['outcome_label'] is None:
            unlabeled_summaries.append(
                f"- {p['keyword']} ({p['category']}): stage={p['stage']} | Score: {p['score']}"
            )

    hook_summaries = [
        f"- {dict(h)['hook_type']} on {dict(h)['platform']}: CTR={dict(h)['avg_ctr']:.4f} ({dict(h)['count']} ads)"
        for h in hooks
    ]

    post_summaries = [
        f"- {dict(pp)['post_type']}: avg engagement={dict(pp)['avg_engagement']:.0f}, clicks={dict(pp)['avg_clicks']:.0f} ({dict(pp)['count']} posts)"
        for pp in post_perf
    ]

    data_note = ""
    if labeled_count < 5:
        data_note = f"\nNOTE: Only {labeled_count} labeled product(s). Analysis will be limited. Focus on what data exists and what's needed for better insights."

    prompt = f"""Analyze these e-commerce product launches and provide actionable strategy insights.
{data_note}
LABELED PRODUCTS ({labeled_count}):
{chr(10).join(product_summaries) if product_summaries else 'None yet'}

PIPELINE PRODUCTS (unlabeled, {len(unlabeled_summaries)}):
{chr(10).join(unlabeled_summaries[:20]) if unlabeled_summaries else 'None'}

AD HOOK PERFORMANCE:
{chr(10).join(hook_summaries) if hook_summaries else 'No data yet'}

CONTENT POST PERFORMANCE:
{chr(10).join(post_summaries) if post_summaries else 'No data yet'}

SOURCE HIT RATES:
{json.dumps(get_source_hit_rates(), indent=2)}

Analyze and output a JSON object with:
1. "winning_patterns": what do winners have in common? (or "not enough data" if < 5 labeled)
2. "losing_patterns": what red flags predict losers?
3. "best_ad_hooks": which hook types and platforms perform best?
4. "content_strategy": which post types drive most engagement?
5. "source_recommendations": which discovery sources should be prioritized/deprioritized?
6. "pricing_insight": what price ranges perform best?
7. "action_items": 3-5 specific, actionable changes to make
8. "data_needs": what additional data is needed for better analysis?

Respond ONLY with valid JSON."""

    if not GROQ_API_KEY and not GEMINI_API_KEY and not NIM_API_KEY:
        return {"skipped": True, "reason": "No LLM API keys set for reflection"}

    try:
        text = await _call_reflection_llm(prompt)
        if not text:
            return {"skipped": True, "reason": "All LLM providers rate-limited"}

        # Parse JSON
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        analysis = json.loads(text)

        # Log reflection cycle
        cycle_number = 1
        with get_db() as conn:
            row = conn.execute(
                "SELECT MAX(cycle_number) as max_n FROM learning_cycles WHERE cycle_type = 'reflection'"
            ).fetchone()
            if row and row["max_n"]:
                cycle_number = row["max_n"] + 1

        summary = ""
        if "winning_patterns" in analysis:
            summary += f"Winners: {analysis['winning_patterns']}\n"
        if "action_items" in analysis:
            summary += f"Actions: {json.dumps(analysis['action_items'])}"
        if "data_needs" in analysis:
            summary += f"\nData needs: {analysis['data_needs']}"

        log_training_event("learning_cycles", {
            "cycle_number": cycle_number,
            "cycle_type": "reflection",
            "strategy_summary": summary[:2000],
            "source_hit_rates": json.dumps(get_source_hit_rates()),
            "deployed": 1,
        })

        return {"success": True, "analysis": analysis, "summary": summary}

    except Exception as e:
        log.error(f"Strategy reflection failed: {e}")
        return {"success": False, "error": str(e)}


# ============================================================
# Full Learning Cycle
# ============================================================

async def run_full_learning_cycle() -> dict[str, Any]:
    """Run all learning sub-tasks. Called by /learn or weekly cron."""
    log.info("=== FULL LEARNING CYCLE START ===")
    results: dict[str, Any] = {}

    # Check current data state
    with get_db() as conn:
        labeled_count = conn.execute(
            "SELECT COUNT(*) as cnt FROM products WHERE outcome_label IS NOT NULL"
        ).fetchone()["cnt"]
        qlora_pairs = conn.execute(
            "SELECT COUNT(*) as cnt FROM llm_calls WHERE outcome_quality IN ('keep', 'flip')"
        ).fetchone()["cnt"]
        total_products = conn.execute(
            "SELECT COUNT(*) as cnt FROM products"
        ).fetchone()["cnt"]

    log.info(f"Data state: {labeled_count} labeled, {qlora_pairs} QLoRA pairs, {total_products} total products")

    # A. XGBoost retraining
    try:
        if labeled_count < 50:
            msg = f"Not enough data for XGBoost retraining (need 50, have {labeled_count}). Using backtest model."
            log.info(msg)
            results["xgboost"] = {"skipped": True, "reason": msg, "labeled_count": labeled_count}
        else:
            from xgboost_trainer import run_xgboost_training
            results["xgboost"] = await run_xgboost_training()
            log.info(f"XGBoost: {results['xgboost']}")
    except Exception as e:
        log.error(f"XGBoost training failed: {e}")
        results["xgboost"] = {"skipped": True, "error": str(e)}

    # B. QLoRA fine-tuning
    try:
        if qlora_pairs < 50:
            msg = f"Not enough for QLoRA fine-tuning (need 50, have {qlora_pairs})"
            log.info(msg)
            results["qlora"] = {"skipped": True, "reason": msg, "pair_count": qlora_pairs}
        else:
            from qlora_trainer import run_qlora_training
            results["qlora"] = await run_qlora_training()
            log.info(f"QLoRA: {results['qlora']}")
    except Exception as e:
        log.error(f"QLoRA training failed: {e}")
        results["qlora"] = {"skipped": True, "error": str(e)}

    # C. Strategy reflection — run even with minimal data
    try:
        results["reflection"] = await run_strategy_reflection()
        log.info(f"Reflection: {results['reflection'].get('summary', results['reflection'].get('reason', 'N/A'))[:100]}")
    except Exception as e:
        log.error(f"Strategy reflection failed: {e}")
        results["reflection"] = {"skipped": True, "error": str(e)}

    # D. Source hit rates (instant)
    results["source_hit_rates"] = get_source_hit_rates()

    log.info("=== FULL LEARNING CYCLE COMPLETE ===")

    # Build and send Telegram report
    report = "🧠 LEARNING CYCLE COMPLETE\n━━━━━━━━━━━━━━━━━━━━━━\n"
    report += f"Data: {labeled_count} labeled, {qlora_pairs} QLoRA pairs, {total_products} total\n\n"

    # XGBoost status
    xgb = results.get("xgboost", {})
    if xgb.get("skipped"):
        report += f"📊 XGBoost: Skipped — {xgb.get('reason', xgb.get('error', 'N/A'))}\n"
    elif xgb.get("deployed"):
        report += f"📊 XGBoost: ✅ Deployed {xgb.get('version')} (acc: {xgb.get('accuracy_after', 'N/A')})\n"
    else:
        report += f"📊 XGBoost: ❌ Not deployed\n"

    # QLoRA status
    qlora = results.get("qlora", {})
    if qlora.get("skipped"):
        report += f"🔧 QLoRA: Skipped — {qlora.get('reason', qlora.get('error', 'N/A'))}\n"
    elif qlora.get("deployed"):
        report += f"🔧 QLoRA: ✅ Deployed {qlora.get('version')}\n"
    else:
        report += f"🔧 QLoRA: ❌ Not deployed\n"

    # Reflection status
    refl = results.get("reflection", {})
    if refl.get("skipped"):
        report += f"💡 Reflection: Skipped — {refl.get('reason', refl.get('error', 'N/A'))}\n"
    elif refl.get("success"):
        summary = refl.get("summary", "")[:300]
        report += f"💡 Reflection: ✅ Complete\n{summary}\n"
    else:
        report += f"💡 Reflection: ❌ Failed — {refl.get('error', 'unknown')}\n"

    # Source hit rates
    rates = results.get("source_hit_rates", {})
    if rates:
        report += f"\n📡 Source hit rates: {json.dumps(rates)}\n"
    else:
        report += "\n📡 Source hit rates: No labeled data yet\n"

    report += "\n━━━━━━━━━━━━━━━━━━━━━━"

    await send_telegram(report)
    log.info("Learning report sent to Telegram")

    # Log system event
    log_system_event("learner", "health_check", "info",
                     f"Learning cycle complete: xgb={'skipped' if xgb.get('skipped') else 'done'}, "
                     f"qlora={'skipped' if qlora.get('skipped') else 'done'}, "
                     f"reflection={'skipped' if refl.get('skipped') else 'done'}")

    # Send callback if configured
    if CALLBACK_URL:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                await client.post(CALLBACK_URL, json={
                    "job_id": "learning_cycle",
                    "job_type": "learn",
                    "success": True,
                    "data": _serialize_results(results),
                })
        except Exception as e:
            log.warning(f"Callback failed: {e}")

    return results


def _serialize_results(results: dict[str, Any]) -> dict[str, Any]:
    """Make results JSON-serializable."""
    clean: dict[str, Any] = {}
    for key, val in results.items():
        if isinstance(val, dict):
            clean[key] = {k: str(v) if not isinstance(v, (str, int, float, bool, type(None), list)) else v
                         for k, v in val.items()}
        else:
            clean[key] = str(val)
    return clean


# ============================================================
# Main service loop
# ============================================================

async def main() -> None:
    log.info("Learner agent starting")
    log_system_event("learner", "startup", "info", "Learner agent started")

    # Run initial check
    with get_db() as conn:
        labeled = conn.execute(
            "SELECT COUNT(*) as cnt FROM products WHERE outcome_label IS NOT NULL"
        ).fetchone()
        pairs = conn.execute(
            "SELECT COUNT(*) as cnt FROM llm_calls WHERE outcome_quality IN ('keep', 'flip')"
        ).fetchone()

    log.info(f"Current state: {labeled['cnt']} labeled products, {pairs['cnt']} QLoRA training pairs")
    xgb_status = "MET" if labeled['cnt'] >= 50 else f"{labeled['cnt']}/50"
    qlora_status = "MET" if pairs['cnt'] >= 50 else f"{pairs['cnt']}/50"
    log.info(f"XGBoost threshold: {xgb_status}")
    log.info(f"QLoRA threshold: {qlora_status}")

    # Keep alive — actual triggers come from orchestrator or /learn command
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    # If called with --learn flag, run full cycle immediately
    if "--learn" in sys.argv:
        asyncio.run(run_full_learning_cycle())
    else:
        asyncio.run(main())
