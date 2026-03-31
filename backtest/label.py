"""GhostMarket Backtest — Product Labeling

Labels products as win/loss/skip based on order count and quality signals.
Only win + loss products are used for training.

Usage:
    python label.py
"""

import json
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Label] %(message)s")
log = logging.getLogger("label")

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PRODUCTS_FILE = DATA_DIR / "products.jsonl"
LABELED_FILE = DATA_DIR / "labeled.jsonl"
HOLDOUT_FILE = DATA_DIR / "holdout.jsonl"


def label_product(product: dict) -> str:
    """Label a product as win/loss/skip based on order count and rating.

    Logic:
      - WIN: High orders prove real market demand
      - LOSS: Low orders or bad ratings = no demand or quality issues
      - SKIP: Ambiguous — not useful for training
    """
    orders = product.get("total_orders", 0)
    rating = product.get("rating", 0)
    price = product.get("price_usd", 0)
    review_count = product.get("review_count", 0)
    source = product.get("source", "aliexpress")

    # Amazon uses review_count as proxy (orders ≈ reviews × 15 already done in scraper)
    # But also use raw review_count for additional signal
    if source == "amazon" and review_count > 0:
        if review_count >= 5000 and rating >= 4.3:
            return "win"
        if review_count >= 10000:
            return "win"
        if review_count < 100 and rating < 4.0:
            return "loss"
        if review_count < 50 and price > 20:
            return "loss"

    # === WIN conditions ===
    # Strong demand: high orders + decent quality
    if orders >= 5000 and rating >= 4.3:
        return "win"

    # Massive orders — proven regardless of rating
    if orders >= 10000:
        return "win"

    # Good orders + great rating = quality winner
    if orders >= 3000 and rating >= 4.6:
        return "win"

    # === LOSS conditions ===
    # Very low orders AND poor rating
    if orders < 200 and rating > 0 and rating < 4.0:
        return "loss"

    # Bad rating regardless (quality problem)
    if rating > 0 and rating < 3.5 and orders < 1000:
        return "loss"

    # Overpriced + no traction
    if orders < 100 and price > 20:
        return "loss"

    # Low orders on what appears to be an old listing
    if orders < 50 and rating > 0:
        return "loss"

    # Zero orders (no data or truly zero)
    if orders == 0 and rating == 0:
        return "skip"  # Can't tell — insufficient data

    # === SKIP: ambiguous middle ground ===
    if 200 <= orders <= 3000:
        return "skip"

    return "skip"


def run_labeling():
    """Read products.jsonl, label each, write to labeled.jsonl + holdout.jsonl."""
    if not PRODUCTS_FILE.exists():
        log.error(f"Products file not found: {PRODUCTS_FILE}")
        sys.exit(1)

    products = []
    with open(PRODUCTS_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    products.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    log.info(f"Loaded {len(products)} products")

    # Deduplicate by title (keep first occurrence)
    seen_titles = set()
    unique_products = []
    for p in products:
        title = p.get("title", "").strip().lower()
        if title and title not in seen_titles:
            seen_titles.add(title)
            unique_products.append(p)

    log.info(f"After dedup: {len(unique_products)} unique products")

    # Label
    stats = {"win": 0, "loss": 0, "skip": 0}
    labeled = []
    for p in unique_products:
        lbl = label_product(p)
        p["label"] = lbl
        stats[lbl] += 1
        labeled.append(p)

    log.info(f"\nLabel distribution:")
    log.info(f"  WIN:  {stats['win']} ({stats['win'] / len(labeled) * 100:.1f}%)")
    log.info(f"  LOSS: {stats['loss']} ({stats['loss'] / len(labeled) * 100:.1f}%)")
    log.info(f"  SKIP: {stats['skip']} ({stats['skip'] / len(labeled) * 100:.1f}%)")

    trainable = [p for p in labeled if p["label"] in ("win", "loss")]
    log.info(f"\nTrainable (win + loss): {len(trainable)}")

    if len(trainable) < 500:
        log.warning(f"WARNING: Only {len(trainable)} trainable products. Target is 500+.")
        log.warning("Consider: scraping more categories, lowering thresholds, or using Amazon fallback.")

    # Time-ordered split: 80% train, 20% holdout
    # Use scraped_at as time proxy (earlier scraped = earlier in order)
    trainable.sort(key=lambda p: p.get("scraped_at", ""))
    split_idx = int(len(trainable) * 0.8)
    train_set = trainable[:split_idx]
    holdout_set = trainable[split_idx:]

    # Write all labeled products
    with open(LABELED_FILE, "w") as f:
        for p in labeled:
            f.write(json.dumps(p) + "\n")

    # Write holdout separately
    with open(HOLDOUT_FILE, "w") as f:
        for p in holdout_set:
            f.write(json.dumps(p) + "\n")

    log.info(f"\nSaved {len(labeled)} labeled products to {LABELED_FILE}")
    log.info(f"Saved {len(holdout_set)} holdout products to {HOLDOUT_FILE}")
    log.info(f"Train: {len(train_set)} | Holdout: {len(holdout_set)}")


if __name__ == "__main__":
    run_labeling()
