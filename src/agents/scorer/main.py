"""GhostMarket Scorer — Product Evaluation (THE BRAIN)

Scores each product 0-100 using 7 dimensions. Rule-based initially,
XGBoost after 50 labeled products. Sends products scoring 65+ to Telegram.
"""

import json
import logging
import os
import pickle
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.training import (
    get_db,
    get_labeled_product_count,
    log_system_event,
    log_training_event,
    update_product,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Scorer] %(message)s")
log = logging.getLogger("scorer")

MODELS_DIR = Path("/models")
XGBOOST_MODEL_PATH = MODELS_DIR / "xgboost_scorer.pkl"
XGBOOST_THRESHOLD = 50  # Minimum labeled products before using XGBoost

SCORE_THRESHOLD = 65
HIGH_PRIORITY_THRESHOLD = 90

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


def score_competition_level(signals: list[dict[str, Any]]) -> float:
    """Score based on competition (lower competition = higher score)."""
    ad_counts = [s.get("competing_ads_count", 0) for s in signals if s.get("competing_ads_count")]

    if not ad_counts:
        return 60.0  # Unknown competition = medium

    avg_ads = sum(ad_counts) / len(ad_counts)
    # 0-5 ads = 100 (blue ocean), 5-20 = 70, 20-50 = 50, 50+ = 20
    if avg_ads <= 5:
        return 100.0
    elif avg_ads <= 20:
        return 80.0 - (avg_ads - 5) * 0.67
    elif avg_ads <= 50:
        return 50.0 - (avg_ads - 20) * 1
    else:
        return max(20.0 - (avg_ads - 50) * 0.2, 5.0)


def score_fulfillment_ease(suppliers: list[dict[str, Any]], method: str | None) -> float:
    """Score based on shipping speed, warehouse location, supplier reliability."""
    if not suppliers:
        return 20.0

    best = [s for s in suppliers if s.get("is_best")]
    s = best[0] if best else suppliers[0]

    score = 40.0  # Base
    if s.get("warehouse") == "US":
        score += 30.0
    if (s.get("seller_rating") or 0) >= 4.5:
        score += 15.0
    if (s.get("shipping_days_max") or 30) <= 10:
        score += 15.0
    if method == "dropship":
        score += 10.0
    elif method == "pod":
        score += 5.0

    return min(score, 100.0)


def score_content_potential(keyword: str, signals: list[dict[str, Any]]) -> float:
    """Score based on visual appeal and content-friendliness.
    Heuristic based on keyword analysis and engagement signals.
    """
    score = 50.0

    # Products that demo well on video score higher
    visual_keywords = ["led", "lamp", "light", "glow", "color", "projector", "mirror", "art", "neon",
                       "sunset", "cloud", "aesthetic", "decor", "display"]
    kw_lower = keyword.lower()
    visual_matches = sum(1 for vk in visual_keywords if vk in kw_lower)
    score += visual_matches * 10

    # High engagement rate signals content-friendly
    for s in signals:
        eng = s.get("avg_engagement_rate", 0)
        if eng and eng > 0.05:
            score += 20

    return min(score, 100.0)


def score_cross_source_validation(signals: list[dict[str, Any]]) -> float:
    """More sources = more confidence. 3+ sources = strong buy."""
    sources = set(s.get("source") for s in signals)
    count = len(sources)

    if count >= 4:
        return 100.0
    elif count == 3:
        return 85.0
    elif count == 2:
        return 60.0
    else:
        return 30.0


def score_seasonality_fit(keyword: str, category: str | None) -> float:
    """Basic seasonality check. Evergreen products score higher."""
    # Seasonal keywords
    seasonal = {
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

    current_month = int(time.strftime("%m"))
    kw_lower = keyword.lower()

    for term, months in seasonal.items():
        if term in kw_lower:
            if current_month in months:
                return 90.0  # In season
            return 20.0  # Out of season

    return 70.0  # Evergreen = good


# ============================================================
# XGBoost Scoring (after 50 labeled products)
# ============================================================

def try_xgboost_score(features: dict[str, float]) -> float | None:
    """Attempt XGBoost prediction. Returns None if model not available."""
    labeled_count = get_labeled_product_count()
    if labeled_count < XGBOOST_THRESHOLD:
        return None

    if not XGBOOST_MODEL_PATH.exists():
        return None

    try:
        import numpy as np
        with open(XGBOOST_MODEL_PATH, "rb") as f:
            model = pickle.load(f)

        feature_names = sorted(features.keys())
        X = np.array([[features[f] for f in feature_names]])
        prediction = model.predict_proba(X)[0]

        # Convert win probability to 0-100 score
        # prediction[1] = P(win), prediction[0] = P(loss)
        win_prob = prediction[1] if len(prediction) > 1 else prediction[0]
        return round(win_prob * 100, 1)
    except Exception as e:
        log.warning(f"XGBoost scoring failed, falling back to rule-based: {e}")
        return None


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

    # Calculate all dimension scores
    breakdown = {
        "trend_velocity": round(score_trend_velocity(signals), 1),
        "margin_potential": round(score_margin_potential(suppliers), 1),
        "competition_level": round(score_competition_level(signals), 1),
        "fulfillment_ease": round(score_fulfillment_ease(suppliers, method), 1),
        "content_potential": round(score_content_potential(keyword, signals), 1),
        "cross_source_validation": round(score_cross_source_validation(signals), 1),
        "seasonality_fit": round(score_seasonality_fit(keyword, category), 1),
    }

    # Try XGBoost first
    xgb_score = try_xgboost_score(breakdown)
    model_version = "rule_v1"

    if xgb_score is not None:
        # XGBoost available — use it but keep rule-based as sanity check floor
        weights = load_weights()
        rule_score = sum(breakdown[dim] * weights[dim] for dim in weights)

        # Use XGBoost score but floor at 80% of rule-based score
        final_score = max(xgb_score, rule_score * 0.8)
        model_version = _get_model_version()
    else:
        # Rule-based scoring
        weights = load_weights()
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
