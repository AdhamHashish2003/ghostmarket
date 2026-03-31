"""
Fetch Google Trends data for product keywords using trendspy.
Rate limited: 1 request per 60 seconds.
Saves progress after each query — safe to interrupt and resume.

Usage:
    python3 backtest/fetch_trends.py          # fetch all, then merge
    python3 backtest/fetch_trends.py --merge   # just merge existing progress into features.csv
"""

import pandas as pd
import numpy as np
import json
import time
import sys
import os

PROGRESS_FILE = 'backtest/data/trends_progress.json'
FEATURES_FILE = 'backtest/data/features.csv'
RATE_LIMIT_SECONDS = 62  # 60 + 2s buffer


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}


def save_progress(data):
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def compute_trend_metrics(df_trend, keyword):
    """From a trendspy interest_over_time DataFrame, compute:
    - trend_velocity: slope of last 3 months (linear regression)
    - peak_to_current: current_interest / peak_interest
    - current_interest: mean of last 4 weeks
    """
    if df_trend is None or df_trend.empty:
        return {'trend_velocity': 0.0, 'peak_to_current': 0.0, 'current_interest': 0.0}

    col = keyword if keyword in df_trend.columns else df_trend.columns[0]
    values = df_trend[col].values.astype(float)

    # Current interest: mean of last 4 data points (weekly data = last 4 weeks)
    current_interest = float(np.mean(values[-4:])) if len(values) >= 4 else float(np.mean(values))

    # Peak to current ratio
    peak = float(np.max(values))
    peak_to_current = current_interest / peak if peak > 0 else 0.0

    # Trend velocity: slope of last ~13 weeks (3 months)
    last_3mo = values[-13:] if len(values) >= 13 else values
    if len(last_3mo) >= 2:
        x = np.arange(len(last_3mo))
        slope = float(np.polyfit(x, last_3mo, 1)[0])
    else:
        slope = 0.0

    return {
        'trend_velocity': round(slope, 4),
        'peak_to_current': round(peak_to_current, 4),
        'current_interest': round(current_interest, 2)
    }


def fetch_keyword(keyword, tr):
    """Fetch interest_over_time for a single keyword over last 2 years."""
    try:
        df = tr.interest_over_time([keyword], timeframe='today 24-m', geo='US')
        if df is not None and not df.empty and 'isPartial' in df.columns:
            df = df.drop(columns=['isPartial'])
        return df
    except Exception as e:
        print(f"  ERROR fetching '{keyword}': {e}")
        return None


def fetch_all():
    from trendspy import Trends

    df = pd.read_csv(FEATURES_FILE)
    keywords = sorted(df['trend_keyword'].unique())
    progress = load_progress()

    already_done = [k for k in keywords if k in progress]
    remaining = [k for k in keywords if k not in progress]

    print(f"Total keywords: {len(keywords)}")
    print(f"Already fetched: {len(already_done)}")
    print(f"Remaining: {len(remaining)}")
    est_minutes = len(remaining) * RATE_LIMIT_SECONDS / 60
    print(f"Estimated time: {est_minutes:.0f} minutes")
    print()

    if not remaining:
        print("All keywords already fetched. Run with --merge to apply.")
        return progress

    tr = Trends()

    for i, kw in enumerate(remaining):
        print(f"[{len(already_done)+i+1}/{len(keywords)}] Fetching '{kw}'...")

        df_trend = fetch_keyword(kw, tr)
        metrics = compute_trend_metrics(df_trend, kw)
        progress[kw] = metrics
        save_progress(progress)
        print(f"  velocity={metrics['trend_velocity']}, peak_ratio={metrics['peak_to_current']}, current={metrics['current_interest']}")

        if i < len(remaining) - 1:
            print(f"  Waiting {RATE_LIMIT_SECONDS}s (rate limit)...")
            time.sleep(RATE_LIMIT_SECONDS)

    print(f"\nDone. Fetched {len(remaining)} keywords.")
    return progress


def merge_trends():
    """Merge trend data from progress file into features.csv."""
    progress = load_progress()
    if not progress:
        print("No trend data found. Run fetch first.")
        return

    df = pd.read_csv(FEATURES_FILE)
    print(f"Loaded {len(df)} rows from features.csv")
    print(f"Trend data available for {len(progress)} keywords")

    df['trend_velocity'] = df['trend_keyword'].map(lambda k: progress.get(k, {}).get('trend_velocity', 0.0))
    df['peak_to_current'] = df['trend_keyword'].map(lambda k: progress.get(k, {}).get('peak_to_current', 0.0))
    df['current_interest'] = df['trend_keyword'].map(lambda k: progress.get(k, {}).get('current_interest', 0.0))

    df.to_csv(FEATURES_FILE, index=False)
    print(f"Merged trend features into {FEATURES_FILE}")

    # Stats
    print(f"\nTrend feature stats:")
    for col in ['trend_velocity', 'peak_to_current', 'current_interest']:
        print(f"  {col}: mean={df[col].mean():.3f}, std={df[col].std():.3f}, "
              f"min={df[col].min():.3f}, max={df[col].max():.3f}")


if __name__ == '__main__':
    if '--merge' in sys.argv:
        merge_trends()
    else:
        fetch_all()
        merge_trends()
