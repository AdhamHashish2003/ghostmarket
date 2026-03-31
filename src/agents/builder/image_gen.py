"""GhostMarket — Product Image Generation via Replicate API.

Generates e-commerce product hero images using SDXL Turbo (fast, cheap ~$0.003/image).
Returns base64-encoded PNG for inline embedding in landing pages.
"""

import base64
import json
import logging
import os
import sys
import time

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from shared.training import get_db, log_system_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ImageGen] %(message)s")
log = logging.getLogger("image_gen")

REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN", "")
IMAGES_DIR = os.path.join(os.getenv("DATA_DIR", "data"), "images")
os.makedirs(IMAGES_DIR, exist_ok=True)


def is_token_valid() -> bool:
    if not REPLICATE_API_TOKEN:
        return False
    if REPLICATE_API_TOKEN.startswith("your_"):
        return False
    return True


def generate_product_image(
    product_keyword: str,
    brand_name: str = "",
    brand_colors: list[str] | None = None,
    product_id: str = "",
) -> str | None:
    """Generate a product hero image via Replicate SDXL Turbo.

    Returns base64-encoded PNG string, or None if generation fails.
    """
    if not is_token_valid():
        log.warning("REPLICATE_API_TOKEN not set or placeholder — skipping image gen")
        return None

    # Build prompt
    color_hint = ""
    if brand_colors and len(brand_colors) > 0:
        primary = brand_colors[0] if brand_colors[0] != "#FFFFFF" else (brand_colors[1] if len(brand_colors) > 1 else "")
        if primary:
            color_hint = f", {primary} color accent"

    prompt = (
        f"A {product_keyword} product photo for online store listing, "
        f"studio lighting, clean white background, professional commercial photography, "
        f"high quality product shot, centered composition, sharp focus, 4k resolution{color_hint}"
    )
    negative_prompt = "text, watermark, logo, blurry, low quality, distorted, deformed, ugly, cartoon, illustration, drawing, nsfw, people, human, face, body"

    log.info(f"Generating image for: {product_keyword}")
    log.info(f"  Prompt: {prompt[:80]}...")

    try:
        # Use SDXL Turbo — fast (~5 seconds), cheap (~$0.003/image)
        resp = httpx.post(
            "https://api.replicate.com/v1/predictions",
            headers={
                "Authorization": f"Bearer {REPLICATE_API_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "version": "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
                "input": {
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "width": 768,
                    "height": 768,
                    "num_inference_steps": 4,
                    "guidance_scale": 1,
                },
            },
            timeout=30,
        )

        if resp.status_code != 201:
            log.error(f"Replicate API error: {resp.status_code} {resp.text[:200]}")
            return None

        prediction = resp.json()
        prediction_id = prediction.get("id")
        log.info(f"  Prediction started: {prediction_id}")

        # Poll for completion (max 60 seconds)
        for _ in range(30):
            time.sleep(2)
            poll = httpx.get(
                f"https://api.replicate.com/v1/predictions/{prediction_id}",
                headers={"Authorization": f"Bearer {REPLICATE_API_TOKEN}"},
                timeout=10,
            )
            status_data = poll.json()
            status = status_data.get("status")

            if status == "succeeded":
                output = status_data.get("output")
                if isinstance(output, list) and len(output) > 0:
                    image_url = output[0]
                elif isinstance(output, str):
                    image_url = output
                else:
                    log.error(f"  Unexpected output format: {output}")
                    return None

                # Download the image
                img_resp = httpx.get(image_url, timeout=30)
                if img_resp.status_code != 200:
                    log.error(f"  Failed to download image: {img_resp.status_code}")
                    return None

                img_bytes = img_resp.content
                b64 = base64.b64encode(img_bytes).decode("utf-8")

                # Save to disk too
                if product_id:
                    save_path = os.path.join(IMAGES_DIR, f"{product_id}_hero.png")
                    with open(save_path, "wb") as f:
                        f.write(img_bytes)
                    log.info(f"  Saved: {save_path} ({len(img_bytes)} bytes)")

                # Log to llm_calls
                try:
                    with get_db() as conn:
                        from shared.training import _uuid, _now_iso
                        conn.execute(
                            """INSERT INTO llm_calls (id, created_at, task_type, model_used,
                               input_prompt, output_text, tokens_in, tokens_out, latency_ms, product_id)
                               VALUES (?, ?, 'creative_direction', 'sdxl-turbo', ?, ?, 0, 0, ?, ?)""",
                            (_uuid(), _now_iso(), prompt, f"image:{len(img_bytes)}bytes",
                             int(status_data.get("metrics", {}).get("predict_time", 5) * 1000),
                             product_id or None),
                        )
                        conn.commit()
                except Exception as e:
                    log.warning(f"  Failed to log to llm_calls: {e}")

                log.info(f"  Image generated: {len(img_bytes)} bytes, base64: {len(b64)} chars")
                return b64

            elif status == "failed":
                error = status_data.get("error", "unknown")
                log.error(f"  Prediction failed: {error}")
                return None

            elif status == "canceled":
                log.error("  Prediction was canceled")
                return None

        log.error("  Prediction timed out after 60 seconds")
        return None

    except Exception as e:
        log.error(f"Image generation failed: {e}")
        return None


def get_placeholder_image_b64() -> str:
    """Return a minimal SVG placeholder as base64 data URI prefix.
    Used when Replicate is unavailable — shows a gradient rectangle.
    """
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1"/>
        <stop offset="100%" style="stop-color:#2d2d44;stop-opacity:1"/>
      </linearGradient></defs>
      <rect width="768" height="768" fill="url(#g)"/>
      <text x="384" y="400" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#666">Product Image</text>
    </svg>'''
    return base64.b64encode(svg.encode()).decode()


if __name__ == "__main__":
    # Test: generate image for a product
    import sys
    keyword = sys.argv[1] if len(sys.argv) > 1 else "LED cloud lamp"
    pid = sys.argv[2] if len(sys.argv) > 2 else "test"
    result = generate_product_image(keyword, product_id=pid)
    if result:
        print(f"Success: {len(result)} chars base64")
    else:
        print("Failed — check logs")
