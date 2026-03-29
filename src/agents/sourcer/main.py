"""GhostMarket Sourcer — Supplier Discovery & Margin Calculation

For each discovered product, find cheapest reliable supplier and determine
fulfillment method. Sources: AliExpress, CJ Dropshipping, Printful/Printify.
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
from playwright.async_api import async_playwright, Page

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.training import get_db, log_system_event, log_training_event, update_product

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Sourcer] %(message)s")
log = logging.getLogger("sourcer")


# ============================================================
# AliExpress Supplier Search
# ============================================================

async def search_aliexpress(page: Page, keyword: str) -> list[dict[str, Any]]:
    """Search AliExpress for product suppliers."""
    suppliers: list[dict[str, Any]] = []

    try:
        search_url = f"https://www.aliexpress.com/wholesale?SearchText={keyword.replace(' ', '+')}&SortType=total_tranpro_desc"
        await page.goto(search_url, timeout=30000)
        await page.wait_for_timeout(3000)

        items = await page.query_selector_all('[class*="search-card-item"], [class*="product-card"], [class*="list--gallery"]')
        log.info(f"AliExpress search '{keyword}': {len(items)} results")

        for item in items[:8]:
            try:
                # Title
                title_el = await item.query_selector('h1, h3, a[title], [class*="title"]')
                title = ""
                if title_el:
                    title = await title_el.get_attribute("title") or await title_el.inner_text()
                title = title.strip()

                # Price
                price_el = await item.query_selector('[class*="price"]')
                price_text = (await price_el.inner_text()).strip() if price_el else ""
                price = _extract_price(price_text)
                if price <= 0:
                    continue

                # Link
                link_el = await item.query_selector("a[href]")
                link = await link_el.get_attribute("href") if link_el else ""
                if link and not link.startswith("http"):
                    link = "https:" + link

                # Orders
                orders_el = await item.query_selector('[class*="sold"], [class*="order"]')
                orders_text = (await orders_el.inner_text()).strip() if orders_el else "0"
                orders = _parse_int(orders_text)

                # Rating
                rating_el = await item.query_selector('[class*="rating"], [class*="star"]')
                rating_text = (await rating_el.inner_text()).strip() if rating_el else "0"
                rating = _extract_float(rating_text)

                # Estimate shipping (AliExpress standard: $2-5 for small items)
                shipping_cost = 2.50 if price < 10 else 4.00

                suppliers.append({
                    "platform": "aliexpress",
                    "supplier_url": link,
                    "unit_cost": price,
                    "shipping_cost": shipping_cost,
                    "landed_cost": round(price + shipping_cost, 2),
                    "seller_rating": rating if rating > 0 else None,
                    "total_orders": orders,
                    "title": title,
                    "raw_data": {
                        "price_text": price_text,
                        "orders_text": orders_text,
                        "title": title,
                    },
                })
            except Exception as e:
                log.debug(f"Error parsing AliExpress item: {e}")

    except Exception as e:
        log.error(f"AliExpress search '{keyword}' failed: {e}")
        log_system_event("sourcer", "scrape_failure", "error", f"AliExpress search failed: {e}")

    return suppliers


# ============================================================
# CJ Dropshipping API
# ============================================================

async def search_cj(keyword: str) -> list[dict[str, Any]]:
    """Search CJ Dropshipping API for products."""
    suppliers: list[dict[str, Any]] = []
    api_key = os.getenv("CJ_API_KEY")

    if not api_key:
        log.debug("CJ_API_KEY not set, skipping CJ search")
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

            for item in data["data"]["list"][:8]:
                unit_cost = float(item.get("sellPrice", 0))
                if unit_cost <= 0:
                    continue

                # Check for US warehouse
                warehouse = "CN"
                variants = item.get("variants", [])
                for v in variants:
                    if "US" in str(v.get("variantWarehouse", "")):
                        warehouse = "US"
                        break

                shipping_cost = 2.00 if warehouse == "US" else 4.00
                shipping_days_min = 3 if warehouse == "US" else 7
                shipping_days_max = 8 if warehouse == "US" else 15

                suppliers.append({
                    "platform": "cj_dropshipping",
                    "supplier_url": f"https://cjdropshipping.com/product/{item.get('pid', '')}",
                    "unit_cost": unit_cost,
                    "shipping_cost": shipping_cost,
                    "landed_cost": round(unit_cost + shipping_cost, 2),
                    "shipping_days_min": shipping_days_min,
                    "shipping_days_max": shipping_days_max,
                    "warehouse": warehouse,
                    "seller_rating": 4.5,  # CJ is platform-rated
                    "total_orders": None,
                    "title": item.get("productNameEn", ""),
                    "raw_data": item,
                })

    except Exception as e:
        log.error(f"CJ search '{keyword}' failed: {e}")
        log_system_event("sourcer", "api_failure", "error", f"CJ search failed: {e}")

    return suppliers


# ============================================================
# Printful (POD)
# ============================================================

async def search_printful(keyword: str) -> list[dict[str, Any]]:
    """Check Printful for POD-eligible products."""
    suppliers: list[dict[str, Any]] = []
    api_key = os.getenv("PRINTFUL_API_KEY")

    if not api_key:
        log.debug("PRINTFUL_API_KEY not set, skipping Printful")
        return suppliers

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://api.printful.com/products",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()

            # Printful returns product catalog, match by keyword
            for item in data.get("result", [])[:5]:
                title = item.get("title", "").lower()
                if not any(w in title for w in keyword.lower().split()):
                    continue

                # Get variant pricing
                prod_id = item.get("id")
                var_resp = await client.get(
                    f"https://api.printful.com/products/{prod_id}",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                var_data = var_resp.json()
                variants = var_data.get("result", {}).get("variants", [])
                if not variants:
                    continue

                # Use cheapest variant
                cheapest = min(variants, key=lambda v: float(v.get("price", "999")))
                unit_cost = float(cheapest.get("price", 0))

                suppliers.append({
                    "platform": "printful",
                    "supplier_url": f"https://www.printful.com/custom/{prod_id}",
                    "unit_cost": unit_cost,
                    "shipping_cost": 4.50,  # Printful standard US
                    "landed_cost": round(unit_cost + 4.50, 2),
                    "shipping_days_min": 2,
                    "shipping_days_max": 5,
                    "warehouse": "US",
                    "seller_rating": 4.7,
                    "total_orders": None,
                    "moq": 1,
                    "title": item.get("title", ""),
                    "raw_data": {"product_id": prod_id, "variant_id": cheapest.get("id")},
                })

    except Exception as e:
        log.error(f"Printful search '{keyword}' failed: {e}")

    return suppliers


# ============================================================
# Margin Calculation & Fulfillment Decision
# ============================================================

def estimate_retail_price(keyword: str, landed_cost: float) -> float:
    """Estimate retail price based on typical markup for product category."""
    # Standard e-commerce markup: 2.5-4x landed cost
    # Products under $10 landed → $19.99-$29.99 retail
    # Products $10-25 landed → $29.99-$49.99 retail
    # Products $25+ landed → $49.99-$79.99 retail
    if landed_cost < 10:
        return round(landed_cost * 3.5, 2)
    elif landed_cost < 25:
        return round(landed_cost * 2.8, 2)
    else:
        return round(landed_cost * 2.2, 2)


def decide_fulfillment(suppliers: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    """Pick best supplier and fulfillment method.

    Decision tree:
    - High-margin + US warehouse + fast shipping → dropship via CJ
    - POD-eligible (custom/branded) → POD via Printful/Printify
    - Bulk commodity with proven demand → flag for manual
    """
    if not suppliers:
        return None, "none"

    # Prefer CJ with US warehouse
    cj_us = [s for s in suppliers if s["platform"] == "cj_dropshipping" and s.get("warehouse") == "US"]
    if cj_us:
        best = min(cj_us, key=lambda s: s["landed_cost"])
        return best, "dropship"

    # Then CJ without US warehouse
    cj_any = [s for s in suppliers if s["platform"] == "cj_dropshipping"]
    if cj_any:
        best = min(cj_any, key=lambda s: s["landed_cost"])
        return best, "dropship"

    # POD options
    pod = [s for s in suppliers if s["platform"] in ("printful", "printify")]
    if pod:
        best = min(pod, key=lambda s: s["landed_cost"])
        return best, "pod"

    # Fallback to cheapest AliExpress
    ali = [s for s in suppliers if s["platform"] == "aliexpress"]
    if ali:
        best = min(ali, key=lambda s: s["landed_cost"])
        # High order count + high rating = reliable
        if (best.get("total_orders") or 0) > 1000 and (best.get("seller_rating") or 0) > 4.5:
            return best, "dropship"
        return best, "manual"  # Flag for operator review

    # Last resort
    best = min(suppliers, key=lambda s: s["landed_cost"])
    return best, "manual"


# ============================================================
# Main sourcing pipeline
# ============================================================

async def source_product(product_id: str, keyword: str) -> None:
    """Find suppliers for a single product."""
    log.info(f"Sourcing: {keyword} (id={product_id[:8]})")

    all_suppliers: list[dict[str, Any]] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = await browser.new_page(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )

        try:
            # Search all sources in parallel where possible
            ali_results = await search_aliexpress(page, keyword)
            all_suppliers.extend(ali_results)
        finally:
            await browser.close()

    # API-based sources (no browser needed)
    cj_results = await search_cj(keyword)
    all_suppliers.extend(cj_results)

    printful_results = await search_printful(keyword)
    all_suppliers.extend(printful_results)

    if not all_suppliers:
        log.warning(f"No suppliers found for {keyword}")
        log_system_event("sourcer", "scrape_failure", "warning", f"No suppliers found: {keyword}")
        return

    # Pick best supplier and fulfillment method
    best, method = decide_fulfillment(all_suppliers)
    if not best:
        return

    estimated_retail = estimate_retail_price(keyword, best["landed_cost"])
    margin_pct = round((estimated_retail - best["landed_cost"]) / estimated_retail * 100, 1)

    # Store all suppliers found
    for i, s in enumerate(all_suppliers):
        is_best = 1 if s is best else 0
        retail = estimated_retail if is_best else estimate_retail_price(keyword, s["landed_cost"])
        m_pct = round((retail - s["landed_cost"]) / retail * 100, 1) if retail > 0 else 0

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

    # Update product with sourcing results
    update_product(product_id, {
        "fulfillment_method": method,
        "stage": "discovered",  # Stays discovered until scored
    })

    log.info(
        f"Sourced {keyword}: {len(all_suppliers)} suppliers, "
        f"best={best['platform']} ${best['landed_cost']} → ${estimated_retail} "
        f"({margin_pct}% margin), method={method}"
    )


# ============================================================
# Service loop
# ============================================================

async def process_unsourced_products() -> None:
    """Find products that haven't been sourced yet and source them."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.id, p.keyword FROM products p
            WHERE p.stage = 'discovered'
              AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.product_id = p.id)
            ORDER BY p.created_at DESC
            LIMIT 10
        """).fetchall()

    if not rows:
        log.info("No unsourced products found")
        return

    log.info(f"Found {len(rows)} unsourced products")
    for row in rows:
        try:
            await source_product(row["id"], row["keyword"])
        except Exception as e:
            log.error(f"Failed to source {row['keyword']}: {e}")
        await asyncio.sleep(5)


async def main() -> None:
    log.info("Sourcer agent starting")
    log_system_event("sourcer", "startup", "info", "Sourcer agent started")

    while True:
        try:
            await process_unsourced_products()
        except Exception as e:
            log.error(f"Sourcing cycle crashed: {e}")
            log_system_event("sourcer", "error", "error", f"Sourcing cycle crash: {e}")
        await asyncio.sleep(300)  # Check every 5 minutes


# ============================================================
# Helpers
# ============================================================

def _extract_price(text: str) -> float:
    match = re.search(r"[\d]+\.[\d]+|[\d]+", text.replace(",", ""))
    return float(match.group()) if match else 0.0


def _extract_float(text: str) -> float:
    match = re.search(r"[\d]+\.?[\d]*", text)
    return float(match.group()) if match else 0.0


def _parse_int(text: str) -> int:
    text = text.replace(",", "").replace("+", "")
    match = re.search(r"\d+", text)
    return int(match.group()) if match else 0


if __name__ == "__main__":
    asyncio.run(main())
