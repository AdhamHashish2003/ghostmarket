"""GhostMarket Learner — XGBoost Scoring Model Retraining

Trains on labeled products to predict win/loss/breakeven.
Replaces rule-based scoring after 50 labeled products.
"""

import json
import logging
import os
import pickle
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report
from xgboost import XGBClassifier

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from shared.training import get_db, get_xgboost_training_data, get_labeled_product_count, get_source_hit_rates, log_training_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Learner-XGB] %(message)s")
log = logging.getLogger("learner-xgb")

PROJECT_ROOT = Path(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
MODELS_DIR = Path(os.getenv("MODELS_DIR", str(PROJECT_ROOT / "models")))
MODELS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_PATH = MODELS_DIR / "xgboost_scorer.pkl"
META_PATH = MODELS_DIR / "xgboost_meta.json"
WEIGHTS_PATH = MODELS_DIR / "scoring_weights.json"

FEATURE_COLUMNS = [
    "trend_velocity", "margin_potential", "competition_level",
    "fulfillment_ease", "content_potential", "cross_source_validation",
    "seasonality_fit",
]


def _get_current_version() -> str:
    if META_PATH.exists():
        with open(META_PATH) as f:
            return json.load(f).get("version", "rule_v1")
    return "rule_v1"


def _get_current_accuracy() -> float | None:
    if META_PATH.exists():
        with open(META_PATH) as f:
            return json.load(f).get("accuracy")
    return None


async def run_xgboost_training() -> dict[str, Any]:
    """Train XGBoost on labeled products. Returns training result."""
    labeled_count = get_labeled_product_count()
    log.info(f"XGBoost training: {labeled_count} labeled products available")

    if labeled_count < 50:
        msg = f"Not enough labeled data ({labeled_count}/50). Skipping XGBoost training."
        log.info(msg)
        return {"skipped": True, "reason": msg, "labeled_count": labeled_count}

    # Get training data
    raw_data = get_xgboost_training_data()
    if not raw_data:
        return {"skipped": True, "reason": "No training data from training_export view"}

    df = pd.DataFrame(raw_data)

    # Extract score breakdown features
    features: list[dict[str, float]] = []
    labels: list[str] = []

    for _, row in df.iterrows():
        breakdown = row.get("score_breakdown")
        if not breakdown:
            continue

        if isinstance(breakdown, str):
            try:
                breakdown = json.loads(breakdown)
            except json.JSONDecodeError:
                continue

        outcome = row.get("outcome_label")
        if outcome not in ("win", "loss", "breakeven"):
            continue

        feature_row: dict[str, float] = {}
        for col in FEATURE_COLUMNS:
            feature_row[col] = float(breakdown.get(col, 50.0))

        # Add extra features from the training export
        feature_row["signal_count"] = float(row.get("signal_count", 1))
        feature_row["avg_signal_strength"] = float(row.get("avg_signal_strength", 0.5))
        feature_row["max_cross_source_hits"] = float(row.get("max_cross_source_hits", 1))
        feature_row["margin_pct"] = float(row.get("margin_pct", 50.0) or 50.0)
        feature_row["unit_cost"] = float(row.get("unit_cost", 10.0) or 10.0)

        features.append(feature_row)
        labels.append(outcome)

    if len(features) < 50:
        return {"skipped": True, "reason": f"Only {len(features)} valid feature rows after filtering"}

    log.info(f"Training on {len(features)} samples")

    # Prepare data
    all_columns = sorted(features[0].keys())
    X = np.array([[f[c] for c in all_columns] for f in features])
    y = np.array([0 if l == "loss" else (1 if l == "win" else 2) for l in labels])

    # Train/test split (80/20)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    # Train XGBoost
    model = XGBClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        use_label_encoder=False,
        eval_metric="mlogloss",
        random_state=42,
    )
    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    new_accuracy = accuracy_score(y_test, y_pred)
    # Dynamically build target names from actual classes present
    unique_labels = sorted(set(y_test) | set(y_pred))
    label_map = {0: "loss", 1: "win", 2: "breakeven"}
    target_names = [label_map.get(l, str(l)) for l in unique_labels]
    report = classification_report(y_test, y_pred, target_names=target_names, output_dict=True)

    log.info(f"New model accuracy: {new_accuracy:.3f}")

    # Compare with current model
    current_version = _get_current_version()
    current_accuracy = _get_current_accuracy()
    deploy = True

    if current_accuracy is not None and new_accuracy < current_accuracy:
        log.warning(f"New model ({new_accuracy:.3f}) is WORSE than current ({current_accuracy:.3f}). Keeping current.")
        deploy = False

    # Feature importance
    importances = model.feature_importances_
    feature_importance = sorted(
        zip(all_columns, importances.tolist()),
        key=lambda x: x[1],
        reverse=True,
    )

    # Version the model
    version_num = 1
    if current_version.startswith("xgb_v"):
        try:
            version_num = int(current_version.split("v")[1]) + 1
        except (IndexError, ValueError):
            pass
    new_version = f"xgb_v{version_num}"

    if deploy:
        # Save model (backup old one first)
        if MODEL_PATH.exists():
            backup = MODELS_DIR / f"xgboost_scorer_{current_version}.pkl"
            MODEL_PATH.rename(backup)

        with open(MODEL_PATH, "wb") as f:
            pickle.dump(model, f)

        # Save metadata
        meta = {
            "version": new_version,
            "accuracy": new_accuracy,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "samples": len(features),
            "feature_columns": all_columns,
            "feature_importance": feature_importance,
        }
        with open(META_PATH, "w") as f:
            json.dump(meta, f, indent=2)

        # Update scoring weights based on feature importance
        # Map feature importance back to original 7 dimensions
        weight_updates: dict[str, float] = {}
        total_importance = sum(imp for name, imp in feature_importance if name in FEATURE_COLUMNS)
        if total_importance > 0:
            for name, imp in feature_importance:
                if name in FEATURE_COLUMNS:
                    weight_updates[name] = round(imp / total_importance, 3)

        if weight_updates:
            with open(WEIGHTS_PATH, "w") as f:
                json.dump(weight_updates, f, indent=2)

        log.info(f"Model {new_version} deployed. Accuracy: {new_accuracy:.3f}")

    # Log learning cycle
    cycle_number = 1
    with get_db() as conn:
        row = conn.execute(
            "SELECT MAX(cycle_number) as max_n FROM learning_cycles WHERE cycle_type = 'xgboost'"
        ).fetchone()
        if row and row["max_n"]:
            cycle_number = row["max_n"] + 1

    source_hit_rates = get_source_hit_rates()

    log_training_event("learning_cycles", {
        "cycle_number": cycle_number,
        "cycle_type": "xgboost",
        "model_version_before": current_version,
        "model_version_after": new_version if deploy else current_version,
        "accuracy_before": current_accuracy,
        "accuracy_after": new_accuracy,
        "training_samples": len(X_train),
        "holdout_samples": len(X_test),
        "feature_importance": json.dumps(feature_importance[:10]),
        "source_hit_rates": json.dumps(source_hit_rates),
        "deployed": 1 if deploy else 0,
    })

    return {
        "deployed": deploy,
        "version": new_version if deploy else current_version,
        "accuracy_before": current_accuracy,
        "accuracy_after": new_accuracy,
        "samples": len(features),
        "feature_importance": feature_importance[:5],
        "source_hit_rates": source_hit_rates,
        "classification_report": report,
    }
