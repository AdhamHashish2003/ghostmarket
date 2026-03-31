"""GhostMarket Scout — Light Sources (runs on PC)

Google Trends via pytrends and Reddit via PRAW.
These are API-based (no browser needed), so they run on the primary PC.
"""

import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from shared.training import (
    create_product,
    find_product_by_keyword,
    log_system_event,
    log_trend_signal,
    update_product,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Scout-Light] %(message)s")
log = logging.getLogger("scout-light")

SEED_CATEGORIES = ["home decor", "gadgets", "fitness", "kitchen", "car accessories", "pet products",
                    "pod apparel", "pod home", "pod accessories"]
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "home_decor": ["LED lamp", "wall art", "room decor", "aesthetic lamp", "cloud light", "neon sign", "sunset lamp",
                   "star projector", "mushroom lamp", "galaxy projector", "floating shelf", "moon lamp", "lava lamp", "smart bulb"],
    "gadgets": ["phone mount", "wireless charger", "mini projector", "portable speaker", "smart ring",
                "ring light", "laptop stand", "power bank", "cable organizer", "magnetic phone mount", "wireless earbuds"],
    "fitness": ["resistance bands", "massage gun", "yoga mat", "gym bag", "water bottle",
                "posture corrector", "smart water bottle", "pull up bar", "foam roller"],
    "kitchen": ["knife set", "air fryer accessories", "spice organizer", "cutting board", "ice maker",
                "electric knife sharpener", "spice rack organizer", "milk frother", "sous vide"],
    "car_accessories": ["car phone mount", "car vacuum", "seat organizer", "dash cam", "LED strip car",
                        "phone mount car", "car air freshener", "trunk organizer"],
    "pet_products": ["pet camera", "dog toy", "cat tree", "pet bed", "automatic feeder",
                     "cat water fountain", "dog camera", "pet grooming brush"],
    "beauty": ["LED mirror", "hair dryer", "facial steamer", "jade roller", "LED face mask"],
    "outdoor": ["portable hammock", "camping lantern", "solar charger", "insulated water bottle"],
    # --- POD / Print-on-Demand keywords ---
    "pod_apparel": ["funny t-shirt", "graphic tee", "cat shirt", "dog mom shirt", "gym hoodie",
                    "vintage tee", "anime shirt", "retro t-shirt", "dad joke shirt", "sarcastic tee",
                    "custom hoodie", "tie dye shirt", "motivational shirt", "nurse shirt", "teacher shirt"],
    "pod_home": ["funny mug", "cat mug", "dog mug", "coffee mug gift", "custom poster", "wall art print",
                 "canvas print", "motivational poster", "funny poster", "throw pillow custom",
                 "shower curtain funny", "custom blanket", "photo pillow", "pet portrait", "family portrait"],
    "pod_accessories": ["custom phone case", "sticker pack", "laptop sticker", "vinyl sticker", "tote bag custom",
                        "canvas tote bag", "custom hat", "embroidered hat", "pet bandana", "dog bandana",
                        "custom keychain", "acrylic keychain", "enamel pin", "button pin", "mouse pad custom"],
}

# --- BUG 7 fix: non-product post filtering ---
NON_PRODUCT_KEYWORDS = {
    "guide", "how to", "tips", "advice", "til", "eli5", "psa", "reminder",
    "rant", "discussion", "question", "help", "opinion", "review", "story",
    "news", "update", "meta", "rule", "mod", "announcement", "megathread",
    "weekly", "daily", "monthly", "did you know", "in 2022", "in 2023",
    "in 2024", "in 2025", "in 2026", "fact", "facts", "fart", "stolen",
    "published", "according to", "study", "research", "scientists",
    "percent", "million", "billion", "war", "military", "missile",
    "government", "president", "election", "politician", "lawsuit",
    "arrested", "convicted", "sentenced", "murdered", "died", "killed",
    "nestle", "nestlé", "official statement", "children's book",
    "mammal", "species", "animal", "planet", "universe", "history",
    "century", "ancient", "medieval", "documentary",
    "conference", "releases", "announces", "report", "scenes from",
    "breaking", "unveils", "launches",
    # Junk from expanded subreddits
    "photo by", "by me", "my collection", "just bought", "knife", "gun",
    "poop", "meme", "jumbotron", "cosplay", "tattoo", "artwork",
}

# News headline verbs: "Govee releases ...", "Apple announces ..."
_NEWS_HEADLINE_VERBS = {
    "releases", "announces", "unveils", "launches", "reports", "reveals",
    "introduces", "partners", "acquires", "expands", "confirms", "denies",
    "warns", "plans", "files", "sues", "settles", "recalls", "drops",
    "updates", "ships", "debuts", "ditches", "adds", "cuts", "hikes",
}

NON_PRODUCT_PREFIXES = (
    "I ", "We ", "My ", "This ", "When ", "Why ", "How ", "If ", "Just ",
    "Don't ", "Can't ", "Do ", "Does ", "Did ", "Has ", "Have ", "Was ",
    "Were ", "Is ", "Are ", "Am ", "What ", "Where ", "Who ", "Which ",
    "In ", "The ", "A ", "An ", "It ", "They ", "He ", "She ", "You ",
    "That ", "These ", "Those ", "There ", "Here ", "So ", "But ",
    "After ", "Before ", "During ", "Since ", "Because ", "Although ",
    "TIL ", "PSA ", "FYI ", "BREAKING", "UPDATE", "RIP ",
)

# --- BUG 10 fix: category detection keywords ---
CATEGORY_MATCH_KEYWORDS: dict[str, list[str]] = {
    "home_decor": ["lamp", "light", "decor", "shelf", "frame", "vase", "candle",
                    "pillow", "rug", "curtain", "mirror", "clock", "plant", "holder", "organizer"],
    "gadgets": ["phone", "charger", "cable", "earbuds", "headphone", "speaker", "camera",
                "projector", "drone", "ring", "watch", "tracker", "keyboard", "mouse", "hub", "adapter"],
    "fitness": ["yoga", "gym", "resistance", "band", "bottle", "mat", "roller",
                "massage", "exercise", "weights", "jump", "rope", "pull"],
    "kitchen": ["spice", "knife", "cutting", "board", "blender", "mixer", "pan", "pot",
                "coffee", "tea", "mug", "cup", "container", "storage", "rack"],
    "car_accessories": ["car", "mount", "phone", "dash", "seat", "cover", "led",
                        "strip", "charger", "vacuum", "cleaner"],
    "pet_products": ["dog", "cat", "pet", "leash", "collar", "bowl", "toy", "bed",
                     "crate", "carrier", "treat"],
    "beauty": ["skincare", "serum", "brush", "mirror", "makeup", "nail", "hair",
               "curler", "dryer"],
    "outdoor": ["camping", "tent", "hammock", "grill", "cooler", "backpack",
                "flashlight", "lantern"],
    "pod_apparel": ["shirt", "tee", "hoodie", "sweatshirt", "jersey", "tank"],
    "pod_home": ["mug", "poster", "canvas", "pillow", "blanket", "shower curtain", "tapestry", "coaster"],
    "pod_accessories": ["sticker", "tote", "phone case", "keychain", "pin", "badge", "hat", "cap",
                        "bandana", "mouse pad", "mousepad", "notebook"],
}


def _is_non_product_title(title: str) -> bool:
    """Return True if the title looks like a non-product post (BUG 7)."""
    # Too long to be a product name (40 chars max)
    if len(title) > 40:
        return True

    # Ends with a question mark (it's a question, not a product)
    if title.rstrip().endswith("?"):
        return True

    # Contains punctuation typical of sentences, not product names
    if "." in title or "," in title:
        return True

    # Product keyword must be 2-4 words
    word_count = len(title.split())
    if word_count < 2 or word_count > 4:
        return True

    title_lower = title.lower()

    # Contains non-product keywords
    for kw in NON_PRODUCT_KEYWORDS:
        if kw in title_lower:
            return True

    # Starts with common verb/pronoun prefixes (not product-like)
    for prefix in NON_PRODUCT_PREFIXES:
        if title.startswith(prefix):
            return True

    # News headline pattern: "Govee releases ...", "Apple announces ..."
    words = title.split()
    if len(words) >= 2 and words[0][0:1].isupper() and words[1].lower() in _NEWS_HEADLINE_VERBS:
        return True

    # Must contain at least one word from any product category to be considered
    # Use word-boundary matching to avoid "mat" matching inside "dermatologist"
    title_words = set(re.findall(r'\b[a-z]+\b', title_lower))
    all_product_words = set()
    for keywords in CATEGORY_MATCH_KEYWORDS.values():
        all_product_words.update(keywords)
    # Also accept common product-indicator words
    all_product_words.update({
        "tool", "device", "gadget", "accessory", "kit", "set", "pack",
        "machine", "appliance", "equipment", "gear", "supply", "case",
        "stand", "holder", "mount", "cover", "protector", "bag", "box",
        "bottle", "cup", "mug", "jar", "basket", "dispenser", "cleaner",
        "heater", "cooler", "fan", "purifier", "humidifier", "diffuser",
        "sensor", "detector", "alarm", "lock", "smart", "wireless",
        "bluetooth", "usb", "portable", "mini", "electric", "automatic",
        "solar", "rechargeable", "foldable", "adjustable", "waterproof",
        # POD product words
        "shirt", "tee", "hoodie", "sweatshirt", "poster", "sticker",
        "canvas", "pillow", "blanket", "tapestry", "coaster", "tote",
        "bandana", "keychain", "pin", "badge", "hat", "cap", "jersey",
        "mousepad", "notebook", "portrait", "print", "custom", "funny",
        "graphic", "vintage", "retro", "sarcastic", "motivational",
    })
    # Single-word keywords: match as whole words only
    # Multi-word keywords: match as substrings
    has_product_word = False
    for pw in all_product_words:
        if " " in pw:
            if pw in title_lower:
                has_product_word = True
                break
        else:
            if pw in title_words:
                has_product_word = True
                break
    if not has_product_word:
        return True

    return False


def _detect_category(title: str) -> str:
    """Match title keywords to a product category (BUG 10). Returns category or 'other'.

    Uses word-boundary matching so 'mat' doesn't match inside 'dermatologist'.
    """
    title_lower = title.lower()
    title_words = set(re.findall(r'\b[a-z]+\b', title_lower))
    best_category = "other"
    best_count = 0
    for category, keywords in CATEGORY_MATCH_KEYWORDS.items():
        count = 0
        for kw in keywords:
            if " " in kw:
                if kw in title_lower:
                    count += 1
            else:
                if kw in title_words:
                    count += 1
        if count > best_count:
            best_count = count
            best_category = category
    return best_category


# ============================================================
# Google Trends
# ============================================================

def scrape_google_trends() -> list[dict]:
    """Scrape Google Trends for trending searches and rising queries."""
    from pytrends.request import TrendReq

    log.info("Starting Google Trends scrape")
    signals: list[dict] = []

    try:
        pytrends = TrendReq(hl="en-US", tz=360)

        # trending_searches endpoint is broken upstream (404 from Google)
        # Skip it and rely on interest_over_time for seed keywords
        try:
            trending = pytrends.trending_searches(pn="united_states")
            for _, row in trending.head(20).iterrows():
                keyword = str(row[0]).strip()
                if not keyword:
                    continue
                signals.append({
                    "source": "google_trends",
                    "product_keyword": keyword,
                    "raw_signal_strength": 0.5,
                    "trend_velocity": "rising",
                    "signal_metadata": {"type": "trending_search"},
                })
                time.sleep(2)
        except Exception as e:
            log.warning(f"trending_searches unavailable (known issue): {e}")

        # Check interest over time for seed category keywords
        for category, keywords in CATEGORY_KEYWORDS.items():
            for batch_start in range(0, len(keywords), 5):  # pytrends max 5 keywords per request
                batch = keywords[batch_start : batch_start + 5]
                try:
                    pytrends.build_payload(batch, timeframe="now 7-d", geo="US")
                    interest = pytrends.interest_over_time()

                    if interest.empty:
                        time.sleep(60)
                        continue

                    for kw in batch:
                        if kw not in interest.columns:
                            continue
                        series = interest[kw].tolist()
                        if len(series) < 2:
                            continue

                        # Calculate velocity: compare last 3 points to first 3
                        recent = sum(series[-3:]) / 3 if len(series) >= 3 else series[-1]
                        earlier = sum(series[:3]) / 3 if len(series) >= 3 else series[0]
                        velocity = (recent - earlier) / max(earlier, 1)

                        if velocity > 0.1:  # At least 10% increase
                            strength = min(velocity / 2, 1.0)  # Normalize to 0-1
                            vel_label = "rising" if velocity < 1.0 else "peaking"
                            signals.append({
                                "source": "google_trends",
                                "product_keyword": kw,
                                "category": category,
                                "raw_signal_strength": strength,
                                "trend_velocity": vel_label,
                                "time_series_7d": series[-7:] if len(series) >= 7 else series,
                                "signal_metadata": {"velocity_pct": round(velocity * 100, 1)},
                            })

                    time.sleep(60)  # pytrends rate limit: 1 req / 60s
                except Exception as e:
                    log.warning(f"Google Trends batch {batch} failed: {e}")
                    time.sleep(60)

    except Exception as e:
        log.error(f"Google Trends scrape failed: {e}")
        log_system_event("scout-light", "scrape_failure", "error", f"Google Trends failed: {e}")

    return signals


# ============================================================
# Reddit
# ============================================================

REDDIT_FEEDS = [
    # --- Original product discovery ---
    ("shutupandtakemymoney", "hot"),
    ("gadgets", "rising"),
    ("BuyItForLife", "hot"),
    ("INEEEEDIT", "hot"),
    ("ProductPorn", "hot"),
    ("DesignPorn", "hot"),
    ("Entrepreneur", "rising"),
    ("AmazonFinds", "hot"),
    # --- POD / Design / "I want this on a shirt" ---
    ("DidntKnowIWantedThat", "hot"),
    ("ATBGE", "hot"),
    ("muglife", "hot"),
    ("coolguides", "hot"),
    ("graphic_design", "hot"),
    ("streetwear", "rising"),
    ("stickers", "hot"),
    ("EtsySellers", "rising"),
    ("PrintOnDemand", "hot"),
    ("FunnyAnimals", "hot"),
]


def scrape_reddit() -> list[dict]:
    """Monitor product-focused subreddits via public .json feeds (no API key needed)."""
    log.info("Starting Reddit scrape (public JSON feeds)")
    signals: list[dict] = []
    user_agent = os.getenv("REDDIT_USER_AGENT", "ghostmarket:v1.0")

    for sub_name, sort in REDDIT_FEEDS:
        url = f"https://www.reddit.com/r/{sub_name}/{sort}.json?limit=25"
        try:
            resp = httpx.get(url, headers={"User-Agent": user_agent}, timeout=15, follow_redirects=True)
            if resp.status_code == 429:
                log.warning(f"Reddit r/{sub_name}/{sort} rate limited (429), skipping")
                time.sleep(2)
                continue
            if resp.status_code != 200:
                log.warning(f"Reddit r/{sub_name}/{sort} returned {resp.status_code}, skipping")
                time.sleep(2)
                continue

            data = resp.json()
            posts = data.get("data", {}).get("children", [])
            log.info(f"Reddit r/{sub_name}/{sort}: {len(posts)} posts")

            for item in posts:
                post = item.get("data", {})
                score = post.get("score", 0)
                created_utc = post.get("created_utc", time.time())
                title = post.get("title", "")
                permalink = post.get("permalink", "")
                upvote_ratio = post.get("upvote_ratio", 0.5)
                num_comments = post.get("num_comments", 0)

                if not title:
                    continue

                # BUG 7 fix: filter out non-product posts
                if _is_non_product_title(title):
                    log.debug(f"Filtered non-product post: {title[:60]}")
                    continue

                # Calculate velocity: upvote rate (upvotes per hour since creation)
                age_hours = max((time.time() - created_utc) / 3600, 0.1)
                upvote_rate = score / age_hours

                # Lower threshold for POD/niche subs (smaller communities)
                _POD_SUBS = {"muglife", "stickers", "PrintOnDemand", "EtsySellers", "ATBGE",
                             "FunnyAnimals", "graphic_design", "streetwear", "DidntKnowIWantedThat"}
                min_rate = 5 if sub_name in _POD_SUBS else 50
                min_score = 25 if sub_name in _POD_SUBS else 500
                if upvote_rate < min_rate and score < min_score:
                    continue

                # Normalize strength: 100 upvotes/hr = 0.5, 500+ = 1.0
                strength = min(upvote_rate / 1000, 1.0)
                velocity = "rising" if age_hours < 6 else ("peaking" if age_hours < 24 else "declining")

                signals.append({
                    "source": "reddit",
                    "product_keyword": title[:40].strip(),
                    "raw_signal_strength": strength,
                    "trend_velocity": velocity,
                    "source_url": f"https://reddit.com{permalink}",
                    "avg_engagement_rate": upvote_ratio,
                    "signal_metadata": {
                        "subreddit": sub_name,
                        "sort": sort,
                        "score": score,
                        "upvote_rate": round(upvote_rate, 1),
                        "num_comments": num_comments,
                        "age_hours": round(age_hours, 1),
                    },
                })

            time.sleep(2)  # Rate limit between subreddit requests
        except Exception as e:
            log.warning(f"Reddit r/{sub_name}/{sort} failed: {e}")

    if not signals:
        log_system_event("scout-light", "scrape_failure", "warning", "Reddit returned no signals")

    return signals


# ============================================================
# Amazon Movers & Shakers
# ============================================================

AMAZON_CATEGORIES = [
    ("electronics", "https://www.amazon.com/gp/movers-and-shakers/electronics"),
    ("home_decor", "https://www.amazon.com/gp/movers-and-shakers/home-garden"),
    ("pet_products", "https://www.amazon.com/gp/movers-and-shakers/pet-supplies"),
    ("car_accessories", "https://www.amazon.com/gp/movers-and-shakers/automotive"),
    ("kitchen", "https://www.amazon.com/gp/movers-and-shakers/kitchen"),
    ("fitness", "https://www.amazon.com/gp/movers-and-shakers/sports-and-fitness"),
]

_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
]


def scrape_amazon_movers() -> list[dict]:
    """Scrape Amazon Movers & Shakers for trending products."""
    from bs4 import BeautifulSoup
    import random

    log.info("Starting Amazon Movers & Shakers scrape")
    signals: list[dict] = []

    for category, url in AMAZON_CATEGORIES:
        ua = random.choice(_USER_AGENTS)
        try:
            resp = httpx.get(url, headers={
                "User-Agent": ua,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            }, timeout=15, follow_redirects=True)

            if resp.status_code != 200:
                log.warning(f"Amazon {category}: HTTP {resp.status_code}, skipping")
                time.sleep(2)
                continue

            soup = BeautifulSoup(resp.text, "html.parser")

            # Extract product names from image alt text (most reliable on Amazon)
            faceouts = soup.select('.zg-grid-general-faceout')
            log.info(f"Amazon {category}: {len(faceouts)} items found")

            for item in faceouts[:10]:  # Max 10 per category
                # Get title from img alt (always present, full product name)
                img = item.select_one('img[alt]')
                if not img:
                    continue
                title = img.get('alt', '').strip()
                if not title or len(title) < 5:
                    continue

                # Extract the core product name: take first 3-4 meaningful words
                # Amazon titles are like "Brand Name Product Type Feature, Compatible with..."
                words = title.split()
                # Skip brand-like first word if it's all caps or has special chars
                clean_words = []
                for w in words[:6]:
                    if w.endswith(',') or w.endswith('，'):
                        clean_words.append(w.rstrip(',，'))
                        break
                    clean_words.append(w)
                title = ' '.join(clean_words[:4])  # Max 4 words

                # Apply existing product filter
                if _is_non_product_title(title):
                    continue

                # Extract percentage gain if available
                pct_el = item.select_one('.zg-percent-change, .a-color-success')
                pct_text = pct_el.get_text(strip=True) if pct_el else ""
                pct_gain = 0
                if pct_text:
                    pct_match = re.search(r"(\d+)", pct_text.replace(",", ""))
                    pct_gain = int(pct_match.group(1)) if pct_match else 0

                # Strength: higher % gain = stronger signal
                strength = min(pct_gain / 500, 1.0) if pct_gain > 0 else 0.4

                signals.append({
                    "source": "amazon",
                    "product_keyword": title,
                    "category": category,
                    "raw_signal_strength": strength,
                    "trend_velocity": "rising",
                    "source_url": url,
                    "signal_metadata": {
                        "amazon_category": category,
                        "pct_gain": pct_gain,
                    },
                })

            time.sleep(2)  # Rate limit between categories

        except Exception as e:
            log.warning(f"Amazon {category} failed: {e}")
            time.sleep(2)

    if signals:
        log.info(f"Amazon Movers: {len(signals)} product signals")
    else:
        log.info("Amazon Movers: no signals (may be blocked)")

    return signals


# ============================================================
# Opportunity Analysis (LLM-powered classification)
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
NIM_API_KEY = os.getenv("NIM_API_KEY", "")

# Quick heuristic: guess fulfillment type from keywords before LLM call
_POD_KEYWORDS = {"mug", "shirt", "tee", "hoodie", "poster", "case", "sticker",
                 "print", "custom", "design", "quote", "funny", "canvas", "pillow",
                 "blanket", "tapestry", "coaster", "tote", "bandana", "keychain",
                 "pin", "badge", "hat", "cap", "jersey", "tank", "sweatshirt",
                 "mousepad", "notebook", "portrait", "art print", "wall art"}
_DIGITAL_KEYWORDS = {"template", "preset", "wallpaper", "printable", "planner",
                     "ebook", "guide", "download", "digital", "svg", "font"}


def _guess_fulfillment(keyword: str) -> str:
    """Quick heuristic guess before LLM call."""
    words = set(keyword.lower().split())
    if words & _DIGITAL_KEYWORDS:
        return "digital"
    if words & _POD_KEYWORDS:
        return "pod"
    return "dropship"


def _call_analysis_llm(prompt: str) -> str | None:
    """Call Groq or NIM for opportunity analysis. Returns raw text or None."""
    headers_common = {"Content-Type": "application/json"}

    # Try Groq first
    if GROQ_API_KEY:
        try:
            resp = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={**headers_common, "Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": "You are an e-commerce product analyst. Respond with valid JSON only."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3, "max_tokens": 400,
                },
                timeout=20,
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception:
            pass

    # Fallback to NIM
    if NIM_API_KEY:
        try:
            resp = httpx.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers={**headers_common, "Authorization": f"Bearer {NIM_API_KEY}"},
                json={
                    "model": "meta/llama-3.3-70b-instruct",
                    "messages": [
                        {"role": "system", "content": "You are an e-commerce product analyst. Respond with valid JSON only."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3, "max_tokens": 400,
                },
                timeout=30,
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception:
            pass

    return None


def analyze_opportunity(keyword: str, source: str, subreddit: str | None, upvotes: int | None) -> dict | None:
    """Use LLM to turn a raw product signal into a structured opportunity.

    Returns dict with: product_name, fulfillment_type, content_potential,
    why_trending, target_audience, estimated_wholesale, estimated_retail,
    pod_design_concept. Returns None if LLM unavailable.
    """
    context = f"Source: {source}"
    if subreddit:
        context += f" (r/{subreddit})"
    if upvotes:
        context += f", {upvotes} upvotes"

    heuristic_type = _guess_fulfillment(keyword)

    prompt = f"""Analyze this trending product signal and classify the opportunity.

Signal: "{keyword}"
{context}
Heuristic guess: {heuristic_type}

Respond with ONLY valid JSON:
{{
  "product_name": "<clean 2-4 word product name>",
  "fulfillment_type": "dropship" | "pod" | "digital",
  "content_potential": <1-10, would this go viral on TikTok/Instagram?>,
  "why_trending": "<one sentence>",
  "target_audience": "<who buys this>",
  "estimated_wholesale": <number in USD, base/production cost>,
  "estimated_retail": <number in USD, typical online store price>,
  "pod_design_concept": "<if POD: describe the design concept, else null>"
}}

Rules:
- fulfillment_type "pod" if it's a design/art/quote/meme on a physical product (mug, shirt, poster, case)
- fulfillment_type "dropship" if it's a manufactured gadget/accessory with existing suppliers
- fulfillment_type "digital" if it's a downloadable/template/preset
- content_potential 8+ = visually stunning, demo-able, shareable
- content_potential 3-5 = functional but boring
- For POD: estimated_wholesale = Printful/Printify base cost ($5-25 depending on product)"""

    text = _call_analysis_llm(prompt)
    if not text:
        # LLM unavailable — return heuristic-only analysis
        return {
            "product_name": keyword,
            "fulfillment_type": heuristic_type,
            "content_potential": 5,
            "why_trending": "Unknown — LLM unavailable",
            "target_audience": "General consumers",
            "estimated_wholesale": None,
            "estimated_retail": None,
            "pod_design_concept": None,
        }

    try:
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        analysis = json.loads(text)
        # Ensure required fields
        analysis.setdefault("fulfillment_type", heuristic_type)
        analysis.setdefault("content_potential", 5)
        analysis.setdefault("product_name", keyword)
        log.info(
            f"  Opportunity: {analysis['product_name']} "
            f"[{analysis['fulfillment_type']}] "
            f"content={analysis['content_potential']}/10 "
            f"${analysis.get('estimated_wholesale', '?')}→${analysis.get('estimated_retail', '?')}"
        )
        return analysis
    except (json.JSONDecodeError, KeyError) as e:
        log.warning(f"  LLM analysis parse failed for '{keyword}': {e}")
        return {
            "product_name": keyword,
            "fulfillment_type": heuristic_type,
            "content_potential": 5,
            "why_trending": "Parse error",
            "target_audience": "General",
            "estimated_wholesale": None,
            "estimated_retail": None,
            "pod_design_concept": None,
        }


# ============================================================
# Signal processing
# ============================================================

def process_signals(signals: list[dict]) -> None:
    """Store signals in DB and create/update product entries."""
    log.info(f"Processing {len(signals)} signals")

    from shared.training import get_db
    stored = 0

    for signal in signals:
        keyword = signal["product_keyword"]

        # BUG 10 fix: detect category from title keywords if not already set
        if not signal.get("category"):
            signal["category"] = _detect_category(keyword)

        # Reject signals that don't match any known product category
        if signal["category"] == "other":
            log.debug(f"Rejected uncategorized signal: {keyword[:40]}")
            continue

        # BUG 8 fix: deduplicate by source_url + product_keyword
        source_url = signal.get("source_url")
        if source_url:
            with get_db() as conn:
                dup = conn.execute(
                    "SELECT id FROM trend_signals WHERE source_url = ? AND product_keyword = ? LIMIT 1",
                    [source_url, keyword],
                ).fetchone()
            if dup:
                log.debug(f"Skipping duplicate signal for {keyword}: {source_url}")
                continue

        # Fuzzy duplicate detection: if keyword shares 2+ words with existing product in same category, skip
        product = find_product_by_keyword(keyword)
        if not product:
            kw_words = set(keyword.lower().split())
            with get_db() as conn:
                existing = conn.execute(
                    "SELECT keyword FROM products WHERE category = ?",
                    [signal.get("category", "")],
                ).fetchall()
            is_fuzzy_dup = False
            for row in existing:
                existing_words = set(row["keyword"].lower().split())
                shared = kw_words & existing_words
                if len(shared) >= 2:
                    log.debug(f"Fuzzy duplicate: '{keyword}' matches '{row['keyword']}' ({shared})")
                    is_fuzzy_dup = True
                    break
            if is_fuzzy_dup:
                continue

        # LLM opportunity analysis (turns raw keyword into structured opportunity)
        meta = signal.get("signal_metadata") or {}
        subreddit = meta.get("subreddit")
        upvotes = meta.get("score")
        analysis = analyze_opportunity(keyword, signal["source"], subreddit, upvotes)

        if analysis:
            # Use the cleaned product name from LLM
            cleaned_name = analysis.get("product_name") or keyword
            if cleaned_name != keyword:
                # Check dedup again with cleaned name
                if find_product_by_keyword(cleaned_name):
                    log.debug(f"Duplicate after cleaning: '{keyword}' → '{cleaned_name}'")
                    continue
                keyword = cleaned_name
                signal["product_keyword"] = keyword

            # Store analysis in signal metadata
            signal.setdefault("signal_metadata", {})
            if isinstance(signal["signal_metadata"], dict):
                signal["signal_metadata"]["opportunity"] = analysis
            signal["fulfillment_type"] = analysis.get("fulfillment_type", "dropship")

            time.sleep(2)  # Rate limit between LLM calls

        if product:
            product_id = product["id"]
            if analysis and analysis.get("fulfillment_type") and not product.get("fulfillment_method"):
                # DB constraint: only 'dropship', 'pod', 'manual' — map 'digital' to 'pod'
                ft = analysis["fulfillment_type"]
                if ft == "digital":
                    ft = "pod"
                update_product(product_id, {"fulfillment_method": ft})
        else:
            product_id = create_product(keyword, signal.get("category"))
            if analysis and analysis.get("fulfillment_type"):
                ft = analysis["fulfillment_type"]
                if ft == "digital":
                    ft = "pod"
                update_product(product_id, {"fulfillment_method": ft})

        # Determine cross-source hits
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
            source_url=source_url,
            competing_ads_count=signal.get("competing_ads_count"),
            avg_engagement_rate=signal.get("avg_engagement_rate"),
            cross_source_hits=cross_source,
            signal_metadata=signal.get("signal_metadata"),
        )
        stored += 1

    log.info(f"Stored {stored}/{len(signals)} signals ({len(signals) - stored} skipped as duplicates)")


# ============================================================
# Main loop
# ============================================================

def run_cycle(source: str) -> None:
    """Run a single scrape cycle for the given source."""
    if source == "google_trends":
        signals = scrape_google_trends()
    elif source == "reddit":
        signals = scrape_reddit()
    elif source == "amazon":
        signals = scrape_amazon_movers()
    else:
        log.error(f"Unknown source: {source}")
        return

    if signals:
        process_signals(signals)
    else:
        log.info(f"No signals from {source}")
        log_system_event("scout-light", "scrape_failure", "warning", f"Empty response from {source}")


def main() -> None:
    """Run as a long-lived service with staggered cron-like scheduling."""
    log.info("Scout-Light starting")
    log_system_event("scout-light", "startup", "info", "Scout-Light agent started")

    # Run initial scrape on startup
    run_cycle("reddit")
    time.sleep(5)
    run_cycle("amazon")
    time.sleep(5)
    run_cycle("google_trends")

    # Then loop: Reddit every 30 min, Amazon every 30 min, Google Trends every 2 hours
    last_reddit = time.time()
    last_amazon = time.time()
    last_gtrends = time.time()

    while True:
        now = time.time()

        if now - last_reddit >= 1800:  # 30 min
            try:
                run_cycle("reddit")
            except Exception as e:
                log.error(f"Reddit cycle crashed: {e}")
                log_system_event("scout-light", "error", "error", f"Reddit cycle crash: {e}")
            last_reddit = time.time()

        if now - last_amazon >= 1800:  # 30 min
            try:
                run_cycle("amazon")
            except Exception as e:
                log.error(f"Amazon cycle crashed: {e}")
                log_system_event("scout-light", "error", "error", f"Amazon cycle crash: {e}")
            last_amazon = time.time()

        if now - last_gtrends >= 7200:  # 2 hours
            try:
                run_cycle("google_trends")
            except Exception as e:
                log.error(f"Google Trends cycle crashed: {e}")
                log_system_event("scout-light", "error", "error", f"Google Trends cycle crash: {e}")
            last_gtrends = time.time()

        time.sleep(60)  # Check every minute


if __name__ == "__main__":
    # If called with an argument, run single cycle
    if len(sys.argv) > 1:
        run_cycle(sys.argv[1])
    else:
        main()
