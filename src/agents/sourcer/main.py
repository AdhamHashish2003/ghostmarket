"""GhostMarket Sourcer — Supplier Discovery & Margin Calculation

Uses Groq LLM to estimate real supplier pricing when APIs are unavailable.
Falls back to CJ Dropshipping API when key is set.
"""

import asyncio
import json
import logging
import os
import re
import sys
import time
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from shared.training import get_db, log_system_event, log_training_event, update_product

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Sourcer] %(message)s")
log = logging.getLogger("sourcer")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
NIM_API_KEY = os.getenv("NIM_API_KEY", "")
GROQ_MODEL = "llama-3.3-70b-versatile"
GEMINI_MODEL = "gemini-2.0-flash"
NIM_MODEL = "meta/llama-3.3-70b-instruct"


# ============================================================
# CJ Dropshipping API (real data when available)
# ============================================================

async def search_cj(keyword: str) -> list[dict[str, Any]]:
    """Search CJ Dropshipping API for products."""
    suppliers: list[dict[str, Any]] = []
    api_key = os.getenv("CJ_API_KEY")
    if not api_key:
        return suppliers

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://developers.cjdropshipping.com/api2.0/v1/product/list",
                headers={"CJ-Access-Token": api_key},
                params={"productNameEn": keyword, "pageNum": 1, "pageSize": 10},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 200 or not data.get("data", {}).get("list"):
                return suppliers

            for item in data["data"]["list"][:5]:
                unit_cost = float(item.get("sellPrice", 0))
                if unit_cost <= 0:
                    continue
                warehouse = "CN"
                for v in item.get("variants", []):
                    if "US" in str(v.get("variantWarehouse", "")):
                        warehouse = "US"
                        break
                shipping_cost = 2.00 if warehouse == "US" else 4.00
                suppliers.append({
                    "platform": "cj_dropshipping",
                    "supplier_url": f"https://cjdropshipping.com/product/{item.get('pid', '')}",
                    "unit_cost": unit_cost,
                    "shipping_cost": shipping_cost,
                    "landed_cost": round(unit_cost + shipping_cost, 2),
                    "shipping_days_min": 3 if warehouse == "US" else 7,
                    "shipping_days_max": 8 if warehouse == "US" else 15,
                    "warehouse": warehouse,
                    "seller_rating": 4.5,
                    "total_orders": None,
                    "title": item.get("productNameEn", ""),
                    "raw_data": item,
                    "source_method": "cj_api",
                })
    except Exception as e:
        log.warning(f"CJ search '{keyword}' failed: {e}")
    return suppliers


# ============================================================
# LLM-based Sourcing Estimate (Groq)
# ============================================================

async def _call_llm(prompt: str) -> str | None:
    """Call Groq first, fall back to Gemini, retry on 429. Returns raw text or None."""
    for attempt in range(3):
        if attempt > 0:
            wait = 15 * attempt
            log.info(f"Rate limited, waiting {wait}s before retry {attempt + 1}/3...")
            await asyncio.sleep(wait)

        # Try Groq
        if GROQ_API_KEY:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                        json={
                            "model": GROQ_MODEL,
                            "messages": [
                                {"role": "system", "content": "You are a precise e-commerce pricing analyst. Respond only with valid JSON."},
                                {"role": "user", "content": prompt},
                            ],
                            "temperature": 0.3,
                            "max_tokens": 500,
                        },
                    )
                    if resp.status_code == 200:
                        return resp.json()["choices"][0]["message"]["content"].strip()
                    if resp.status_code != 429:
                        log.warning(f"Groq returned {resp.status_code}")
            except Exception as e:
                log.warning(f"Groq failed: {e}")

        # Fallback to Gemini
        if GEMINI_API_KEY:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}",
                        headers={"Content-Type": "application/json"},
                        json={
                            "system_instruction": {"parts": [{"text": "You are a precise e-commerce pricing analyst. Respond only with valid JSON."}]},
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 500},
                        },
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        return data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                    if resp.status_code != 429:
                        log.warning(f"Gemini returned {resp.status_code}")
            except Exception as e:
                log.warning(f"Gemini failed: {e}")

        # Fallback to NVIDIA NIM
        if NIM_API_KEY:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        "https://integrate.api.nvidia.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {NIM_API_KEY}", "Content-Type": "application/json"},
                        json={
                            "model": NIM_MODEL,
                            "messages": [
                                {"role": "system", "content": "You are a precise e-commerce pricing analyst. Respond only with valid JSON."},
                                {"role": "user", "content": prompt},
                            ],
                            "temperature": 0.3,
                            "max_tokens": 500,
                        },
                    )
                    if resp.status_code == 200:
                        return resp.json()["choices"][0]["message"]["content"].strip()
                    if resp.status_code != 429:
                        log.warning(f"NIM returned {resp.status_code}")
            except Exception as e:
                log.warning(f"NIM failed: {e}")

    log.warning("All LLM attempts exhausted")
    return None


async def estimate_via_llm(keyword: str, category: str | None) -> list[dict[str, Any]]:
    """Use Groq LLM to estimate realistic supplier pricing."""
    if not GROQ_API_KEY and not GEMINI_API_KEY and not NIM_API_KEY:
        log.warning("No LLM API keys set, cannot estimate via LLM")
        return []

    prompt = f"""You are an e-commerce sourcing analyst. Estimate realistic supplier pricing for this product.

Product: {keyword}
Category: {category or 'general'}

Research what this product typically costs on AliExpress/1688 (wholesale) and what Shopify/Amazon stores sell it for (retail).

Respond with ONLY valid JSON (no markdown):
{{
  "wholesale_price_usd": <number, typical AliExpress price in USD>,
  "shipping_cost_usd": <number, ePacket/standard shipping to US>,
  "retail_price_usd": <number, typical Shopify store price>,
  "margin_pct": <number, percentage margin>,
  "warehouse": "<US or CN>",
  "seller_rating": <number 1-5, typical seller quality>,
  "estimated_monthly_orders": <number, how many units top sellers move>,
  "confidence": "<high/medium/low>",
  "reasoning": "<one sentence explaining your estimate>"
}}"""

    try:
        text = await _call_llm(prompt)
        if not text:
            return []

        # Parse JSON (handle markdown code blocks)
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\n?", "", text)
            text = re.sub(r"\n?```$", "", text)

        estimate = json.loads(text)

        wholesale = float(estimate.get("wholesale_price_usd", 0))
        shipping = float(estimate.get("shipping_cost_usd", 3.0))
        retail = float(estimate.get("retail_price_usd", 0))

        if wholesale <= 0 or retail <= 0:
            log.warning(f"LLM returned invalid prices for {keyword}: wholesale={wholesale}, retail={retail}")
            return []

        landed = round(wholesale + shipping, 2)
        margin = round((retail - landed) / retail * 100, 1) if retail > landed else 10.0

        # Log the LLM sourcing call
        log_system_event("sourcer", "health_check", "info",
            f"LLM sourcing estimate for '{keyword}': ${wholesale} wholesale, ${retail} retail, {margin}% margin",
            {"model": GROQ_MODEL, "estimate": estimate})

        return [{
            "platform": "aliexpress",  # LLM estimates AliExpress pricing
            "supplier_url": None,
            "unit_cost": wholesale,
            "shipping_cost": shipping,
            "landed_cost": landed,
            "estimated_retail": retail,
            "margin_pct": margin,
            "shipping_days_min": 7,
            "shipping_days_max": 15,
            "warehouse": estimate.get("warehouse", "CN"),
            "seller_rating": float(estimate.get("seller_rating", 4.3)),
            "total_orders": int(estimate.get("estimated_monthly_orders", 0)),
            "title": keyword,
            "raw_data": estimate,
            "source_method": "llm_estimate",
        }]

    except Exception as e:
        log.error(f"LLM estimate for '{keyword}' failed: {e}")
        log_system_event("sourcer", "api_failure", "error", f"LLM sourcing estimate failed: {e}")
        return []


# ============================================================
# POD Sourcing (Print on Demand)
# ============================================================

POD_COSTS: dict[str, dict[str, float]] = {
    "t-shirt":    {"base": 9.50,  "shipping": 4.50, "retail_min": 24.99, "retail_max": 34.99},
    "hoodie":     {"base": 22.00, "shipping": 6.00, "retail_min": 44.99, "retail_max": 64.99},
    "mug":        {"base": 6.50,  "shipping": 5.00, "retail_min": 17.99, "retail_max": 24.99},
    "phone_case": {"base": 5.50,  "shipping": 4.00, "retail_min": 14.99, "retail_max": 22.99},
    "poster":     {"base": 4.00,  "shipping": 4.50, "retail_min": 14.99, "retail_max": 29.99},
    "canvas":     {"base": 12.00, "shipping": 6.50, "retail_min": 29.99, "retail_max": 49.99},
    "sticker":    {"base": 1.50,  "shipping": 1.00, "retail_min": 4.99,  "retail_max": 9.99},
    "tote_bag":   {"base": 8.00,  "shipping": 4.50, "retail_min": 19.99, "retail_max": 29.99},
}

# Keywords that hint at specific POD product types
_POD_TYPE_HINTS: dict[str, list[str]] = {
    "mug": ["mug", "cup", "coffee", "tea"],
    "t-shirt": ["shirt", "tee", "tshirt", "apparel", "wear"],
    "hoodie": ["hoodie", "sweatshirt", "pullover"],
    "poster": ["poster", "print", "wall art", "artwork", "illustration"],
    "phone_case": ["phone case", "case", "iphone", "phone"],
    "canvas": ["canvas", "painting", "art print"],
    "sticker": ["sticker", "decal", "vinyl"],
    "tote_bag": ["tote", "bag", "carry"],
}


def _detect_pod_type(keyword: str) -> str:
    """Guess the POD product type from keyword."""
    kw = keyword.lower()
    for pod_type, hints in _POD_TYPE_HINTS.items():
        if any(h in kw for h in hints):
            return pod_type
    return "t-shirt"  # Default: most versatile POD product


async def source_pod_product(product_id: str, keyword: str, category: str | None) -> bool:
    """Source a print-on-demand product using Printful cost table + LLM design brief."""
    pod_type = _detect_pod_type(keyword)
    costs = POD_COSTS.get(pod_type, POD_COSTS["t-shirt"])

    base = costs["base"]
    shipping = costs["shipping"]
    landed = round(base + shipping, 2)
    retail = round((costs["retail_min"] + costs["retail_max"]) / 2, 2)
    margin = round((retail - landed) / retail * 100, 1)

    # LLM call: generate design brief
    design_brief = None
    prompt = f"""You are a print-on-demand product designer. Create a design brief for this product.

Product idea: "{keyword}"
POD product type: {pod_type}
Category: {category or "general"}

Respond with ONLY valid JSON:
{{
  "design_title": "<catchy product listing title>",
  "design_description": "<what goes on the {pod_type} — describe the visual design>",
  "target_audience": "<who buys this>",
  "mockup_prompt": "<Midjourney/DALL-E prompt to generate a product mockup photo>",
  "suggested_retail": <number, optimal price point in USD>
}}"""

    text = await _call_llm(prompt)
    if text:
        try:
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\n?", "", text)
                text = re.sub(r"\n?```$", "", text)
            design_brief = json.loads(text)
            if design_brief.get("suggested_retail"):
                retail = float(design_brief["suggested_retail"])
                margin = round((retail - landed) / retail * 100, 1)
        except (json.JSONDecodeError, ValueError):
            pass

    log_training_event("suppliers", {
        "product_id": product_id,
        "platform": "printful",
        "supplier_url": "https://www.printful.com",
        "unit_cost": base,
        "shipping_cost": shipping,
        "landed_cost": landed,
        "estimated_retail": retail,
        "margin_pct": margin,
        "shipping_days_min": 3,
        "shipping_days_max": 7,
        "warehouse": "US",
        "seller_rating": 4.7,
        "total_orders": None,
        "moq": 1,
        "is_best": 1,
        "raw_data": json.dumps({
            "pod_type": pod_type,
            "design_brief": design_brief,
            "source_method": "pod_printful",
            "costs": costs,
        }),
    })

    update_product(product_id, {"fulfillment_method": "pod"})

    log.info(
        f"Sourced POD {keyword}: {pod_type} via Printful, "
        f"${landed} → ${retail} ({margin}% margin)"
    )
    return True


# ============================================================
# Digital Product Sourcing
# ============================================================

async def source_digital_product(product_id: str, keyword: str, category: str | None) -> bool:
    """Source a digital/downloadable product. Cost is ~$0."""

    # LLM call: define the digital product
    product_def = None
    prompt = f"""You are a digital product strategist. Define this digital product opportunity.

Product idea: "{keyword}"
Category: {category or "general"}

Respond with ONLY valid JSON:
{{
  "product_title": "<marketplace listing title>",
  "description": "<what the buyer gets — be specific about files/formats>",
  "includes": ["<file 1>", "<file 2>", "..."],
  "suggested_price": <number in USD, $5-30 range>,
  "target_audience": "<who buys this>",
  "delivery_method": "instant download" | "email" | "membership"
}}"""

    text = await _call_llm(prompt)
    retail = 14.99  # Default
    if text:
        try:
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\n?", "", text)
                text = re.sub(r"\n?```$", "", text)
            product_def = json.loads(text)
            if product_def.get("suggested_price"):
                retail = float(product_def["suggested_price"])
        except (json.JSONDecodeError, ValueError):
            pass

    # Digital products: $0 COGS, ~5% payment processing
    processing_fee = round(retail * 0.05, 2)
    margin = round((retail - processing_fee) / retail * 100, 1)

    log_training_event("suppliers", {
        "product_id": product_id,
        "platform": "printful",  # Using printful to satisfy CHECK constraint; raw_data has real type
        "supplier_url": None,
        "unit_cost": 0,
        "shipping_cost": 0,
        "landed_cost": processing_fee,
        "estimated_retail": retail,
        "margin_pct": margin,
        "shipping_days_min": 0,
        "shipping_days_max": 0,
        "warehouse": "US",
        "seller_rating": 5.0,
        "total_orders": None,
        "moq": 1,
        "is_best": 1,
        "raw_data": json.dumps({
            "source_method": "digital",
            "product_definition": product_def,
            "delivery": "instant_download",
        }),
    })

    # DB CHECK constraint only allows 'dropship', 'pod', 'manual'
    # Store digital as 'pod' — the raw_data.source_method distinguishes them
    update_product(product_id, {"fulfillment_method": "pod"})

    log.info(f"Sourced DIGITAL {keyword}: ${retail} retail, {margin}% margin")
    return True


# ============================================================
# Margin Calculation & Fulfillment Decision (for dropship)
# ============================================================

def estimate_retail_price(landed_cost: float) -> float:
    if landed_cost < 10:
        return round(landed_cost * 3.5, 2)
    elif landed_cost < 25:
        return round(landed_cost * 2.8, 2)
    else:
        return round(landed_cost * 2.2, 2)


def decide_fulfillment(suppliers: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    if not suppliers:
        return None, "none"
    cj_us = [s for s in suppliers if s["platform"] == "cj_dropshipping" and s.get("warehouse") == "US"]
    if cj_us:
        return min(cj_us, key=lambda s: s["landed_cost"]), "dropship"
    cj_any = [s for s in suppliers if s["platform"] == "cj_dropshipping"]
    if cj_any:
        return min(cj_any, key=lambda s: s["landed_cost"]), "dropship"
    llm = [s for s in suppliers if s.get("source_method") == "llm_estimate"]
    if llm:
        return llm[0], "dropship"
    return min(suppliers, key=lambda s: s["landed_cost"]), "manual"


# ============================================================
# Main sourcing pipeline (routes by fulfillment type)
# ============================================================

async def source_product(product_id: str, keyword: str, category: str | None) -> bool:
    """Find suppliers for a single product. Routes by fulfillment type."""
    # Check if product already has a fulfillment_method set by Scout
    with get_db() as conn:
        row = conn.execute("SELECT fulfillment_method FROM products WHERE id = ?", [product_id]).fetchone()
    method = row["fulfillment_method"] if row and row["fulfillment_method"] else None

    if method == "pod":
        log.info(f"Sourcing POD: {keyword} (id={product_id[:8]})")
        return await source_pod_product(product_id, keyword, category)

    if method == "digital":
        log.info(f"Sourcing DIGITAL: {keyword} (id={product_id[:8]})")
        return await source_digital_product(product_id, keyword, category)

    # Default: dropship sourcing
    log.info(f"Sourcing DROPSHIP: {keyword} (id={product_id[:8]})")

    all_suppliers: list[dict[str, Any]] = []

    # Try CJ API first (real data)
    cj_results = await search_cj(keyword)
    all_suppliers.extend(cj_results)

    # If no real suppliers, use LLM estimation
    if not all_suppliers:
        llm_results = await estimate_via_llm(keyword, category)
        all_suppliers.extend(llm_results)

    if not all_suppliers:
        log.warning(f"No suppliers found for {keyword}")
        log_system_event("sourcer", "scrape_failure", "warning", f"No suppliers found: {keyword}")
        return False

    # Pick best supplier and fulfillment method
    best, method = decide_fulfillment(all_suppliers)
    if not best:
        return False

    # Calculate retail/margin if not already set
    if "estimated_retail" not in best or not best.get("estimated_retail"):
        best["estimated_retail"] = estimate_retail_price(best["landed_cost"])
    if "margin_pct" not in best or not best.get("margin_pct"):
        retail = best["estimated_retail"]
        best["margin_pct"] = round((retail - best["landed_cost"]) / retail * 100, 1) if retail > 0 else 0

    # Store all suppliers found
    for s in all_suppliers:
        is_best = 1 if s is best else 0
        retail = s.get("estimated_retail") or estimate_retail_price(s["landed_cost"])
        m_pct = s.get("margin_pct") or (round((retail - s["landed_cost"]) / retail * 100, 1) if retail > 0 else 0)

        log_training_event("suppliers", {
            "product_id": product_id,
            "platform": s["platform"],
            "supplier_url": s.get("supplier_url"),
            "unit_cost": s["unit_cost"],
            "shipping_cost": s["shipping_cost"],
            "landed_cost": s["landed_cost"],
            "estimated_retail": retail,
            "margin_pct": m_pct,
            "shipping_days_min": s.get("shipping_days_min"),
            "shipping_days_max": s.get("shipping_days_max"),
            "warehouse": s.get("warehouse"),
            "seller_rating": s.get("seller_rating"),
            "total_orders": s.get("total_orders"),
            "moq": s.get("moq", 1),
            "is_best": is_best,
            "raw_data": json.dumps(s.get("raw_data")) if s.get("raw_data") else None,
        })

    # Update product
    update_product(product_id, {"fulfillment_method": method})

    source_type = best.get("source_method", best["platform"])
    log.info(
        f"Sourced {keyword}: {len(all_suppliers)} suppliers via {source_type}, "
        f"best=${best['landed_cost']} → ${best.get('estimated_retail', '?')} "
        f"({best.get('margin_pct', '?')}% margin), method={method}"
    )
    return True


# ============================================================
# Service loop
# ============================================================

async def process_unsourced_products() -> int:
    """Find and source products without supplier data. Returns count sourced."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.id, p.keyword, p.category FROM products p
            WHERE p.stage = 'discovered'
              AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.product_id = p.id)
            ORDER BY p.created_at DESC
            LIMIT 10
        """).fetchall()

    if not rows:
        return 0

    log.info(f"Found {len(rows)} unsourced products")
    sourced = 0
    for row in rows:
        try:
            ok = await source_product(row["id"], row["keyword"], row["category"])
            if ok:
                sourced += 1
        except Exception as e:
            log.error(f"Failed to source {row['keyword']}: {e}")
        await asyncio.sleep(5)  # Rate limit between products
    return sourced


async def main() -> None:
    log.info("Sourcer agent starting")
    log_system_event("sourcer", "startup", "info", "Sourcer agent started")

    while True:
        try:
            count = await process_unsourced_products()
            if count > 0:
                log.info(f"Sourced {count} products this cycle")
        except Exception as e:
            log.error(f"Sourcing cycle crashed: {e}")
            log_system_event("sourcer", "error", "error", f"Sourcing cycle crash: {e}")
        await asyncio.sleep(120)  # Check every 2 minutes


if __name__ == "__main__":
    asyncio.run(main())
