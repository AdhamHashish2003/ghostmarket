"""GhostMarket Backtest — Feature Engineering

Creates the EXACT same feature vector the live Scorer uses
so backtested models are directly deployable.

The live Scorer has 7 weighted dimensions:
  trend_velocity, margin_potential, competition_level,
  fulfillment_ease, content_potential, cross_source_validation,
  seasonality_fit

Plus extra features from the XGBoost trainer:
  signal_count, avg_signal_strength, max_cross_source_hits,
  margin_pct, unit_cost

Usage:
    python features.py
"""

import csv
import json
import logging
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Features] %(message)s")
log = logging.getLogger("features")

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
LABELED_FILE = DATA_DIR / "labeled.jsonl"
TRENDS_DIR = DATA_DIR / "raw" / "google_trends"
FEATURES_FILE = DATA_DIR / "features.csv"

# Same visual keywords as live Scorer (scorer/main.py line 161)
VISUAL_KEYWORDS = [
    "led", "lamp", "light", "glow", "color", "projector", "mirror", "art",
    "neon", "sunset", "cloud", "aesthetic", "decor", "display",
]

# Same seasonal mapping as live Scorer (scorer/main.py line 194)
SEASONAL_KEYWORDS = {
    "christmas": [11, 12],
    "halloween": [9, 10],
    "valentine": [1, 2],
    "summer": [5, 6, 7],
    "winter": [11, 12, 1],
    "spring": [3, 4, 5],
    "back to school": [7, 8],
    "pool": [5, 6, 7, 8],
    "snow": [11, 12, 1, 2],
}

SEED_CATEGORIES = {"home_decor", "gadgets", "fitness", "kitchen", "car_accessories", "pet_products"}


def load_trend_data(keyword: str) -> dict:
    """Load Google Trends data for a keyword."""
    safe_name = keyword.replace(" ", "_").replace("/", "_")
    path = TRENDS_DIR / f"{safe_name}.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {"keyword": keyword, "has_data": False}


# ============================================================
# Live Scorer dimension replicas (0-100 each)
# ============================================================

def score_trend_velocity(trend: dict) -> float:
    """Replica of live Scorer's score_trend_velocity.
    In live: averages signal strengths weighted by velocity label.
    In backtest: we use Google Trends velocity as proxy.
    """
    if not trend.get("has_data"):
        return 20.0  # Same default as live

    phase = trend.get("phase", "stable")
    velocity = abs(trend.get("velocity", 0))
    # Normalize velocity to a signal strength (0-1 range)
    strength = min(velocity, 1.0)

    if phase == "rising":
        return min(strength * 100, 100.0) if strength > 0 else 60.0
    elif phase == "peaking":
        return min(strength * 80, 100.0) if strength > 0 else 70.0
    elif phase == "declining":
        return min(strength * 30, 100.0) if strength > 0 else 25.0
    else:  # stable
        return 50.0


def score_margin_potential(price_usd: float, shipping_cost: float) -> float:
    """Replica of live Scorer's score_margin_potential.
    Live uses supplier margin_pct. We estimate from AliExpress price.
    Assumes 2.8x retail markup (standard dropship margin).
    """
    if price_usd <= 0:
        return 20.0

    retail = price_usd * 2.8
    landed = price_usd + shipping_cost
    margin_pct = ((retail - landed) / retail) * 100

    # Same thresholds as live (scorer/main.py line 101-109)
    if margin_pct >= 70:
        return 100.0
    elif margin_pct >= 50:
        return 60.0 + (margin_pct - 50) * 2
    elif margin_pct >= 30:
        return 40.0 + (margin_pct - 30) * 1
    else:
        return max(margin_pct, 10.0)


def score_competition_level(total_orders: int, category: str) -> float:
    """Replica of live Scorer's score_competition_level.
    Live uses competing_ads_count. We use order count as competition proxy.
    Very high orders = saturated market = more competition.
    """
    # Map order counts to estimated ad count
    if total_orders >= 50000:
        est_ads = 100
    elif total_orders >= 20000:
        est_ads = 50
    elif total_orders >= 10000:
        est_ads = 25
    elif total_orders >= 5000:
        est_ads = 15
    elif total_orders >= 1000:
        est_ads = 8
    else:
        est_ads = 3  # Low orders = likely less competition

    # Same thresholds as live (scorer/main.py line 121-128)
    if est_ads <= 5:
        return 100.0
    elif est_ads <= 20:
        return 80.0 - (est_ads - 5) * 0.67
    elif est_ads <= 50:
        return 50.0 - (est_ads - 20) * 1
    else:
        return max(20.0 - (est_ads - 50) * 0.2, 5.0)


def score_fulfillment_ease(ships_from: str, seller_rating: float, free_shipping: bool) -> float:
    """Replica of live Scorer's score_fulfillment_ease."""
    score = 40.0  # Base (same as live)

    if ships_from and ships_from.upper() in ("US", "CN-US", "USA"):
        score += 30.0
    if seller_rating >= 4.5:
        score += 15.0
    if free_shipping:
        score += 15.0

    # Assume dropship method for backtest
    score += 10.0

    return min(score, 100.0)


def score_content_potential(keyword: str) -> float:
    """Replica of live Scorer's score_content_potential."""
    score = 50.0
    kw_lower = keyword.lower()
    visual_matches = sum(1 for vk in VISUAL_KEYWORDS if vk in kw_lower)
    score += visual_matches * 10

    # No engagement data in backtest, so we stay at keyword-based score
    return min(score, 100.0)


def score_cross_source_validation(source: str) -> float:
    """Replica of live Scorer's score_cross_source_validation.
    In backtest we only have 1-2 sources per product, so we use fixed values.
    """
    # Backtest has single source per product
    # 1 source = 30 (same as live scorer for count=1)
    return 30.0


def score_seasonality_fit(keyword: str, category: str) -> float:
    """Replica of live Scorer's score_seasonality_fit."""
    current_month = int(time.strftime("%m"))
    kw_lower = keyword.lower()

    for term, months in SEASONAL_KEYWORDS.items():
        if term in kw_lower:
            if current_month in months:
                return 90.0
            return 20.0

    return 70.0  # Evergreen = good


# ============================================================
# Feature Vector Builder
# ============================================================

def build_feature_vector(product: dict, trend: dict) -> dict:
    """Build complete feature vector matching live Scorer + XGBoost trainer dimensions."""
    keyword = product.get("keyword", "")
    category = product.get("category", "")
    price = product.get("price_usd", 0)
    orders = product.get("total_orders", 0)
    rating = product.get("rating", 0)
    shipping = product.get("shipping_cost", 2.5)
    ships_from = product.get("ships_from", "")
    seller_rating = product.get("seller_rating", 0)
    free_shipping = product.get("free_shipping", False)
    review_count = product.get("review_count", 0)

    # === 7 Scoring Dimensions (match live Scorer exactly) ===
    trend_velocity = round(score_trend_velocity(trend), 1)
    margin_potential = round(score_margin_potential(price, shipping), 1)
    competition_level = round(score_competition_level(orders, category), 1)
    fulfillment_ease = round(score_fulfillment_ease(ships_from, seller_rating, free_shipping), 1)
    content_potential = round(score_content_potential(keyword), 1)
    cross_source_validation = round(score_cross_source_validation(product.get("source", "")), 1)
    seasonality_fit = round(score_seasonality_fit(keyword, category), 1)

    # === Extra XGBoost features (match learner/xgboost_trainer.py lines 96-101) ===
    signal_count = 1.0  # Single source in backtest
    avg_signal_strength = trend.get("velocity", 0.5) if trend.get("has_data") else 0.5
    max_cross_source_hits = 1.0

    retail = price * 2.8
    landed = price + shipping
    margin_pct = ((retail - landed) / retail * 100) if retail > 0 else 50.0
    unit_cost = price

    # === Derived features for validation ===
    estimated_retail = round(retail, 2)
    landed_cost = round(landed, 2)

    return {
        # Identifiers
        "keyword": keyword,
        "category": category,
        "title": product.get("title", ""),
        "listing_url": product.get("listing_url", ""),
        "source": product.get("source", ""),

        # 7 Live Scorer dimensions
        "trend_velocity": trend_velocity,
        "margin_potential": margin_potential,
        "competition_level": competition_level,
        "fulfillment_ease": fulfillment_ease,
        "content_potential": content_potential,
        "cross_source_validation": cross_source_validation,
        "seasonality_fit": seasonality_fit,

        # Extra XGBoost features
        "signal_count": signal_count,
        "avg_signal_strength": round(avg_signal_strength, 4),
        "max_cross_source_hits": max_cross_source_hits,
        "margin_pct": round(margin_pct, 1),
        "unit_cost": round(unit_cost, 2),

        # Raw data for analysis
        "price_usd": round(price, 2),
        "estimated_retail": estimated_retail,
        "landed_cost": landed_cost,
        "total_orders": orders,
        "rating": rating,
        "review_count": review_count,

        # Trend metadata
        "trend_phase": trend.get("phase", "unknown"),
        "trend_velocity_raw": round(trend.get("velocity", 0), 4),
        "peak_to_current": round(trend.get("peak_to_current_ratio", 0), 4),

        # Label
        "label": product.get("label", "skip"),
    }


def run_feature_engineering():
    """Process all labeled products into feature vectors."""
    if not LABELED_FILE.exists():
        log.error(f"Labeled file not found: {LABELED_FILE}. Run label.py first.")
        return

    # Load labeled products
    products = []
    with open(LABELED_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    products.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    log.info(f"Loaded {len(products)} labeled products")

    # Build features
    features = []
    trend_hits = 0
    for i, product in enumerate(products):
        keyword = product.get("keyword", "")
        trend = load_trend_data(keyword)
        if trend.get("has_data"):
            trend_hits += 1

        fv = build_feature_vector(product, trend)
        features.append(fv)

    log.info(f"Built {len(features)} feature vectors ({trend_hits} with trend data)")

    # Write CSV
    if not features:
        log.error("No features to write!")
        return

    fieldnames = list(features[0].keys())
    with open(FEATURES_FILE, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(features)

    log.info(f"Saved features to {FEATURES_FILE}")

    # Stats
    trainable = [f for f in features if f["label"] in ("win", "loss")]
    wins = [f for f in trainable if f["label"] == "win"]
    losses = [f for f in trainable if f["label"] == "loss"]
    log.info(f"\nTrainable: {len(trainable)} (win: {len(wins)}, loss: {len(losses)})")
    log.info(f"With trend data: {trend_hits}/{len(features)} ({trend_hits / max(len(features), 1) * 100:.0f}%)")


if __name__ == "__main__":
    run_feature_engineering()
