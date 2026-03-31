import pandas as pd
import json
import os

def load_and_clean():
    """Load the AliExpress dataset, clean it, extract what we need."""

    df = pd.read_csv('backtest/data/raw/aliexpress/raw_csv.csv',
                      usecols=['title', 'price', 'sold', 'rating', 'category_name'],
                      on_bad_lines='skip')

    print(f"Loaded {len(df)} products")
    print(f"Columns: {list(df.columns)}")

    # Parse 'sold' column: "1487 sold" -> 1487, "0" -> 0
    df['orders'] = df['sold'].astype(str).str.replace(' sold', '', regex=False).str.strip()
    df['orders'] = pd.to_numeric(df['orders'], errors='coerce').fillna(0).astype(int)

    # Drop rows missing critical fields or with no reviews (rating=0)
    df = df.dropna(subset=['title', 'price'])
    df = df[df['rating'] > 0]
    df = df[df['orders'] > 0]
    df = df[df['price'] > 0]

    print(f"After cleaning (drop no-rating/no-orders): {len(df)} products")

    # Filter to our seed categories using keyword matching
    SEED_KEYWORDS = {
        'home_decor': ['lamp', 'light', 'led', 'neon', 'decor', 'shelf', 'wall art', 'candle', 'diffuser', 'projector'],
        'gadgets': ['phone', 'charger', 'bluetooth', 'usb', 'wireless', 'earbuds', 'speaker', 'keyboard', 'mouse', 'webcam', 'hub', 'stand'],
        'fitness': ['yoga', 'resistance', 'massage', 'gym', 'workout', 'exercise', 'weight', 'band', 'roller', 'jump rope'],
        'kitchen': ['fryer', 'knife', 'spice', 'chopper', 'coffee', 'ice', 'lunch box', 'cooker', 'press', 'slicer', 'baking'],
        'car_accessories': ['car', 'dash cam', 'vacuum', 'steering', 'tire', 'sun shade', 'seat', 'trunk'],
        'pet_products': ['pet', 'cat', 'dog', 'fish', 'bird', 'feeder', 'leash', 'collar', 'aquarium', 'litter']
    }

    def categorize(title):
        title_lower = str(title).lower()
        for cat, keywords in SEED_KEYWORDS.items():
            for kw in keywords:
                if kw in title_lower:
                    return cat
        return 'other'

    df['category'] = df['title'].apply(categorize)

    # Keep only products in our categories (drop 'other')
    df = df[df['category'] != 'other']
    print(f"After category filter: {len(df)} products")
    print(f"\nCategory distribution:")
    print(df['category'].value_counts())

    return df

def label_products(df):
    """Label products as win/loss based on orders + rating."""

    def label(row):
        orders = row['orders']
        rating = row['rating']

        if orders >= 5000 and rating >= 4.3:
            return 'win'
        if orders >= 10000:
            return 'win'
        if orders < 200 and rating < 4.0:
            return 'loss'
        if rating < 3.5 and orders < 1000:
            return 'loss'
        if orders < 100:
            return 'loss'
        return 'skip'

    df['label'] = df.apply(label, axis=1)

    print(f"\nLabel distribution:")
    print(df['label'].value_counts())

    # Keep only win + loss for training
    df_train = df[df['label'].isin(['win', 'loss'])]
    print(f"\nTraining set: {len(df_train)} products ({(df_train['label']=='win').sum()} wins, {(df_train['label']=='loss').sum()} losses)")

    return df_train

def extract_trend_keyword(title, category):
    """Extract a 2-3 word product keyword suitable for Google Trends lookup."""
    SEED_KEYWORDS = {
        'home_decor': ['lamp', 'light', 'led', 'neon', 'decor', 'shelf', 'wall art', 'candle', 'diffuser', 'projector'],
        'gadgets': ['phone', 'charger', 'bluetooth', 'usb', 'wireless', 'earbuds', 'speaker', 'keyboard', 'mouse', 'webcam', 'hub', 'stand'],
        'fitness': ['yoga', 'resistance', 'massage', 'gym', 'workout', 'exercise', 'weight', 'band', 'roller', 'jump rope'],
        'kitchen': ['fryer', 'knife', 'spice', 'chopper', 'coffee', 'ice', 'lunch box', 'cooker', 'press', 'slicer', 'baking'],
        'car_accessories': ['car', 'dash cam', 'vacuum', 'steering', 'tire', 'sun shade', 'seat', 'trunk'],
        'pet_products': ['pet', 'cat', 'dog', 'fish', 'bird', 'feeder', 'leash', 'collar', 'aquarium', 'litter']
    }
    title_lower = str(title).lower()
    for kw in SEED_KEYWORDS.get(category, []):
        if kw in title_lower:
            return kw
    return category


def engineer_features(df):
    """Create feature matrix — PRE-DECISION features only.

    REMOVED: orders, competition_proxy — these ARE the outcome (data leakage).
    KEPT: price, rating, margin, price_tier, category — observable before selling.
    ADDED: trend_keyword column for Google Trends lookup.
    Trend features (trend_velocity, peak_to_current, current_interest) will be
    populated by fetch_trends.py and merged back in.
    """

    features = pd.DataFrame()

    # --- Pre-decision features only ---
    features['price'] = df['price'].astype(float).values
    features['rating'] = df['rating'].astype(float).values
    features['estimated_retail'] = features['price'] * 2.8
    features['landed_cost'] = features['price'] + 2.5  # estimated shipping
    features['margin_pct'] = ((features['estimated_retail'] - features['landed_cost']) / features['estimated_retail'] * 100)
    features['price_tier'] = pd.cut(features['price'], bins=[0, 5, 15, 1000], labels=[0, 1, 2]).astype(float).fillna(2).astype(int)

    # Category one-hot
    for cat in ['home_decor', 'gadgets', 'fitness', 'kitchen', 'car_accessories', 'pet_products']:
        features[f'cat_{cat}'] = (df['category'].values == cat).astype(int)

    # Trend keyword for Google Trends lookup (populated by fetch_trends.py)
    features['trend_keyword'] = [extract_trend_keyword(t, c) for t, c in zip(df['title'].values, df['category'].values)]

    # Trend feature placeholders — filled after fetch_trends.py runs
    features['trend_velocity'] = 0.0
    features['peak_to_current'] = 0.0
    features['current_interest'] = 0.0

    # Metadata (not model features)
    features['label'] = df['label'].values
    features['title'] = df['title'].values
    features['category'] = df['category'].values

    return features

if __name__ == '__main__':
    os.makedirs('backtest/data', exist_ok=True)
    os.makedirs('backtest/models/xgboost_v0', exist_ok=True)
    os.makedirs('backtest/models/qlora_v0', exist_ok=True)
    os.makedirs('backtest/results', exist_ok=True)

    df = load_and_clean()
    df_labeled = label_products(df)
    features = engineer_features(df_labeled)

    features.to_csv('backtest/data/features.csv', index=False)
    print(f"\nSaved {len(features)} rows to backtest/data/features.csv")
