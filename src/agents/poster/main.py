"""GhostMarket Poster Agent — Publishes content_posts to Buffer API.

Runs every 30 minutes via PM2 cron. For each content post with:
  - buffer_post_id IS NULL (not yet posted)
  - scheduled_at <= now (due to be posted)
  - product is in live/tracking stage (don't post for un-deployed products)

Posts to Buffer via their create update API, stores the buffer_id back.

Safety:
  - Never posts without a valid BUFFER_ACCESS_TOKEN
  - Never double-posts (checks buffer_post_id before posting)
  - Rate limits to 1 post per 5 seconds to avoid Buffer API limits
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from shared.training import get_db, log_system_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Poster] %(message)s")
log = logging.getLogger("poster")

BUFFER_ACCESS_TOKEN = os.getenv("BUFFER_ACCESS_TOKEN", "")
BUFFER_PROFILE_IDS = {
    "instagram": os.getenv("BUFFER_PROFILE_ID_INSTAGRAM", ""),
    "tiktok": os.getenv("BUFFER_PROFILE_ID_TIKTOK", ""),
    "facebook": os.getenv("BUFFER_PROFILE_ID_FACEBOOK", ""),
}

RATE_LIMIT_SECONDS = 5


def is_token_valid() -> bool:
    """Check if the Buffer token is a real token, not a placeholder."""
    if not BUFFER_ACCESS_TOKEN:
        return False
    if BUFFER_ACCESS_TOKEN.startswith("your_"):
        return False
    return True


def verify_token() -> bool:
    """Verify the Buffer token works by hitting the user endpoint."""
    try:
        resp = httpx.get(
            f"https://api.bufferapp.com/1/user.json?access_token={BUFFER_ACCESS_TOKEN}",
            timeout=10,
        )
        if resp.status_code == 200:
            user = resp.json()
            log.info(f"Buffer connected: {user.get('name', 'unknown')}")
            return True
        log.warning(f"Buffer token invalid: HTTP {resp.status_code}")
        return False
    except Exception as e:
        log.warning(f"Buffer API unreachable: {e}")
        return False


def get_pending_posts() -> list[dict]:
    """Get content posts that are due and haven't been posted to Buffer yet."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    with get_db() as conn:
        rows = conn.execute("""
            SELECT cp.id, cp.product_id, cp.platform, cp.post_type, cp.copy_text,
                   cp.image_path, cp.scheduled_at, cp.utm_url,
                   p.keyword, p.stage, p.landing_page_url
            FROM content_posts cp
            JOIN products p ON p.id = cp.product_id
            WHERE cp.buffer_post_id IS NULL
              AND cp.scheduled_at <= ?
              AND p.stage IN ('live', 'tracking', 'building', 'approved')
            ORDER BY cp.scheduled_at ASC
            LIMIT 20
        """, (now,)).fetchall()
    return [dict(r) for r in rows]


def post_to_buffer(post: dict) -> str | None:
    """Post a single content post to Buffer. Returns the buffer update ID or None."""
    platform = post["platform"]
    profile_id = BUFFER_PROFILE_IDS.get(platform, "")

    if not profile_id or profile_id.startswith("your_"):
        log.warning(f"No Buffer profile ID for {platform} — skipping")
        return None

    # Build the post text
    text = post["copy_text"] or ""
    if post.get("utm_url"):
        text += f"\n\n{post['utm_url']}"
    elif post.get("landing_page_url"):
        text += f"\n\n{post['landing_page_url']}"

    payload = {
        "text": text,
        "profile_ids[]": profile_id,
        "access_token": BUFFER_ACCESS_TOKEN,
    }

    # If there's a scheduled time in the future, schedule it; otherwise post now
    if post.get("scheduled_at"):
        try:
            sched = datetime.fromisoformat(post["scheduled_at"].replace("Z", "+00:00"))
            if sched > datetime.now(timezone.utc):
                payload["scheduled_at"] = sched.strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            pass

    try:
        resp = httpx.post(
            "https://api.bufferapp.com/1/updates/create.json",
            data=payload,
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("success"):
                buffer_id = data.get("updates", [{}])[0].get("id", "")
                log.info(f"Posted to Buffer: {post['keyword']} / {post['post_type']} → {buffer_id}")
                return buffer_id
            else:
                log.warning(f"Buffer rejected post: {data.get('message', 'unknown error')}")
                return None
        else:
            log.warning(f"Buffer API error {resp.status_code}: {resp.text[:200]}")
            return None
    except Exception as e:
        log.error(f"Buffer post failed: {e}")
        return None


def mark_posted(post_id: str, buffer_id: str) -> None:
    """Update content_posts with the Buffer post ID."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    with get_db() as conn:
        conn.execute(
            "UPDATE content_posts SET buffer_post_id = ?, published_at = ? WHERE id = ?",
            (buffer_id, now, post_id),
        )
        conn.commit()


def run() -> None:
    """Main posting loop — process all pending posts."""
    if not is_token_valid():
        log.info("Buffer not configured (token is placeholder). Skipping post cycle.")
        log.info("Set BUFFER_ACCESS_TOKEN in .env to enable social posting.")
        return

    if not verify_token():
        log_system_event("poster", "api_failure", "warning", "Buffer token invalid or API unreachable")
        return

    posts = get_pending_posts()
    if not posts:
        log.info("No pending posts to publish.")
        return

    log.info(f"Found {len(posts)} pending posts to publish")
    posted = 0
    skipped = 0

    for post in posts:
        buffer_id = post_to_buffer(post)
        if buffer_id:
            mark_posted(post["id"], buffer_id)
            posted += 1
        else:
            skipped += 1

        # Rate limit
        time.sleep(RATE_LIMIT_SECONDS)

    log.info(f"Posting complete: {posted} published, {skipped} skipped")
    if posted > 0:
        log_system_event("poster", "health_check", "info",
                         f"Published {posted} posts to Buffer ({skipped} skipped)")


if __name__ == "__main__":
    run()
