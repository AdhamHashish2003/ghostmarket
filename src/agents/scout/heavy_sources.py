"""GhostMarket Scout — Heavy Sources (runs on ROG)

TikTok Creative Center, Amazon Movers & Shakers, AliExpress Trending.
All via Playwright (browser automation). Requires GPU machine for memory.
"""

import asyncio
import json
import logging
import os
import sys
import time

from playwright.async_api import async_playwright, Page, Browser

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.training import (
    create_product,
    find_product_by_keyword,
    log_system_event,
    log_trend_signal,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Scout-Heavy] %(message)s")
log = logging.getLogger("scout-heavy")

# Track consecutive failures per platform for pause logic
_failure_counts: dict[str, int] = {}
_paused_until: dict[str, float] = {}
PAUSE_DURATION = 7200  # 2 hours
MAX_CONSECUTIVE_FAILURES = 5


def _check_paused(source: str) -> bool:
    until = _paused_until.get(source, 0)
    if time.time() < until:
        log.info(f"{source} paused until {time.ctime(until)}")
        return True
    if until > 0:
        _paused_until.pop(source, None)
        _failure_counts[source] = 0
    return False


def _record_failure(source: str, error: str) -> None:
    _failure_counts[source] = _failure_counts.get(source, 0) + 1
    if _failure_counts[source] >= MAX_CONSECUTIVE_FAILURES:
        _paused_until[source] = time.time() + PAUSE_DURATION
        log.warning(f"{source} paused for {PAUSE_DURATION}s after {MAX_CONSECUTIVE_FAILURES} failures")
        log_system_event(
            "scout-heavy", "scrape_failure", "warning",
            f"{source} paused after {MAX_CONSECUTIVE_FAILURES} consecutive failures: {error}",
        )


def _record_success(source: str) -> None:
    _failure_counts[source] = 0


# ============================================================
# TikTok Creative Center
# ============================================================

async def scrape_tiktok(page: Page) -> list[dict]:
    """Scrape TikTok Creative Center for top-performing product ads."""
    log.info("Scraping TikTok Creative Center")
    signals: list[dict] = []

    if _check_paused("tiktok_cc"):
        return signals

    try:
        await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en", timeout=30000)
        await page.wait_for_timeout(3000)

        # Select product/ecommerce category if available
        # The page structure varies; we look for ad cards
        ad_cards = await page.query_selector_all('[class*="CardPc_cardWrapper"]')
        if not ad_cards:
            ad_cards = await page.query_selector_all('[class*="card-wrapper"], [class*="AdCard"]')

        log.info(f"Found {len(ad_cards)} TikTok ad cards")

        for card in ad_cards[:20]:
            try:
                # Extract ad text/title
                title_el = await card.query_selector('[class*="title"], h3, [class*="CardPc_title"]')
                title = await title_el.inner_text() if title_el else ""
                if not title:
                    continue

                # Extract metrics if available
                likes_el = await card.query_selector('[class*="like"], [class*="interaction"]')
                likes_text = await likes_el.inner_text() if likes_el else "0"

                # Parse likes (handle K, M suffixes)
                likes = _parse_metric(likes_text)
                strength = min(likes / 100000, 1.0) if likes > 0 else 0.3

                signals.append({
                    "source": "tiktok_cc",
                    "product_keyword": title[:100],
                    "raw_signal_strength": strength,
                    "trend_velocity": "rising",
                    "competing_ads_count": len(ad_cards),
                    "signal_metadata": {
                        "likes": likes,
                        "raw_likes_text": likes_text,
                        "platform": "tiktok",
                    },
                })
            except Exception as e:
                log.debug(f"Error parsing TikTok card: {e}")

        _record_success("tiktok_cc")

    except Exception as e:
        log.error(f"TikTok Creative Center scrape failed: {e}")
        _record_failure("tiktok_cc", str(e))

    return signals


# ============================================================
# Amazon Movers & Shakers
# ============================================================

async def scrape_amazon(page: Page) -> list[dict]:
    """Scrape Amazon Movers & Shakers across product categories."""
    log.info("Scraping Amazon Movers & Shakers")
    signals: list[dict] = []

    if _check_paused("amazon"):
        return signals

    categories = {
        "home-garden": "home_decor",
        "electronics": "gadgets",
        "sports-and-outdoors": "fitness",
        "kitchen": "kitchen",
        "automotive": "car_accessories",
        "pet-supplies": "pet_products",
    }

    try:
        for dept, category in categories.items():
            try:
                url = f"https://www.amazon.com/gp/movers-and-shakers/{dept}"
                await page.goto(url, timeout=30000)
                await page.wait_for_timeout(2000)

                items = await page.query_selector_all('[class*="zg-bdg-text"], .zg-item, [id*="gridItemRoot"]')
                if not items:
                    items = await page.query_selector_all('[class*="p13n-sc-uncoverable-faceout"]')

                log.info(f"Amazon {dept}: found {len(items)} items")

                for item in items[:10]:
                    try:
                        # Get product title
                        title_el = await item.query_selector('a span, [class*="p13n-sc-truncate"]')
                        title = (await title_el.inner_text()).strip() if title_el else ""
                        if not title or len(title) < 5:
                            continue

                        # Get percentage moved
                        pct_el = await item.query_selector('[class*="zg-bdg-text"], [class*="percentChange"]')
                        pct_text = (await pct_el.inner_text()).strip() if pct_el else ""
                        pct_value = _parse_percentage(pct_text)

                        # Get price
                        price_el = await item.query_selector('[class*="price"], .p13n-sc-price')
                        price_text = (await price_el.inner_text()).strip() if price_el else ""

                        strength = min(pct_value / 500, 1.0) if pct_value > 0 else 0.3

                        signals.append({
                            "source": "amazon",
                            "product_keyword": title[:100],
                            "category": category,
                            "raw_signal_strength": strength,
                            "trend_velocity": "rising" if pct_value > 100 else "peaking",
                            "signal_metadata": {
                                "department": dept,
                                "pct_change": pct_value,
                                "price": price_text,
                            },
                        })
                    except Exception as e:
                        log.debug(f"Error parsing Amazon item: {e}")

                await page.wait_for_timeout(3000)  # Rate limit between categories
            except Exception as e:
                log.warning(f"Amazon {dept} failed: {e}")

        _record_success("amazon")

    except Exception as e:
        log.error(f"Amazon scrape failed: {e}")
        _record_failure("amazon", str(e))

    return signals


# ============================================================
# AliExpress Trending
# ============================================================

async def scrape_aliexpress(page: Page) -> list[dict]:
    """Scrape AliExpress trending/hot products."""
    log.info("Scraping AliExpress trending")
    signals: list[dict] = []

    if _check_paused("aliexpress"):
        return signals

    try:
        await page.goto("https://www.aliexpress.com/popular.html", timeout=30000)
        await page.wait_for_timeout(3000)

        items = await page.query_selector_all('[class*="product-card"], [class*="list-item"], .product-item')
        if not items:
            # Try alternative trending page
            await page.goto("https://www.aliexpress.com/category/100003109/home-decor.html?SortType=total_tranpro_desc", timeout=30000)
            await page.wait_for_timeout(3000)
            items = await page.query_selector_all('[class*="search-card-item"], [class*="product-card"]')

        log.info(f"AliExpress: found {len(items)} trending items")

        for item in items[:20]:
            try:
                title_el = await item.query_selector('h1, h3, [class*="title"], a[title]')
                title = ""
                if title_el:
                    title = await title_el.get_attribute("title") or await title_el.inner_text()
                title = title.strip()
                if not title or len(title) < 5:
                    continue

                # Get order count
                orders_el = await item.query_selector('[class*="order"], [class*="sold"]')
                orders_text = (await orders_el.inner_text()).strip() if orders_el else ""
                orders = _parse_metric(orders_text)

                # Get price
                price_el = await item.query_selector('[class*="price"]')
                price_text = (await price_el.inner_text()).strip() if price_el else ""

                # Get rating
                rating_el = await item.query_selector('[class*="rating"], [class*="star"]')
                rating_text = (await rating_el.inner_text()).strip() if rating_el else ""

                strength = min(orders / 10000, 1.0) if orders > 0 else 0.3

                signals.append({
                    "source": "aliexpress",
                    "product_keyword": title[:100],
                    "raw_signal_strength": strength,
                    "trend_velocity": "peaking" if orders > 5000 else "rising",
                    "signal_metadata": {
                        "orders": orders,
                        "price": price_text,
                        "rating": rating_text,
                    },
                })
            except Exception as e:
                log.debug(f"Error parsing AliExpress item: {e}")

        _record_success("aliexpress")

    except Exception as e:
        log.error(f"AliExpress scrape failed: {e}")
        _record_failure("aliexpress", str(e))

    return signals


# ============================================================
# Helpers
# ============================================================

def _parse_metric(text: str) -> int:
    """Parse metric strings like '12.5K', '1.2M', '5,000'."""
    text = text.strip().replace(",", "").replace("+", "")
    try:
        if "M" in text.upper():
            return int(float(text.upper().replace("M", "")) * 1_000_000)
        if "K" in text.upper():
            return int(float(text.upper().replace("K", "")) * 1_000)
        # Extract first number from string
        import re
        match = re.search(r"[\d.]+", text)
        return int(float(match.group())) if match else 0
    except (ValueError, AttributeError):
        return 0


def _parse_percentage(text: str) -> float:
    """Parse percentage strings like '+340%', '340%'."""
    import re
    match = re.search(r"[\d.]+", text)
    return float(match.group()) if match else 0.0


# ============================================================
# Signal processing (same as light_sources.py)
# ============================================================

def process_signals(signals: list[dict]) -> None:
    log.info(f"Processing {len(signals)} signals")
    for signal in signals:
        keyword = signal["product_keyword"]
        product = find_product_by_keyword(keyword)
        product_id = product["id"] if product else create_product(keyword, signal.get("category"))

        from shared.training import get_db
        with get_db() as conn:
            row = conn.execute(
                "SELECT COUNT(DISTINCT source) as cnt FROM trend_signals WHERE product_keyword = ?",
                [keyword],
            ).fetchone()
            cross_source = (row["cnt"] if row else 0) + 1

        log_trend_signal(
            source=signal["source"],
            product_keyword=keyword,
            raw_signal_strength=signal["raw_signal_strength"],
            category=signal.get("category"),
            product_id=product_id,
            trend_velocity=signal.get("trend_velocity"),
            time_series_7d=signal.get("time_series_7d"),
            source_url=signal.get("source_url"),
            competing_ads_count=signal.get("competing_ads_count"),
            avg_engagement_rate=signal.get("avg_engagement_rate"),
            cross_source_hits=cross_source,
            signal_metadata=signal.get("signal_metadata"),
        )
    log.info(f"Stored {len(signals)} signals")


# ============================================================
# Main
# ============================================================

async def run_source(source: str) -> None:
    """Run a single heavy source scrape."""
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = await browser.new_page(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )

        try:
            if source == "tiktok_cc":
                signals = await scrape_tiktok(page)
            elif source == "amazon":
                signals = await scrape_amazon(page)
            elif source == "aliexpress":
                signals = await scrape_aliexpress(page)
            else:
                log.error(f"Unknown source: {source}")
                return

            if signals:
                process_signals(signals)
            else:
                log.info(f"No signals from {source}")
                log_system_event("scout-heavy", "scrape_failure", "warning", f"Empty response from {source}")
        finally:
            await browser.close()


async def main() -> None:
    """Run as a long-lived service with staggered scheduling."""
    log.info("Scout-Heavy starting")
    log_system_event("scout-heavy", "startup", "info", "Scout-Heavy agent started")

    # Initial run
    for source in ["tiktok_cc", "amazon", "aliexpress"]:
        try:
            await run_source(source)
        except Exception as e:
            log.error(f"{source} initial run failed: {e}")
        await asyncio.sleep(30)

    # Loop: TikTok every 4hr, Amazon every 6hr, AliExpress every 6hr
    last_tiktok = time.time()
    last_amazon = time.time()
    last_aliexpress = time.time()

    while True:
        now = time.time()

        if now - last_tiktok >= 14400:  # 4 hours
            try:
                await run_source("tiktok_cc")
            except Exception as e:
                log.error(f"TikTok cycle crashed: {e}")
            last_tiktok = time.time()

        if now - last_amazon >= 21600:  # 6 hours
            try:
                await run_source("amazon")
            except Exception as e:
                log.error(f"Amazon cycle crashed: {e}")
            last_amazon = time.time()

        if now - last_aliexpress >= 21600:  # 6 hours
            try:
                await run_source("aliexpress")
            except Exception as e:
                log.error(f"AliExpress cycle crashed: {e}")
            last_aliexpress = time.time()

        await asyncio.sleep(60)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        asyncio.run(run_source(sys.argv[1]))
    else:
        asyncio.run(main())
