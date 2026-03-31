"""
Generate QLoRA training pairs from labeled features.
NO order counts in input or output — the fine-tuned model must not
know future sales volume. Only pre-decision signals.
"""

import pandas as pd
import json
import random

df = pd.read_csv('backtest/data/features.csv')
pairs = []

for _, row in df.iterrows():
    # INPUT: only things visible BEFORE selling
    input_text = (
        f"Product: {str(row['title'])[:80]}. "
        f"Price: ${row['price']:.2f}. "
        f"Category: {row['category']}. "
        f"Rating: {row['rating']}/5. "
        f"Estimated margin: {row['margin_pct']:.0f}%."
    )

    # Add trend context if available
    if row.get('current_interest', 0) > 0:
        input_text += (
            f" Trend interest: {row['current_interest']:.0f}/100."
            f" Trend velocity: {row['trend_velocity']:+.2f}."
        )

    if row['label'] == 'win':
        output_text = "WINNER. "
        if row['rating'] >= 4.5:
            output_text += "High rating signals quality — low refund risk. "
        elif row['rating'] >= 4.0:
            output_text += "Solid rating indicates acceptable quality. "
        if row['margin_pct'] > 60:
            output_text += f"Margin at {row['margin_pct']:.0f}% gives room for ad spend. "
        elif row['margin_pct'] > 40:
            output_text += f"Margin at {row['margin_pct']:.0f}% is workable with efficient ads. "
        if row.get('trend_velocity', 0) > 0.5:
            output_text += "Rising trend signals growing demand. "
        if row.get('current_interest', 0) > 50:
            output_text += "Strong search interest confirms market demand. "
        output_text += "Priority: HIGH." if row['margin_pct'] > 60 and row['rating'] >= 4.5 else "Priority: MEDIUM."
    else:
        output_text = "SKIP. Weak signals. "
        if row['rating'] < 4.0:
            output_text += f"Rating {row['rating']}/5 suggests quality issues — expect returns. "
        if row['margin_pct'] < 40:
            output_text += f"Margin at {row['margin_pct']:.0f}% too thin for paid acquisition. "
        if row.get('trend_velocity', 0) < -0.5:
            output_text += "Declining trend signals fading demand. "
        if row.get('current_interest', 0) < 20 and row.get('current_interest', 0) > 0:
            output_text += "Low search interest — hard to find buyers. "
        output_text += "Priority: NONE."

    pairs.append({
        "instruction": "Evaluate this product opportunity. Winner or loser? Explain reasoning based on price, rating, margin, and trends.",
        "input": input_text,
        "output": output_text
    })

random.shuffle(pairs)
split = int(len(pairs) * 0.8)

with open('backtest/data/training_pairs.jsonl', 'w') as f:
    for p in pairs[:split]:
        f.write(json.dumps(p) + '\n')

with open('backtest/data/holdout_pairs.jsonl', 'w') as f:
    for p in pairs[split:]:
        f.write(json.dumps(p) + '\n')

print(f"Generated {split} training pairs + {len(pairs)-split} holdout pairs")
print(f"NO order counts in input or output — pre-decision signals only.")
