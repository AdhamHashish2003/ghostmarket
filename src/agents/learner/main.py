"""GhostMarket Learner Agent — The Self-Improving Brain

Orchestrates all learning pipelines:
A. XGBoost retraining (WHAT to pick) — CPU, fast (~30 seconds)
B. QLoRA fine-tuning (HOW to sell) — GPU, slow (~1-2 hours)
C. Strategy reflection via Groq/Kimi — qualitative analysis
D. Source evaluation — which discovery channels produce winners
E. Creative pattern analysis — which ad/copy approaches convert

Runs weekly (Sunday 3 AM) and on-demand via /learn or /train commands.
"""

import asyncio
import json
import logging
import os
import sys
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.training import get_db, get_source_hit_rates, log_system_event, log_training_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Learner] %(message)s")
log = logging.getLogger("learner")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
CALLBACK_URL = os.getenv("ORCHESTRATOR_CALLBACK_URL", "")


# ============================================================
# Strategy Reflection (Groq/Kimi analysis)
# ============================================================

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

    if not products:
        return {"skipped": True, "reason": "No labeled products for reflection"}

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

    hook_summaries = [
        f"- {dict(h)['hook_type']} on {dict(h)['platform']}: CTR={dict(h)['avg_ctr']:.4f} ({dict(h)['count']} ads)"
        for h in hooks
    ]

    post_summaries = [
        f"- {dict(pp)['post_type']}: avg engagement={dict(pp)['avg_engagement']:.0f}, clicks={dict(pp)['avg_clicks']:.0f} ({dict(pp)['count']} posts)"
        for pp in post_perf
    ]

    prompt = f"""Analyze these e-commerce product launches and provide actionable strategy insights.

PRODUCTS ({len(products)} recent):
{chr(10).join(product_summaries)}

AD HOOK PERFORMANCE:
{chr(10).join(hook_summaries) if hook_summaries else 'No data yet'}

CONTENT POST PERFORMANCE:
{chr(10).join(post_summaries) if post_summaries else 'No data yet'}

SOURCE HIT RATES:
{json.dumps(get_source_hit_rates(), indent=2)}

Analyze and output a JSON object with:
1. "winning_patterns": what do winners have in common? (category, price range, warehouse, sources, etc.)
2. "losing_patterns": what red flags predict losers?
3. "best_ad_hooks": which hook types and platforms perform best?
4. "content_strategy": which post types drive most engagement?
5. "source_recommendations": which discovery sources should be prioritized/deprioritized?
6. "pricing_insight": what price ranges perform best?
7. "action_items": 3-5 specific, actionable changes to make

Respond ONLY with valid JSON."""

    if not GROQ_API_KEY:
        return {"skipped": True, "reason": "GROQ_API_KEY not set for reflection"}

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": "You are a senior e-commerce strategist. Analyze data and provide specific, actionable insights. Output valid JSON only."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.5,
                    "max_tokens": 2048,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"]

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

    # A. XGBoost retraining (~30 seconds)
    try:
        from xgboost_trainer import run_xgboost_training
        results["xgboost"] = await run_xgboost_training()
        log.info(f"XGBoost: {results['xgboost']}")
    except Exception as e:
        log.error(f"XGBoost training failed: {e}")
        results["xgboost"] = {"error": str(e)}

    # B. QLoRA fine-tuning (~1-2 hours)
    try:
        from qlora_trainer import run_qlora_training
        results["qlora"] = await run_qlora_training()
        log.info(f"QLoRA: {results['qlora']}")
    except Exception as e:
        log.error(f"QLoRA training failed: {e}")
        results["qlora"] = {"error": str(e)}

    # C. Strategy reflection (~30 seconds)
    try:
        results["reflection"] = await run_strategy_reflection()
        log.info(f"Reflection: {results['reflection'].get('summary', 'N/A')[:100]}")
    except Exception as e:
        log.error(f"Strategy reflection failed: {e}")
        results["reflection"] = {"error": str(e)}

    # D. Source hit rates (instant)
    results["source_hit_rates"] = get_source_hit_rates()

    log.info("=== FULL LEARNING CYCLE COMPLETE ===")
    log.info(f"Results summary: XGB={results.get('xgboost', {}).get('deployed', 'N/A')}, "
             f"QLoRA={results.get('qlora', {}).get('deployed', 'N/A')}")

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

    # The learner runs on demand (/learn command via orchestrator callback)
    # and weekly (Sunday 3 AM, triggered by orchestrator cron)
    # In service mode, it just waits for triggers

    # Run initial check
    with get_db() as conn:
        labeled = conn.execute(
            "SELECT COUNT(*) as cnt FROM products WHERE outcome_label IS NOT NULL"
        ).fetchone()
        pairs = conn.execute(
            "SELECT COUNT(*) as cnt FROM llm_calls WHERE outcome_quality IN ('keep', 'flip')"
        ).fetchone()

    log.info(f"Current state: {labeled['cnt']} labeled products, {pairs['cnt']} QLoRA training pairs")
    log.info(f"XGBoost threshold: {'MET' if labeled['cnt'] >= 50 else f'{labeled['cnt']}/50'}")
    log.info(f"QLoRA threshold: {'MET' if pairs['cnt'] >= 50 else f'{pairs['cnt']}/50'}")

    # Keep alive — actual triggers come from orchestrator or /learn command
    while True:
        await asyncio.sleep(3600)  # Check every hour if there's pending work


if __name__ == "__main__":
    # If called with --learn flag, run full cycle immediately
    if "--learn" in sys.argv:
        asyncio.run(run_full_learning_cycle())
    else:
        asyncio.run(main())
