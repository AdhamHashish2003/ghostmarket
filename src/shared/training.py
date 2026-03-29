"""GhostMarket — Shared Python training data utilities.

Functions to log training events to SQLite, query training data,
and format for XGBoost features / QLoRA JSONL export.
"""

import json
import sqlite3
import uuid as _uuid_mod
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

DB_PATH = Path("/data/ghostmarket.db")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _uuid() -> str:
    return str(_uuid_mod.uuid4())


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def log_training_event(table: str, data: dict[str, Any]) -> str:
    """Insert a row into any training table. Returns the new row ID."""
    row_id = data.get("id", _uuid())
    data["id"] = row_id
    if "created_at" not in data:
        data["created_at"] = _now_iso()
    if "updated_at" not in data:
        data["updated_at"] = _now_iso()

    columns = ", ".join(data.keys())
    placeholders = ", ".join(["?"] * len(data))

    with get_db() as conn:
        conn.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", list(data.values()))
        conn.commit()
    return row_id


def log_system_event(
    agent: str,
    event_type: str,
    severity: str,
    message: str,
    metadata: dict[str, Any] | None = None,
) -> str:
    return log_training_event("system_events", {
        "agent": agent,
        "event_type": event_type,
        "severity": severity,
        "message": message,
        "metadata": json.dumps(metadata) if metadata else None,
    })


def log_trend_signal(
    source: str,
    product_keyword: str,
    raw_signal_strength: float,
    category: str | None = None,
    product_id: str | None = None,
    trend_velocity: str | None = None,
    time_series_7d: list[float] | None = None,
    source_url: str | None = None,
    competing_ads_count: int | None = None,
    avg_engagement_rate: float | None = None,
    cross_source_hits: int = 1,
    signal_metadata: dict[str, Any] | None = None,
) -> str:
    return log_training_event("trend_signals", {
        "source": source,
        "product_keyword": product_keyword,
        "raw_signal_strength": raw_signal_strength,
        "category": category,
        "product_id": product_id,
        "trend_velocity": trend_velocity,
        "time_series_7d": json.dumps(time_series_7d) if time_series_7d else None,
        "source_url": source_url,
        "competing_ads_count": competing_ads_count,
        "avg_engagement_rate": avg_engagement_rate,
        "cross_source_hits": cross_source_hits,
        "signal_metadata": json.dumps(signal_metadata) if signal_metadata else None,
    })


def create_product(keyword: str, category: str | None = None) -> str:
    return log_training_event("products", {
        "keyword": keyword,
        "category": category,
        "stage": "discovered",
    })


def update_product(product_id: str, updates: dict[str, Any]) -> None:
    if not updates:
        return
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [product_id]
    with get_db() as conn:
        conn.execute(f"UPDATE products SET {set_clause} WHERE id = ?", values)
        conn.commit()


def get_product(product_id: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM products WHERE id = ?", [product_id]).fetchone()
        return dict(row) if row else None


def find_product_by_keyword(keyword: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM products WHERE keyword = ? ORDER BY created_at DESC LIMIT 1",
            [keyword],
        ).fetchone()
        return dict(row) if row else None


# ============================================================
# XGBoost feature extraction
# ============================================================

def get_xgboost_training_data() -> list[dict[str, Any]]:
    """Get all products with outcomes for XGBoost training."""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM training_export").fetchall()
        return [dict(r) for r in rows]


def get_labeled_product_count() -> int:
    with get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM products WHERE outcome_label IS NOT NULL"
        ).fetchone()
        return row["cnt"] if row else 0


# ============================================================
# QLoRA JSONL export
# ============================================================

def get_qlora_training_pairs() -> list[dict[str, str]]:
    """Get instruction-tuning pairs from llm_calls with labeled outcomes.

    - outcome_quality='keep' → use as-is
    - outcome_quality='flip' → the output_text has been replaced with corrected version
    - outcome_quality='discard' → skip
    """
    with get_db() as conn:
        rows = conn.execute("""
            SELECT task_type, input_prompt, output_text, eventual_outcome
            FROM llm_calls
            WHERE outcome_quality = 'keep'
               OR outcome_quality = 'flip'
            ORDER BY created_at
        """).fetchall()

    pairs: list[dict[str, str]] = []
    for row in rows:
        r = dict(row)
        instruction = _task_type_to_instruction(r["task_type"])
        pairs.append({
            "instruction": instruction,
            "input": r["input_prompt"],
            "output": r["output_text"],
        })
    return pairs


def export_qlora_jsonl(output_path: str) -> int:
    """Export QLoRA training data as JSONL file. Returns pair count."""
    pairs = get_qlora_training_pairs()
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for pair in pairs:
            f.write(json.dumps(pair) + "\n")
    return len(pairs)


def _task_type_to_instruction(task_type: str) -> str:
    mapping = {
        "product_evaluation": "Evaluate this product. Winner or loser? Detailed reasoning.",
        "ad_hook": "Write a TikTok/Instagram ad hook. Use winning patterns, avoid losing patterns.",
        "brand_naming": "Generate brand name and positioning.",
        "landing_page_copy": "Write conversion-optimized landing page copy.",
        "social_caption": "Write a social media caption for this product post.",
        "pricing_strategy": "Suggest optimal pricing strategy with reasoning.",
        "creative_direction": "Suggest creative direction for ad visuals.",
        "strategy_reflection": "Analyze recent launches and suggest strategy improvements.",
    }
    return mapping.get(task_type, f"Complete this {task_type} task.")


# ============================================================
# Outcome labeling
# ============================================================

def label_product_outcome(product_id: str, outcome: str) -> None:
    """Label a product outcome and cascade to all related training data."""
    with get_db() as conn:
        conn.execute("UPDATE products SET outcome_label = ? WHERE id = ?", [outcome, product_id])
        conn.execute("UPDATE trend_signals SET eventual_outcome = ? WHERE product_id = ?", [outcome, product_id])
        conn.execute("UPDATE suppliers SET eventual_outcome = ? WHERE product_id = ?", [outcome, product_id])
        conn.execute("UPDATE brand_kits SET eventual_outcome = ? WHERE product_id = ?", [outcome, product_id])
        conn.execute("UPDATE landing_pages SET eventual_outcome = ? WHERE product_id = ?", [outcome, product_id])
        conn.execute("UPDATE ad_creatives SET eventual_outcome = ? WHERE product_id = ?", [outcome, product_id])
        conn.execute("UPDATE content_posts SET eventual_outcome = ? WHERE product_id = ?", [outcome, product_id])
        conn.execute("UPDATE operator_decisions SET eventual_outcome = ? WHERE product_id = ?", [outcome, product_id])

        # Label llm_calls based on outcome
        if outcome == "win":
            conn.execute(
                "UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'keep' WHERE product_id = ?",
                [outcome, product_id],
            )
        elif outcome == "loss":
            conn.execute(
                "UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'flip' WHERE product_id = ? AND task_type = 'product_evaluation'",
                [outcome, product_id],
            )
            conn.execute(
                "UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'discard' WHERE product_id = ? AND task_type != 'product_evaluation'",
                [outcome, product_id],
            )
        elif outcome == "breakeven":
            conn.execute(
                "UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'keep' WHERE product_id = ? AND task_type = 'product_evaluation'",
                [outcome, product_id],
            )
            conn.execute(
                "UPDATE llm_calls SET eventual_outcome = ?, outcome_quality = 'discard' WHERE product_id = ? AND task_type != 'product_evaluation'",
                [outcome, product_id],
            )

        conn.commit()


def get_source_hit_rates() -> dict[str, float]:
    """Calculate win rate per trend source."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                ts.source,
                COUNT(*) as total,
                SUM(CASE WHEN ts.eventual_outcome = 'win' THEN 1 ELSE 0 END) as wins
            FROM trend_signals ts
            WHERE ts.eventual_outcome IS NOT NULL
            GROUP BY ts.source
        """).fetchall()
    return {r["source"]: r["wins"] / r["total"] if r["total"] > 0 else 0.0 for r in rows}
