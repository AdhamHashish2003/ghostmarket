"""GhostMarket Scout — Light Sources (runs on PC)

Google Trends via pytrends and Reddit via PRAW.
These are API-based (no browser needed), so they run on the primary PC.
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

import praw

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.training import (
    create_product,
    find_product_by_keyword,
    log_system_event,
    log_trend_signal,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Scout-Light] %(message)s")
log = logging.getLogger("scout-light")

SEED_CATEGORIES = ["home decor", "gadgets", "fitness", "kitchen", "car accessories", "pet products"]
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "home_decor": ["LED lamp", "wall art", "room decor", "aesthetic lamp", "cloud light", "neon sign", "sunset lamp"],
    "gadgets": ["phone mount", "wireless charger", "mini projector", "portable speaker", "smart ring"],
    "fitness": ["resistance bands", "massage gun", "yoga mat", "gym bag", "water bottle"],
    "kitchen": ["knife set", "air fryer accessories", "spice organizer", "cutting board", "ice maker"],
    "car_accessories": ["car phone mount", "car vacuum", "seat organizer", "dash cam", "LED strip car"],
    "pet_products": ["pet camera", "dog toy", "cat tree", "pet bed", "automatic feeder"],
}


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

        # Get trending searches (US)
        trending = pytrends.trending_searches(pn="united_states")
        for _, row in trending.head(20).iterrows():
            keyword = str(row[0]).strip()
            if not keyword:
                continue
            signals.append({
                "source": "google_trends",
                "product_keyword": keyword,
                "raw_signal_strength": 0.5,  # Base strength for trending
                "trend_velocity": "rising",
                "signal_metadata": {"type": "trending_search"},
            })
            time.sleep(2)  # Rate limit

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

def scrape_reddit() -> list[dict]:
    """Monitor product-focused subreddits for velocity signals."""
    log.info("Starting Reddit scrape")
    signals: list[dict] = []

    client_id = os.getenv("REDDIT_CLIENT_ID")
    client_secret = os.getenv("REDDIT_CLIENT_SECRET")
    user_agent = os.getenv("REDDIT_USER_AGENT", "ghostmarket:v1.0")

    if not client_id or not client_secret:
        log.warning("Reddit credentials not set, skipping")
        return signals

    try:
        reddit = praw.Reddit(
            client_id=client_id,
            client_secret=client_secret,
            user_agent=user_agent,
        )

        subreddits = ["shutupandtakemymoney", "BuyItForLife", "gadgets", "coolguides", "DidntKnowIWantedThat"]

        for sub_name in subreddits:
            try:
                subreddit = reddit.subreddit(sub_name)

                for post in subreddit.hot(limit=25):
                    # Calculate velocity: upvote rate (upvotes per hour since creation)
                    age_hours = max((time.time() - post.created_utc) / 3600, 0.1)
                    upvote_rate = post.score / age_hours

                    # Only surface posts with high velocity (>50 upvotes/hour) or high absolute score
                    if upvote_rate < 50 and post.score < 500:
                        continue

                    # Normalize strength: 100 upvotes/hr = 0.5, 500+ = 1.0
                    strength = min(upvote_rate / 1000, 1.0)
                    velocity = "rising" if age_hours < 6 else ("peaking" if age_hours < 24 else "declining")

                    signals.append({
                        "source": "reddit",
                        "product_keyword": post.title[:100],
                        "raw_signal_strength": strength,
                        "trend_velocity": velocity,
                        "source_url": f"https://reddit.com{post.permalink}",
                        "avg_engagement_rate": post.upvote_ratio,
                        "signal_metadata": {
                            "subreddit": sub_name,
                            "score": post.score,
                            "upvote_rate": round(upvote_rate, 1),
                            "num_comments": post.num_comments,
                            "age_hours": round(age_hours, 1),
                        },
                    })

                time.sleep(2)  # Be nice to Reddit API
            except Exception as e:
                log.warning(f"Reddit r/{sub_name} failed: {e}")

    except Exception as e:
        log.error(f"Reddit scrape failed: {e}")
        log_system_event("scout-light", "scrape_failure", "error", f"Reddit failed: {e}")

    return signals


# ============================================================
# Signal processing
# ============================================================

def process_signals(signals: list[dict]) -> None:
    """Store signals in DB and create/update product entries."""
    log.info(f"Processing {len(signals)} signals")

    for signal in signals:
        keyword = signal["product_keyword"]

        # Find or create product
        product = find_product_by_keyword(keyword)
        product_id = product["id"] if product else create_product(keyword, signal.get("category"))

        # Determine cross-source hits
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
# Main loop
# ============================================================

def run_cycle(source: str) -> None:
    """Run a single scrape cycle for the given source."""
    if source == "google_trends":
        signals = scrape_google_trends()
    elif source == "reddit":
        signals = scrape_reddit()
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
    run_cycle("google_trends")

    # Then loop: Reddit every 30 min, Google Trends every 2 hours
    last_reddit = time.time()
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
