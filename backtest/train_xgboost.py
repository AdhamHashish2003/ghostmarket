"""
Train XGBoost on PRE-DECISION features only.
NO orders-derived features (that was data leakage).
Uses: price, rating, margin, price_tier, category, Google Trends signals.
"""

import xgboost as xgb
from sklearn.metrics import accuracy_score, classification_report
import pandas as pd
import json
import os

df = pd.read_csv('backtest/data/features.csv')
print(f"Training data: {len(df)} products")

# PRE-DECISION features only — nothing derived from order count
feature_cols = [
    # Price & margin (visible on supplier page)
    'price', 'margin_pct', 'price_tier',
    # Rating (visible on listing)
    'rating',
    # Category (chosen by us)
    'cat_home_decor', 'cat_gadgets', 'cat_fitness', 'cat_kitchen',
    'cat_car_accessories', 'cat_pet_products',
    # Google Trends (observable before launch)
    'trend_velocity', 'peak_to_current', 'current_interest',
]

X = df[feature_cols]
y = (df['label'] == 'win').astype(int)

# 80/20 split — use index order as time proxy (NOT random)
split = int(len(df) * 0.8)
X_train, X_test = X.iloc[:split], X.iloc[split:]
y_train, y_test = y.iloc[:split], y.iloc[split:]

print(f"Train: {len(X_train)}, Test: {len(X_test)}")
print(f"Train win rate: {y_train.mean():.1%}, Test win rate: {y_test.mean():.1%}")

# Use scale_pos_weight to handle heavy class imbalance (176K losses vs 1.3K wins)
neg_count = (y_train == 0).sum()
pos_count = (y_train == 1).sum()
scale = neg_count / pos_count if pos_count > 0 else 1
print(f"Class imbalance ratio: {scale:.1f}:1 — using scale_pos_weight={scale:.1f}")

model = xgb.XGBClassifier(
    n_estimators=200, max_depth=4, learning_rate=0.05,
    objective='binary:logistic', eval_metric='logloss',
    scale_pos_weight=scale, random_state=42,
    subsample=0.8, colsample_bytree=0.8,
)
model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=10)

y_pred = model.predict(X_test)
y_prob = model.predict_proba(X_test)[:, 1]

accuracy = accuracy_score(y_test, y_pred)

# Backtest at multiple thresholds
baseline = y_test.mean()
results_by_threshold = {}
for thresh in [0.50, 0.55, 0.60, 0.65, 0.70]:
    mask = y_prob >= thresh
    n_picked = int(mask.sum())
    if n_picked > 0:
        wr = float(y_test[mask].mean())
        edge = wr / baseline if baseline > 0 else 0
    else:
        wr, edge = 0.0, 0.0
    results_by_threshold[str(thresh)] = {
        'picked': n_picked, 'win_rate': round(wr, 4), 'edge': round(edge, 2)
    }
    print(f"  Threshold {thresh}: picked {n_picked}, win rate {wr:.1%}, edge {edge:.1f}x")

# Primary threshold for report
primary_thresh = 0.50
mask_primary = y_prob >= primary_thresh
model_rate = float(y_test[mask_primary].mean()) if mask_primary.sum() > 0 else 0
edge = model_rate / baseline if baseline > 0 else 0

importance = dict(sorted(
    zip(feature_cols, model.feature_importances_.tolist()),
    key=lambda x: x[1], reverse=True
))

results = {
    "accuracy": round(accuracy, 4),
    "baseline_win_rate": round(baseline, 4),
    "model_win_rate_at_50": round(model_rate, 4),
    "edge_multiplier": round(edge, 2),
    "products_picked": int(mask_primary.sum()),
    "total_test": len(y_test),
    "thresholds": results_by_threshold,
    "feature_importance": importance,
    "classification_report": classification_report(
        y_test, y_pred, target_names=["loss", "win"], output_dict=True
    ),
    "note": "v1 — fixed data leakage. No orders-derived features. Uses price, rating, margin, category, Google Trends."
}

os.makedirs('backtest/models/xgboost_v0', exist_ok=True)
os.makedirs('backtest/results', exist_ok=True)

model.save_model('backtest/models/xgboost_v0/model.json')
with open('backtest/results/backtest_report.json', 'w') as f:
    json.dump(results, f, indent=2)

print(f"\n{'='*50}")
print(f"BACKTEST RESULTS (v1 — leakage fixed)")
print(f"{'='*50}")
print(f"Accuracy: {accuracy:.1%}")
print(f"Baseline win rate: {baseline:.1%}")
print(f"Model win rate at 50+: {model_rate:.1%}")
print(f"Edge: {edge:.1f}x over random")
print(f"Products picked: {mask_primary.sum()}/{len(y_test)}")
print(f"\nTop features:")
for k, v in list(importance.items())[:5]:
    print(f"  {k}: {v:.3f}")
