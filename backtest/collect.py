"""GhostMarket Backtest — Data Collection Pipeline

Scrapes AliExpress (with Amazon fallback) and Google Trends
to build a labeled dataset of 2000+ products for model training.

Usage:
    python collect.py                # Full collection (AliExpress + Trends)
    python collect.py --trends-only  # Only collect Google Trends data
    python collect.py --amazon       # Use Amazon instead of AliExpress
"""

import asyncio
import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [Collect] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("backtest/collect.log"),
    ],
)
log = logging.getLogger("collect")

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
RAW_ALI_DIR = DATA_DIR / "raw" / "aliexpress"
RAW_TRENDS_DIR = DATA_DIR / "raw" / "google_trends"
PRODUCTS_FILE = DATA_DIR / "products.jsonl"
PROGRESS_FILE = DATA_DIR / "raw" / "collect_progress.json"

for d in [RAW_ALI_DIR, RAW_TRENDS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ============================================================
# Seed Categories & Search Queries
# ============================================================

CATEGORIES = {
    "home_decor": [
        "LED cloud lamp", "sunset projection lamp", "moon lamp", "star projector",
        "neon sign custom", "floating shelf", "aesthetic room decor", "LED strip lights",
        "mushroom lamp", "crystal lamp", "galaxy projector", "lava lamp",
        "wall art canvas", "macrame wall hanging", "fairy lights bedroom",
        "desk lamp minimalist", "aromatherapy diffuser", "smart light bulb",
        "plant pot self watering", "bookshelf organizer",
    ],
    "gadgets": [
        "magnetic phone mount car", "wireless charger stand", "bluetooth tracker",
        "portable mini projector", "ring light selfie", "phone camera lens kit",
        "cable organizer desk", "USB desk fan", "smart plug wifi",
        "earbuds wireless bluetooth", "phone stand adjustable", "laptop stand",
        "power bank 20000mah", "webcam cover slide", "screen magnifier phone",
        "keyboard mechanical mini", "mouse pad large", "monitor light bar",
        "USB hub multiport", "digital photo frame",
    ],
    "fitness": [
        "posture corrector", "resistance bands set", "massage gun mini",
        "yoga mat thick", "jump rope weighted", "ab roller wheel",
        "wrist wraps gym", "foam roller", "water bottle motivational",
        "fitness tracker band", "pull up bar doorway", "ankle weights",
        "exercise ball", "grip strength trainer", "knee sleeve compression",
        "running belt waist", "gym bag duffle", "sweat belt waist",
        "push up board", "workout gloves",
    ],
    "kitchen": [
        "air fryer accessories", "spice organizer rack", "knife sharpener",
        "vegetable chopper dicer", "coffee scale digital", "ice cube tray silicone",
        "lunch box bento", "can opener electric", "egg cooker",
        "garlic press stainless", "measuring cups set", "oil sprayer cooking",
        "pizza stone", "silicone baking mat", "sous vide bags",
        "tea infuser", "tortilla press", "wine opener electric",
        "food storage containers glass", "mandoline slicer",
    ],
    "car_accessories": [
        "car phone mount magnetic", "dash cam 1080p", "car vacuum cleaner",
        "seat gap filler", "car trash can", "sun shade windshield",
        "LED strip car interior", "tire inflator portable", "car seat organizer",
        "steering wheel cover", "car air freshener", "blind spot mirror",
        "car charger fast", "trunk organizer", "car seat cushion",
        "windshield wiper blades", "car cleaning gel", "license plate frame",
        "car phone holder vent", "emergency kit car",
    ],
    "pet_products": [
        "automatic pet feeder", "cat water fountain", "dog harness no pull",
        "pet camera wifi", "cat tree tower", "dog toy interactive",
        "pet grooming brush", "cat litter mat", "dog bed orthopedic",
        "pet nail grinder", "fish tank LED light", "dog leash retractable",
        "cat scratching post", "puppy training pads", "pet carrier airline",
        "dog poop bag holder", "cat tunnel toy", "bird feeder window",
        "aquarium filter", "dog bowl slow feeder",
    ],
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
]


# ============================================================
# Parsing helpers
# ============================================================

def parse_price(text: str) -> float:
    """Extract price from text like 'US $4.50' or '$4.50 - $12.99'."""
    nums = re.findall(r"[\d.]+", text.replace(",", ""))
    return float(nums[0]) if nums else 0.0


def parse_orders(text: str) -> int:
    """Extract order count from text like '10,000+ sold' or '5k+ orders'."""
    text = text.lower().replace(",", "")
    if "k" in text:
        nums = re.findall(r"[\d.]+", text)
        return int(float(nums[0]) * 1000) if nums else 0
    nums = re.findall(r"\d+", text)
    return int(nums[0]) if nums else 0


def parse_rating(text: str) -> float:
    """Extract rating from text like '4.8' or '4.8/5'."""
    nums = re.findall(r"[\d.]+", text)
    for n in nums:
        f = float(n)
        if 0 <= f <= 5:
            return f
    return 0.0


def load_progress() -> dict:
    """Load scraping progress to support resume."""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"completed_queries": [], "total_products": 0}


def save_progress(progress: dict):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


# ============================================================
# AliExpress Scraper (Primary Source)
# ============================================================

async def scrape_aliexpress_keyword(keyword: str, category: str, max_results: int = 25) -> list[dict]:
    """Scrape AliExpress search results for a single keyword."""
    from playwright.async_api import async_playwright

    products = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        # Prevent webdriver detection
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        """)
        page = await context.new_page()

        search_url = f"https://www.aliexpress.com/wholesale?SearchText={keyword.replace(' ', '+')}&sortType=total_tranpro_desc"

        try:
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(random.randint(3000, 5000))

            # Scroll to load lazy content
            for _ in range(4):
                await page.evaluate("window.scrollBy(0, window.innerHeight)")
                await page.wait_for_timeout(random.randint(1000, 2500))

            # Strategy 1: Try to extract embedded JSON data (most reliable)
            page_content = await page.content()
            products_from_json = _extract_from_page_json(page_content, keyword, category)
            if products_from_json:
                products.extend(products_from_json[:max_results])
                log.info(f"  [JSON] {keyword}: found {len(products_from_json)} products")
            else:
                # Strategy 2: Parse DOM product cards
                selectors = [
                    "[class*='search-card-item']",
                    "[class*='product-card']",
                    "[class*='list--gallery'] > div",
                    "[class*='SearchProductFeed'] a[href*='/item/']",
                    "div[data-widget-cid*='product']",
                ]

                cards = []
                for sel in selectors:
                    cards = await page.query_selector_all(sel)
                    if cards:
                        log.info(f"  [DOM] {keyword}: found {len(cards)} cards via '{sel}'")
                        break

                if not cards:
                    # Strategy 3: Find all links to items and extract nearby text
                    cards = await page.query_selector_all("a[href*='/item/']")
                    log.info(f"  [LINKS] {keyword}: found {len(cards)} item links")

                for card in cards[:max_results]:
                    try:
                        product = await _parse_product_card(card, keyword, category)
                        if product and product.get("title") and product.get("price_usd", 0) > 0:
                            products.append(product)
                    except Exception:
                        continue

        except Exception as e:
            log.warning(f"  Error scraping '{keyword}': {e}")
        finally:
            await browser.close()

    return products


def _extract_from_page_json(html: str, keyword: str, category: str) -> list[dict]:
    """Try to extract product data from embedded page JSON."""
    products = []

    # AliExpress embeds data in various JS variables
    patterns = [
        r"window\.__INIT_DATA__\s*=\s*({.+?});\s*</script>",
        r"window\.runParams\s*=\s*({.+?});\s*</script>",
        r'"itemList"\s*:\s*(\[.+?\])',
        r'"items"\s*:\s*(\[.+?\])',
        r'"productList"\s*:\s*(\[.+?\])',
    ]

    for pattern in patterns:
        matches = re.findall(pattern, html, re.DOTALL)
        for match in matches:
            try:
                data = json.loads(match)
                items = _find_product_items(data)
                for item in items:
                    product = _normalize_ali_item(item, keyword, category)
                    if product:
                        products.append(product)
                if products:
                    return products
            except (json.JSONDecodeError, TypeError):
                continue

    return products


def _find_product_items(data, depth=0) -> list[dict]:
    """Recursively find product item lists in nested JSON."""
    if depth > 5:
        return []

    if isinstance(data, list):
        # Check if this looks like a list of product items
        if data and isinstance(data[0], dict) and any(
            k in data[0] for k in ["title", "productTitle", "name", "productId"]
        ):
            return data
        results = []
        for item in data[:10]:  # limit recursion
            results.extend(_find_product_items(item, depth + 1))
        return results

    if isinstance(data, dict):
        # Check known keys
        for key in ["itemList", "items", "productList", "products", "mods"]:
            if key in data:
                result = _find_product_items(data[key], depth + 1)
                if result:
                    return result
        # Recurse into values
        for v in list(data.values())[:20]:
            result = _find_product_items(v, depth + 1)
            if result:
                return result

    return []


def _normalize_ali_item(item: dict, keyword: str, category: str) -> dict | None:
    """Normalize an AliExpress JSON product item to our schema."""
    title = (
        item.get("title", {}).get("displayTitle", "")
        if isinstance(item.get("title"), dict)
        else item.get("title") or item.get("productTitle") or item.get("name", "")
    )

    if not title:
        return None

    # Price — try various key patterns
    price = 0.0
    for key in ["price", "sellingPrice", "salePrice", "minPrice"]:
        val = item.get(key)
        if isinstance(val, dict):
            price = parse_price(str(val.get("minPrice", val.get("formattedPrice", ""))))
        elif val:
            price = parse_price(str(val))
        if price > 0:
            break

    original_price = 0.0
    for key in ["originalPrice", "oriMinPrice"]:
        val = item.get(key)
        if isinstance(val, dict):
            original_price = parse_price(str(val.get("minPrice", val.get("formattedPrice", ""))))
        elif val:
            original_price = parse_price(str(val))
        if original_price > 0:
            break

    # Orders
    orders = 0
    for key in ["tradeDesc", "trade", "orders", "sold", "salesCount"]:
        val = item.get(key)
        if val:
            orders = parse_orders(str(val))
        if orders > 0:
            break

    # Rating
    rating = 0.0
    for key in ["starRating", "evaluation", "averageStar", "rating"]:
        val = item.get(key)
        if val:
            rating = parse_rating(str(val))
        if rating > 0:
            break

    # Store info
    store = item.get("store", {}) if isinstance(item.get("store"), dict) else {}
    store_name = store.get("storeName", item.get("storeName", ""))

    # Shipping
    shipping_text = ""
    for key in ["logistics", "shipping", "deliveryInfo"]:
        val = item.get(key)
        if val:
            shipping_text = str(val)
            break
    free_shipping = "free" in shipping_text.lower()

    # URL
    url = item.get("productDetailUrl") or item.get("itemUrl") or item.get("detailUrl", "")
    if url and not url.startswith("http"):
        url = "https:" + url if url.startswith("//") else "https://www.aliexpress.com" + url

    # Image
    image = item.get("image", {})
    image_url = image.get("imgUrl", "") if isinstance(image, dict) else str(image) if image else ""
    if image_url and not image_url.startswith("http"):
        image_url = "https:" + image_url

    return {
        "keyword": keyword,
        "title": title.strip(),
        "category": category,
        "price_usd": round(price, 2),
        "original_price_usd": round(original_price, 2),
        "total_orders": orders,
        "rating": round(rating, 1),
        "review_count": 0,  # Not always in search results
        "seller_rating": 0.0,
        "shipping_cost": 0.0 if free_shipping else 2.50,
        "ships_from": "",
        "free_shipping": free_shipping,
        "listing_url": url,
        "image_url": image_url,
        "store_name": store_name,
        "store_followers": 0,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


async def _parse_product_card(card, keyword: str, category: str) -> dict | None:
    """Parse a product card DOM element."""
    try:
        # Title
        title_el = await card.query_selector("[class*='title'], h1, h3, [class*='name']")
        title = await title_el.inner_text() if title_el else ""

        # Price
        price_el = await card.query_selector("[class*='price']")
        price_text = await price_el.inner_text() if price_el else "0"

        # Orders
        orders_el = await card.query_selector("[class*='sold'], [class*='orders'], [class*='trade']")
        orders_text = await orders_el.inner_text() if orders_el else "0"

        # Rating
        rating_el = await card.query_selector("[class*='star'], [class*='rating'], [class*='evaluation']")
        rating_text = await rating_el.inner_text() if rating_el else "0"

        # Link
        link_el = await card.query_selector("a[href*='/item/']")
        if not link_el:
            link_el = card if await card.get_attribute("href") else None
        link = await link_el.get_attribute("href") if link_el else ""
        if link and not link.startswith("http"):
            link = "https:" + link if link.startswith("//") else "https://www.aliexpress.com" + link

        return {
            "keyword": keyword,
            "title": title.strip(),
            "category": category,
            "price_usd": round(parse_price(price_text), 2),
            "original_price_usd": 0.0,
            "total_orders": parse_orders(orders_text),
            "rating": parse_rating(rating_text),
            "review_count": 0,
            "seller_rating": 0.0,
            "shipping_cost": 2.50,
            "ships_from": "",
            "free_shipping": False,
            "listing_url": link,
            "image_url": "",
            "store_name": "",
            "store_followers": 0,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        return None


# ============================================================
# Amazon Scraper (Fallback)
# ============================================================

async def scrape_amazon_keyword(keyword: str, category: str, max_results: int = 25) -> list[dict]:
    """Fallback: scrape Amazon search results."""
    from playwright.async_api import async_playwright

    products = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        """)
        page = await context.new_page()

        search_url = f"https://www.amazon.com/s?k={keyword.replace(' ', '+')}&s=review-rank"

        try:
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(random.randint(2000, 4000))

            # Scroll
            for _ in range(3):
                await page.evaluate("window.scrollBy(0, window.innerHeight)")
                await page.wait_for_timeout(random.randint(800, 1500))

            # Amazon product cards
            cards = await page.query_selector_all("[data-component-type='s-search-result']")
            log.info(f"  [Amazon] {keyword}: found {len(cards)} results")

            for card in cards[:max_results]:
                try:
                    # Title
                    title_el = await card.query_selector("h2 a span, h2 span")
                    title = await title_el.inner_text() if title_el else ""

                    # Price
                    price_el = await card.query_selector(".a-price .a-offscreen")
                    price_text = await price_el.inner_text() if price_el else "0"

                    # Rating
                    rating_el = await card.query_selector("[class*='a-icon-alt']")
                    rating_text = await rating_el.inner_text() if rating_el else "0"

                    # Review count
                    review_el = await card.query_selector("[class*='s-link-style'] span.s-underline-text, a[href*='customerReviews'] span")
                    review_text = await review_el.inner_text() if review_el else "0"
                    review_count = parse_orders(review_text)

                    # Link
                    link_el = await card.query_selector("h2 a")
                    link = await link_el.get_attribute("href") if link_el else ""
                    if link and not link.startswith("http"):
                        link = "https://www.amazon.com" + link

                    # Image
                    img_el = await card.query_selector("img.s-image")
                    img = await img_el.get_attribute("src") if img_el else ""

                    price = parse_price(price_text)
                    rating = parse_rating(rating_text)

                    # Amazon doesn't show order count — use review_count as proxy
                    # Rule of thumb: orders ≈ reviews × 10-20
                    estimated_orders = review_count * 15

                    if title and price > 0:
                        products.append({
                            "keyword": keyword,
                            "title": title.strip(),
                            "category": category,
                            "price_usd": round(price, 2),
                            "original_price_usd": 0.0,
                            "total_orders": estimated_orders,
                            "rating": round(rating, 1),
                            "review_count": review_count,
                            "seller_rating": 0.0,
                            "shipping_cost": 0.0,
                            "ships_from": "US",
                            "free_shipping": True,
                            "listing_url": link,
                            "image_url": img,
                            "store_name": "Amazon",
                            "store_followers": 0,
                            "source": "amazon",
                            "scraped_at": datetime.now(timezone.utc).isoformat(),
                        })
                except Exception:
                    continue

        except Exception as e:
            log.warning(f"  [Amazon] Error scraping '{keyword}': {e}")
        finally:
            await browser.close()

    return products


# ============================================================
# Google Trends Collection
# ============================================================

def collect_trends_for_keyword(keyword: str) -> dict:
    """Get Google Trends data for a keyword over last 2 years."""
    from pytrends.request import TrendReq

    output_path = RAW_TRENDS_DIR / f"{keyword.replace(' ', '_').replace('/', '_')}.json"
    if output_path.exists():
        with open(output_path) as f:
            existing = json.load(f)
        if existing.get("has_data") is not None:
            log.info(f"  [Trends] '{keyword}': cached, skipping")
            return existing

    try:
        pytrends = TrendReq(hl="en-US", tz=360, retries=3, backoff_factor=1.0)
        pytrends.build_payload([keyword], timeframe="today 24-m", geo="US")
        interest = pytrends.interest_over_time()

        if interest.empty:
            result = {"keyword": keyword, "has_data": False}
        else:
            values = interest[keyword].tolist()
            dates = [str(d.date()) for d in interest.index]

            # Trend features
            if len(values) >= 8:
                recent_4w = sum(values[-4:]) / 4
                prev_4w = sum(values[-8:-4]) / 4
                velocity = (recent_4w - prev_4w) / max(prev_4w, 1)
            else:
                velocity = 0

            peak_value = max(values) if values else 0
            peak_index = values.index(peak_value) if peak_value > 0 else 0
            current_value = values[-1] if values else 0

            # Phase detection
            if peak_index >= len(values) - 4:
                phase = "peaking"
            elif velocity > 0.1:
                phase = "rising"
            elif velocity < -0.1:
                phase = "declining"
            else:
                phase = "stable"

            result = {
                "keyword": keyword,
                "has_data": True,
                "time_series": values,
                "dates": dates,
                "peak_value": peak_value,
                "current_value": current_value,
                "velocity": round(velocity, 4),
                "phase": phase,
                "peak_to_current_ratio": round(current_value / max(peak_value, 1), 4),
            }

    except Exception as e:
        log.warning(f"  [Trends] Error for '{keyword}': {e}")
        result = {"keyword": keyword, "has_data": False, "error": str(e)}

    # Save
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    return result


def collect_all_trends():
    """Collect Google Trends for all unique keywords in products.jsonl."""
    # Gather all unique keywords
    keywords = set()
    if PRODUCTS_FILE.exists():
        with open(PRODUCTS_FILE) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        p = json.loads(line)
                        keywords.add(p.get("keyword", ""))
                    except json.JSONDecodeError:
                        continue
    else:
        # Use seed category keywords
        for kws in CATEGORIES.values():
            keywords.update(kws)

    keywords.discard("")
    keywords = sorted(keywords)
    log.info(f"Collecting trends for {len(keywords)} keywords")

    results = {}
    for i, kw in enumerate(keywords):
        log.info(f"  [{i + 1}/{len(keywords)}] Trends: {kw}")
        results[kw] = collect_trends_for_keyword(kw)

        # Rate limit: pytrends gets blocked at ~10 requests/minute
        if (i + 1) % 5 == 0:
            log.info(f"  Rate limit pause (5 queries done)...")
            time.sleep(65)
        else:
            time.sleep(random.randint(12, 20))

    log.info(f"Trends collection complete: {len(results)} keywords")
    return results


# ============================================================
# Product Scraping Orchestrator
# ============================================================

async def collect_products(use_amazon: bool = False):
    """Scrape products from all categories. Saves progress after each keyword."""
    progress = load_progress()
    completed = set(progress.get("completed_queries", []))
    total_new = 0

    # Open products file in append mode
    all_queries = []
    for category, keywords in CATEGORIES.items():
        for kw in keywords:
            query_key = f"{category}::{kw}"
            if query_key not in completed:
                all_queries.append((category, kw, query_key))

    log.info(f"Total queries: {len(all_queries) + len(completed)} ({len(completed)} already done)")

    scrape_fn = scrape_amazon_keyword if use_amazon else scrape_aliexpress_keyword
    source_name = "Amazon" if use_amazon else "AliExpress"
    query_count = 0

    for category, keyword, query_key in all_queries:
        log.info(f"[{query_count + 1}/{len(all_queries)}] {source_name}: '{keyword}' ({category})")

        try:
            products = await scrape_fn(keyword, category)
        except Exception as e:
            log.error(f"  Scrape failed for '{keyword}': {e}")
            products = []

        if products:
            # Save raw data
            safe_name = keyword.replace(" ", "_").replace("/", "_")
            raw_path = RAW_ALI_DIR / f"{category}_{safe_name}.json"
            with open(raw_path, "w") as f:
                json.dump(products, f, indent=2)

            # Append to products.jsonl
            with open(PRODUCTS_FILE, "a") as f:
                for p in products:
                    p["source"] = source_name.lower()
                    f.write(json.dumps(p) + "\n")

            total_new += len(products)
            log.info(f"  Saved {len(products)} products (total new: {total_new})")
        else:
            log.warning(f"  No products found for '{keyword}'")

        # Update progress
        completed.add(query_key)
        progress["completed_queries"] = list(completed)
        progress["total_products"] = progress.get("total_products", 0) + len(products)
        save_progress(progress)

        # Rate limiting
        query_count += 1
        if query_count % 10 == 0:
            pause = random.randint(25, 40)
            log.info(f"  Long pause ({pause}s) after 10 queries...")
            await asyncio.sleep(pause)
        else:
            delay = random.uniform(3.0, 6.0)
            await asyncio.sleep(delay)

    log.info(f"Collection complete! {total_new} new products scraped.")
    _print_collection_stats()


def _print_collection_stats():
    """Print summary statistics of collected data."""
    if not PRODUCTS_FILE.exists():
        log.info("No products collected yet.")
        return

    total = 0
    by_category = {}
    by_source = {}
    with_orders = 0

    with open(PRODUCTS_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                p = json.loads(line)
                total += 1
                cat = p.get("category", "unknown")
                by_category[cat] = by_category.get(cat, 0) + 1
                src = p.get("source", "unknown")
                by_source[src] = by_source.get(src, 0) + 1
                if p.get("total_orders", 0) > 0:
                    with_orders += 1
            except json.JSONDecodeError:
                continue

    log.info(f"\n{'=' * 50}")
    log.info(f"COLLECTION STATS")
    log.info(f"{'=' * 50}")
    log.info(f"Total products: {total}")
    log.info(f"With order data: {with_orders} ({with_orders / max(total, 1) * 100:.0f}%)")
    log.info(f"\nBy category:")
    for cat, count in sorted(by_category.items()):
        log.info(f"  {cat}: {count}")
    log.info(f"\nBy source:")
    for src, count in sorted(by_source.items()):
        log.info(f"  {src}: {count}")


# ============================================================
# Main
# ============================================================

def main():
    args = sys.argv[1:]
    use_amazon = "--amazon" in args
    trends_only = "--trends-only" in args

    if trends_only:
        log.info("=" * 50)
        log.info("COLLECTING GOOGLE TRENDS DATA ONLY")
        log.info("=" * 50)
        collect_all_trends()
    else:
        log.info("=" * 50)
        log.info(f"COLLECTING PRODUCTS FROM {'AMAZON' if use_amazon else 'ALIEXPRESS'}")
        log.info("=" * 50)
        asyncio.run(collect_products(use_amazon=use_amazon))

        log.info("")
        log.info("=" * 50)
        log.info("COLLECTING GOOGLE TRENDS DATA")
        log.info("=" * 50)
        collect_all_trends()


if __name__ == "__main__":
    main()
