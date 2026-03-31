"""GhostMarket — Review Zone Evaluator

Re-evaluates products scoring 50-59 using Google Trends velocity data.
Promotes rising products, skips flat single-source ones, leaves the rest.

Decision matrix:
  trend rising + score >= 55     → promote to approved
  trend rising + score 50-54     → leave (needs more signal)
  trend flat/declining + 1 source → skip
  junk name (non-product)        → skip
  everything else                → leave as-is
"""

import logging
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from shared.training import get_db, log_system_event, update_product

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ReviewZone] %(message)s")
log = logging.getLogger("review-zone")

# Non-product keywords that slipped through filters
JUNK_PATTERNS = [
    "experiment", "asthma", "treating", "iodine", "clock",
    "thrifted", "conference", "announcement",
]


def check_trend_velocity(keyword: str) -> str:
    """Check Google Trends velocity for a keyword. Returns 'rising', 'flat', or 'declining'."""
    try:
        from trendspy import Trends
        tr = Trends()
        df = tr.interest_over_time([keyword], timeframe='today 3-m', geo='US')
        if df is None or df.empty:
            return 'unknown'

        col = keyword if keyword in df.columns else df.columns[0]
        values = df[col].values.astype(float)

        if len(values) < 4:
            return 'unknown'

        # Compare last 4 weeks to previous 4 weeks
        recent = float(sum(values[-4:])) / 4
        earlier = float(sum(values[-8:-4])) / 4 if len(values) >= 8 else float(sum(values[:4])) / 4

        if earlier == 0:
            return 'rising' if recent > 10 else 'flat'

        change = (recent - earlier) / earlier
        if change > 0.15:
            return 'rising'
        elif change < -0.15:
            return 'declining'
        return 'flat'
    except Exception as e:
        log.warning(f"Trend check failed for '{keyword}': {e}")
        return 'unknown'


def is_junk_product(keyword: str) -> bool:
    """Check if the product name is clearly junk that shouldn't be in the pipeline."""
    kw_lower = keyword.lower()
    return any(j in kw_lower for j in JUNK_PATTERNS)


def run_review():
    """Re-evaluate all 50-59 scored products."""
    log.info("=== REVIEW ZONE EVALUATION ===")

    with get_db() as conn:
        products = conn.execute("""
            SELECT p.id, p.keyword, p.score, p.category,
                   (SELECT COUNT(DISTINCT source) FROM trend_signals WHERE product_id = p.id) as source_count,
                   (SELECT GROUP_CONCAT(DISTINCT source) FROM trend_signals WHERE product_id = p.id) as sources
            FROM products p
            WHERE p.score >= 50 AND p.score < 60 AND p.stage = 'scored'
            ORDER BY p.score DESC
        """).fetchall()

    log.info(f"Found {len(products)} products in review zone (50-59, scored)")

    promoted = []
    skipped = []
    unchanged = []

    for p in products:
        p = dict(p)
        pid = p['id']
        keyword = p['keyword']
        score = p['score']
        sources = p['source_count']

        # 1. Skip obvious junk
        if is_junk_product(keyword):
            log.info(f"  SKIP (junk) {keyword} — score {score}")
            update_product(pid, {'stage': 'skipped'})
            log_system_event('review-zone', 'health_check', 'info',
                             f"Skipped junk product: {keyword} (score {score})")
            skipped.append(keyword)
            continue

        # 2. Check Google Trends
        log.info(f"  Checking trends: {keyword}...")
        velocity = check_trend_velocity(keyword)
        log.info(f"    Trend: {velocity}")

        # Rate limit
        time.sleep(62)

        # 3. Decision matrix
        if velocity == 'rising' and score >= 55:
            log.info(f"  PROMOTE {keyword} — rising trend, score {score}")
            update_product(pid, {'stage': 'approved', 'decision': 'recommend'})
            log_system_event('review-zone', 'health_check', 'info',
                             f"Promoted: {keyword} (score {score}, trend={velocity})")
            promoted.append(keyword)
        elif velocity in ('flat', 'declining') and sources <= 1:
            log.info(f"  SKIP {keyword} — {velocity} trend, single source")
            update_product(pid, {'stage': 'skipped'})
            log_system_event('review-zone', 'health_check', 'info',
                             f"Skipped: {keyword} (score {score}, trend={velocity}, sources={sources})")
            skipped.append(keyword)
        else:
            log.info(f"  HOLD {keyword} — trend={velocity}, sources={sources}")
            unchanged.append(keyword)

    # Summary
    log.info(f"\n=== REVIEW COMPLETE ===")
    log.info(f"Promoted: {len(promoted)}")
    log.info(f"Skipped: {len(skipped)}")
    log.info(f"Unchanged: {len(unchanged)}")

    # Send summary to Telegram
    token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    chat_id = os.getenv('TELEGRAM_CHAT_ID', '')
    if token and chat_id:
        import urllib.request, json
        msg = f"🔍 REVIEW ZONE EVALUATION\n━━━━━━━━━━━━━━━━━━━━━━\n\n"
        msg += f"Evaluated {len(products)} products (score 50-59)\n\n"
        if promoted:
            msg += f"✅ PROMOTED ({len(promoted)}):\n"
            for k in promoted:
                msg += f"  → {k}\n"
            msg += "\n"
        if skipped:
            msg += f"⏭️ SKIPPED ({len(skipped)}):\n"
            for k in skipped:
                msg += f"  → {k}\n"
            msg += "\n"
        if unchanged:
            msg += f"🔄 UNCHANGED ({len(unchanged)}):\n"
            for k in unchanged:
                msg += f"  → {k}\n"
        try:
            data = json.dumps({'chat_id': chat_id, 'text': msg}).encode()
            req = urllib.request.Request(
                f'https://api.telegram.org/bot{token}/sendMessage',
                data=data, headers={'Content-Type': 'application/json'}
            )
            urllib.request.urlopen(req)
            log.info("Summary sent to Telegram")
        except Exception as e:
            log.warning(f"Telegram send failed: {e}")

    return {'promoted': promoted, 'skipped': skipped, 'unchanged': unchanged}


if __name__ == '__main__':
    run_review()
