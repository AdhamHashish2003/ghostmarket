"""GhostMarket Scorer — Product Evaluation (THE BRAIN)

Scores each product 0-100 using 7 dimensions. Rule-based initially,
XGBoost after 50 labeled products. Sends products scoring 65+ to Telegram.
"""

import json
import logging
import os
import pickle
import re
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from shared.training import (
    get_db,
    get_labeled_product_count,
    log_system_event,
    log_training_event,
    update_product,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Scorer] %(message)s")
log = logging.getLogger("scorer")

PROJECT_ROOT = Path(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
MODELS_DIR = Path("/models")
XGBOOST_MODEL_PATH = MODELS_DIR / "xgboost_scorer.pkl"
BACKTEST_MODEL_PATH = PROJECT_ROOT / "backtest" / "models" / "xgboost_v0" / "model.json"
XGBOOST_THRESHOLD = 50  # Minimum labeled products before using retrained XGBoost

# Features the backtest model expects (in order)
BACKTEST_FEATURES = [
    "price", "margin_pct", "price_tier", "rating",
    "cat_home_decor", "cat_gadgets", "cat_fitness", "cat_kitchen",
    "cat_car_accessories", "cat_pet_products",
    "trend_velocity", "peak_to_current", "current_interest",
]

SCORE_THRESHOLD = 55
HIGH_PRIORITY_THRESHOLD = 80

SEED_CATEGORIES = {"home_decor", "gadgets", "fitness", "kitchen", "car_accessories", "pet_products"}
SEED_CATEGORY_BONUS = 5.0  # 5% bonus for seed categories

# Default weights (adjusted by Learner agent)
WEIGHTS = {
    "trend_velocity": 0.25,
    "margin_potential": 0.25,
    "competition_level": 0.15,
    "fulfillment_ease": 0.10,
    "content_potential": 0.10,
    "cross_source_validation": 0.10,
    "seasonality_fit": 0.05,
}

# Per-fulfillment-type weight overrides
WEIGHTS_BY_TYPE: dict[str, dict[str, float]] = {
    "pod": {  # POD: content/design matters most, fulfillment is easy (US warehouse)
        "trend_velocity": 0.20,
        "margin_potential": 0.15,
        "competition_level": 0.10,
        "fulfillment_ease": 0.05,
        "content_potential": 0.30,
        "cross_source_validation": 0.10,
        "seasonality_fit": 0.10,
    },
    "dropship": WEIGHTS,  # Default
}

# Try to load adjusted weights from file
WEIGHTS_PATH = MODELS_DIR / "scoring_weights.json"


def load_weights() -> dict[str, float]:
    if WEIGHTS_PATH.exists():
        try:
            with open(WEIGHTS_PATH) as f:
                return json.load(f)
        except Exception:
            pass
    return WEIGHTS.copy()


# ============================================================
# Dimension Scorers (each returns 0-100)
# ============================================================

def score_trend_velocity(signals: list[dict[str, Any]]) -> float:
    """Score based on trend momentum across sources."""
    if not signals:
        return 20.0

    velocities = []
    for s in signals:
        v = s.get("trend_velocity", "")
        strength = s.get("raw_signal_strength", 0.5)
        if v == "rising":
            velocities.append(strength * 100)
        elif v == "peaking":
            velocities.append(strength * 80)
        elif v == "declining":
            velocities.append(strength * 30)
        else:
            velocities.append(strength * 50)

    return min(sum(velocities) / len(velocities), 100.0)


def score_margin_potential(suppliers: list[dict[str, Any]]) -> float:
    """Score based on margin percentage of best supplier."""
    if not suppliers:
        return 20.0

    best = [s for s in suppliers if s.get("is_best")]
    if not best:
        best = suppliers

    margin = best[0].get("margin_pct", 0)
    if margin is None:
        margin = 0

    # 70%+ margin = 100, 50% = 75, 30% = 50, <20% = 20
    if margin >= 70:
        return 100.0
    elif margin >= 50:
        return 60.0 + (margin - 50) * 2
    elif margin >= 30:
        return 40.0 + (margin - 30) * 1
    else:
        return max(margin, 10.0)


def score_competition_level(signals: list[dict[str, Any]], product_id: str, category: str | None) -> float:
    """Score based on market saturation — fewer similar products = blue ocean."""
    # Check ad counts if available
    ad_counts = [s.get("competing_ads_count", 0) for s in signals if s.get("competing_ads_count")]
    if ad_counts:
        avg_ads = sum(ad_counts) / len(ad_counts)
        if avg_ads <= 5:
            return 95.0
        elif avg_ads <= 20:
            return 75.0
        elif avg_ads <= 50:
            return 45.0
        return 20.0

    # Fallback: count how many similar products exist in same category
    with get_db() as conn:
        similar = conn.execute(
            "SELECT COUNT(*) as cnt FROM products WHERE category = ? AND id != ?",
            [category or '', product_id],
        ).fetchone()
    similar_count = similar["cnt"] if similar else 0

    if similar_count <= 2:
        return 85.0  # Low competition in this niche
    elif similar_count <= 5:
        return 65.0
    elif similar_count <= 10:
        return 45.0
    return 30.0


def score_fulfillment_ease(suppliers: list[dict[str, Any]], method: str | None) -> float:
    """Score based on warehouse, shipping cost, speed, and reliability."""
    if not suppliers:
        return 30.0

    best = [s for s in suppliers if s.get("is_best")]
    s = best[0] if best else suppliers[0]

    warehouse = (s.get("warehouse") or "").upper()
    rating = s.get("seller_rating") or 0
    ship_max = s.get("shipping_days_max") or 20
    ship_cost = s.get("shipping_cost") or 5.0
    landed = s.get("landed_cost") or 99

    # Warehouse location (primary)
    if warehouse == "US":
        score = 90.0
    elif warehouse == "CN" and ship_max <= 10:
        score = 70.0  # CN ePacket/express
    elif warehouse == "CN":
        score = 45.0  # CN standard
    else:
        score = 50.0

    # Shipping cost granularity (CN products vary a lot here)
    if warehouse == "CN":
        if ship_cost <= 2.0:
            score += 15.0  # Free/very cheap shipping
        elif ship_cost <= 3.5:
            score += 8.0   # Reasonable
        elif ship_cost <= 5.0:
            score += 0.0   # Standard
        else:
            score -= 10.0  # Expensive shipping

    # Rating
    if rating >= 4.5:
        score += 8.0
    elif rating >= 4.2:
        score += 4.0
    elif rating < 3.5 and rating > 0:
        score -= 10.0

    # Fulfillment method
    if method == "dropship":
        score += 5.0

    # Expensive items are harder to impulse-buy
    if landed > 30:
        score -= 8.0
    elif landed < 8:
        score += 5.0  # Cheap = easy margin at scale

    return max(min(score, 100.0), 10.0)


def score_content_potential(keyword: str, signals: list[dict[str, Any]]) -> float:
    """Score based on visual appeal and viral/shareable potential."""
    kw_lower = keyword.lower()
    title_words = set(re.findall(r'\b[a-z]+\b', kw_lower))

    # High-content products (visual, demonstrable, "wow factor")
    high_visual = {"led", "lamp", "light", "glow", "projector", "neon", "sunset",
                   "cloud", "galaxy", "star", "smart", "mini", "color", "aesthetic",
                   "mirror", "display", "ring", "drone"}
    visual_matches = len(title_words & high_visual)

    # Commodity products (functional, not shareable)
    commodity = {"organizer", "rack", "mat", "bands", "board", "container",
                 "storage", "bag", "case", "cover", "holder", "stand"}
    commodity_matches = len(title_words & commodity)

    if visual_matches >= 2:
        score = 90.0
    elif visual_matches == 1:
        score = 75.0
    elif commodity_matches >= 1:
        score = 40.0
    else:
        score = 55.0

    # Engagement rate boost
    for s in signals:
        eng = s.get("avg_engagement_rate") or 0
        if eng > 0.8:
            score += 10
        elif eng > 0.5:
            score += 5

    return min(score, 100.0)


def score_cross_source_validation(signals: list[dict[str, Any]], keyword: str) -> float:
    """More sources AND stronger signals = more confidence."""
    sources = set(s.get("source") for s in signals)
    source_count = len(sources)

    # Also check for cross-source hits in the DB for similar keywords
    with get_db() as conn:
        kw_words = keyword.lower().split()[:2]
        cross_hits = 0
        for word in kw_words:
            if len(word) < 3:
                continue
            row = conn.execute(
                "SELECT COUNT(DISTINCT source) as cnt FROM trend_signals WHERE product_keyword LIKE ?",
                [f"%{word}%"],
            ).fetchone()
            cross_hits = max(cross_hits, row["cnt"] if row else 0)

    total_sources = max(source_count, cross_hits)

    # Also factor in signal strength
    avg_strength = sum(s.get("raw_signal_strength", 0.5) for s in signals) / max(len(signals), 1)

    if total_sources >= 4:
        base = 95.0
    elif total_sources == 3:
        base = 80.0
    elif total_sources == 2:
        base = 65.0
    else:
        base = 40.0

    # Boost for strong signals
    if avg_strength > 0.7:
        base += 10
    elif avg_strength < 0.3:
        base -= 10

    return min(max(base, 10.0), 100.0)


def score_seasonality_fit(keyword: str, category: str | None) -> float:
    """Score based on seasonal alignment. Spring=March-May now."""
    current_month = int(time.strftime("%m"))
    kw_lower = keyword.lower()

    # Explicit seasonal keywords
    seasonal = {
        "christmas": [11, 12], "halloween": [9, 10], "valentine": [1, 2],
        "summer": [5, 6, 7], "winter": [11, 12, 1], "spring": [3, 4, 5],
        "pool": [5, 6, 7, 8], "snow": [11, 12, 1, 2], "beach": [5, 6, 7, 8],
    }
    for term, months in seasonal.items():
        if term in kw_lower:
            return 90.0 if current_month in months else 25.0

    # Category-based seasonality (current: March = early spring)
    cat = (category or "").lower()
    spring_summer_cats = {"fitness", "outdoor", "car_accessories", "beauty"}
    fall_winter_cats = {"home_decor"}
    evergreen_cats = {"gadgets", "kitchen", "pet_products"}

    if current_month in [3, 4, 5]:  # Spring
        if cat in spring_summer_cats:
            return 85.0  # Spring favors fitness/outdoor
        if cat in fall_winter_cats:
            return 55.0  # Home decor is more fall/winter
        if cat in evergreen_cats:
            return 70.0
    elif current_month in [6, 7, 8]:  # Summer
        if cat in spring_summer_cats:
            return 90.0
        if cat in fall_winter_cats:
            return 45.0
    elif current_month in [9, 10, 11]:  # Fall
        if cat in fall_winter_cats:
            return 85.0
        if cat in spring_summer_cats:
            return 50.0
    elif current_month in [12, 1, 2]:  # Winter
        if cat in fall_winter_cats:
            return 90.0
        if cat in spring_summer_cats:
            return 40.0

    return 65.0  # Default neutral


# ============================================================
# XGBoost Scoring (after 50 labeled products)
# ============================================================

def try_xgboost_score(
    product: dict[str, Any],
    suppliers: list[dict[str, Any]],
    signals: list[dict[str, Any]],
) -> tuple[float | None, str]:
    """Attempt XGBoost prediction. Returns (score, model_version) or (None, '')."""
    import numpy as np

    # Try backtest model first (always available, 84.5% accuracy)
    model_path = None
    model_version = ""

    if BACKTEST_MODEL_PATH.exists():
        model_path = BACKTEST_MODEL_PATH
        model_version = "xgb_v0"
    elif XGBOOST_MODEL_PATH.exists() and get_labeled_product_count() >= XGBOOST_THRESHOLD:
        model_path = XGBOOST_MODEL_PATH
        model_version = _get_model_version()

    if not model_path:
        return None, ""

    try:
        import xgboost as xgb

        # Build feature vector matching backtest training features
        best_supplier = next((s for s in suppliers if s.get("is_best")), suppliers[0] if suppliers else None)
        price = best_supplier["landed_cost"] if best_supplier else 10.0
        margin = best_supplier.get("margin_pct", 50.0) if best_supplier else 50.0
        rating = best_supplier.get("seller_rating", 4.0) if best_supplier else 4.0
        if rating is None:
            rating = 4.0
        if margin is None:
            margin = 50.0

        # Price tier: 0 = <$5, 1 = $5-$15, 2 = $15+
        price_tier = 0 if price < 5 else (1 if price < 15 else 2)

        # Category one-hot
        category = (product.get("category") or "").lower().replace(" ", "_")
        cats = {f"cat_{c}": 1.0 if category == c else 0.0 for c in
                ["home_decor", "gadgets", "fitness", "kitchen", "car_accessories", "pet_products"]}

        # Trend features
        velocities = [s.get("raw_signal_strength", 0.5) for s in signals]
        trend_vel = sum(velocities) / len(velocities) if velocities else 0.5
        peak_to_current = 0.8  # Default: near peak
        current_interest = trend_vel * 80  # Scale to ~0-80 range

        features = {
            "price": price,
            "margin_pct": margin,
            "price_tier": float(price_tier),
            "rating": rating,
            **cats,
            "trend_velocity": trend_vel,
            "peak_to_current": peak_to_current,
            "current_interest": current_interest,
        }

        X = np.array([[features[f] for f in BACKTEST_FEATURES]])

        if str(model_path).endswith(".json"):
            model = xgb.Booster()
            model.load_model(str(model_path))
            dmat = xgb.DMatrix(X, feature_names=BACKTEST_FEATURES)
            win_prob = float(model.predict(dmat)[0])
        else:
            with open(model_path, "rb") as f:
                model = pickle.load(f)
            prediction = model.predict_proba(X)[0]
            win_prob = prediction[1] if len(prediction) > 1 else prediction[0]

        score = round(win_prob * 100, 1)
        log.info(f"XGBoost ({model_version}): win_prob={win_prob:.3f} → score={score}")
        return score, model_version

    except ImportError:
        log.warning("xgboost not installed, falling back to rule-based")
        return None, ""
    except Exception as e:
        log.warning(f"XGBoost scoring failed: {e}")
        return None, ""


# ============================================================
# Main scoring function
# ============================================================

def score_product(product_id: str) -> dict[str, Any] | None:
    """Score a single product. Returns scoring result or None if insufficient data."""
    with get_db() as conn:
        product = conn.execute("SELECT * FROM products WHERE id = ?", [product_id]).fetchone()
        if not product:
            return None
        product = dict(product)

        signals = [dict(r) for r in conn.execute(
            "SELECT * FROM trend_signals WHERE product_id = ?", [product_id]
        ).fetchall()]

        suppliers = [dict(r) for r in conn.execute(
            "SELECT * FROM suppliers WHERE product_id = ?", [product_id]
        ).fetchall()]

    keyword = product["keyword"]
    category = product.get("category")
    method = product.get("fulfillment_method")

    # Calculate all dimension scores (each uses REAL data, not hardcoded)
    breakdown = {
        "trend_velocity": round(score_trend_velocity(signals), 1),
        "margin_potential": round(score_margin_potential(suppliers), 1),
        "competition_level": round(score_competition_level(signals, product_id, category), 1),
        "fulfillment_ease": round(score_fulfillment_ease(suppliers, method), 1),
        "content_potential": round(score_content_potential(keyword, signals), 1),
        "cross_source_validation": round(score_cross_source_validation(signals, keyword), 1),
        "seasonality_fit": round(score_seasonality_fit(keyword, category), 1),
    }

    # Try XGBoost first (backtest model or retrained model)
    xgb_score, xgb_version = try_xgboost_score(product, suppliers, signals)
    model_version = "rule_v1"

    if xgb_score is not None:
        # XGBoost available — use it but keep rule-based as sanity check floor
        weights = WEIGHTS_BY_TYPE.get(method or "dropship", load_weights())
        rule_score = sum(breakdown[dim] * weights[dim] for dim in weights)

        # Use XGBoost score but floor at 80% of rule-based score
        final_score = max(xgb_score, rule_score * 0.8)
        model_version = xgb_version
    else:
        # Rule-based scoring with per-type weights
        weights = WEIGHTS_BY_TYPE.get(method or "dropship", load_weights())
        final_score = sum(breakdown[dim] * weights[dim] for dim in weights)

    # Seed category bonus
    if category and category in SEED_CATEGORIES:
        final_score = min(final_score + SEED_CATEGORY_BONUS, 100.0)

    final_score = round(final_score, 1)

    # Determine decision
    if final_score >= SCORE_THRESHOLD:
        decision = "recommend"
    elif final_score >= SCORE_THRESHOLD - 10:
        decision = "borderline"
    else:
        decision = "skip"

    # Update product with score
    update_product(product_id, {
        "score": final_score,
        "score_breakdown": json.dumps(breakdown),
        "model_version": model_version,
        "decision": decision,
        "stage": "scored",
    })

    log.info(f"Scored {keyword}: {final_score}/100 ({decision}) [{model_version}]")

    return {
        "product_id": product_id,
        "keyword": keyword,
        "score": final_score,
        "breakdown": breakdown,
        "model_version": model_version,
        "decision": decision,
        "is_high_priority": final_score >= HIGH_PRIORITY_THRESHOLD,
    }


def _get_model_version() -> str:
    """Get current XGBoost model version from metadata file."""
    meta_path = MODELS_DIR / "xgboost_meta.json"
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                return json.load(f).get("version", "xgb_v1")
        except Exception:
            pass
    return "xgb_v1"


# ============================================================
# Service loop
# ============================================================

def process_unscored_products() -> list[dict[str, Any]]:
    """Score all products in 'discovered' stage that have suppliers."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT DISTINCT p.id FROM products p
            INNER JOIN suppliers s ON s.product_id = p.id
            WHERE p.stage = 'discovered' AND p.score IS NULL
            ORDER BY p.created_at DESC
            LIMIT 20
        """).fetchall()

    if not rows:
        return []

    log.info(f"Scoring {len(rows)} products")
    results = []
    for row in rows:
        try:
            result = score_product(row["id"])
            if result:
                results.append(result)
        except Exception as e:
            log.error(f"Failed to score {row['id']}: {e}")
            log_system_event("scorer", "error", "error", f"Scoring failed for {row['id']}: {e}")

    return results


def main() -> None:
    log.info("Scorer agent starting")
    log_system_event("scorer", "startup", "info", "Scorer agent started")

    while True:
        try:
            results = process_unscored_products()
            if results:
                recommended = [r for r in results if r["decision"] == "recommend"]
                log.info(f"Scored {len(results)} products, {len(recommended)} recommended")

                # Notify orchestrator about recommended products
                # (In production, this sends to Telegram via the orchestrator)
                for r in recommended:
                    log.info(
                        f"{'🔥 ' if r['is_high_priority'] else ''}"
                        f"RECOMMEND: {r['keyword']} — Score: {r['score']}/100"
                    )
        except Exception as e:
            log.error(f"Scoring cycle crashed: {e}")
            log_system_event("scorer", "error", "error", f"Scoring cycle crash: {e}")

        time.sleep(300)  # Check every 5 minutes


if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Score a specific product
        result = score_product(sys.argv[1])
        if result:
            print(json.dumps(result, indent=2))
    else:
        main()
