"""GhostMarket Image Processor — Background Removal + AI Scene Generation

Runs on ROG GPU. CarveKit for background removal, Replicate FLUX for
lifestyle/context images, Pillow for compositing and mockups.
"""

import asyncio
import io
import logging
import os
import sys
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.training import log_system_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ImageProc] %(message)s")
log = logging.getLogger("image-proc")

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
IMAGES_DIR = DATA_DIR / "images"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

REPLICATE_TOKEN = os.getenv("REPLICATE_API_TOKEN", "")

# CarveKit model (loaded lazily)
_carvekit_interface = None


def _get_carvekit():
    global _carvekit_interface
    if _carvekit_interface is None:
        try:
            from carvekit.api.high import HiInterface
            _carvekit_interface = HiInterface(
                object_type="object",
                batch_size_seg=1,
                batch_size_matting=1,
                device="cuda",
                seg_mask_size=640,
                matting_mask_size=2048,
                trimap_prob_threshold=231,
                trimap_dilation=30,
                trimap_erosion_iters=5,
                fp16=True,
            )
        except Exception as e:
            log.warning(f"CarveKit GPU init failed, trying CPU: {e}")
            from carvekit.api.high import HiInterface
            _carvekit_interface = HiInterface(
                object_type="object",
                batch_size_seg=1,
                batch_size_matting=1,
                device="cpu",
                seg_mask_size=640,
                matting_mask_size=2048,
            )
    return _carvekit_interface


# ============================================================
# Background Removal
# ============================================================

async def remove_background(image_path: str, output_path: str) -> str:
    """Remove background from product image using CarveKit."""
    log.info(f"Removing background: {image_path}")

    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        interface = _get_carvekit()
        images = await asyncio.to_thread(interface, [image_path])

        if images and len(images) > 0:
            result_image = images[0]
            await asyncio.to_thread(result_image.save, str(output))
            log.info(f"Background removed: {output}")
            return str(output)
        else:
            raise RuntimeError("CarveKit returned no results")

    except Exception as e:
        log.error(f"Background removal failed: {e}")
        log_system_event("image-proc", "error", "error", f"BG removal failed: {e}", {"image_path": image_path})
        raise


# ============================================================
# AI Image Generation (Replicate FLUX)
# ============================================================

async def generate_image(prompt: str, style: str = "product_lifestyle", output_path: str = "") -> str:
    """Generate a lifestyle/context image using Replicate FLUX."""
    log.info(f"Generating image: {prompt[:60]}...")

    if not REPLICATE_TOKEN:
        log.warning("REPLICATE_API_TOKEN not set, skipping image gen")
        raise RuntimeError("Replicate API token not configured")

    if not output_path:
        import uuid as _uuid
        output_path = str(IMAGES_DIR / f"gen_{_uuid.uuid4().hex[:8]}.png")

    # Style-specific prompt enhancement
    style_prefix = {
        "product_lifestyle": "Professional e-commerce product photo, lifestyle setting, clean background, high quality, ",
        "product_studio": "Studio product photography, white background, professional lighting, ",
        "product_scene": "Product in natural setting, lifestyle photography, warm lighting, ",
    }
    full_prompt = style_prefix.get(style, "") + prompt

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            # Create prediction
            resp = await client.post(
                "https://api.replicate.com/v1/predictions",
                headers={
                    "Authorization": f"Bearer {REPLICATE_TOKEN}",
                    "Content-Type": "application/json",
                },
                json={
                    "version": "black-forest-labs/flux-schnell",
                    "input": {
                        "prompt": full_prompt,
                        "num_outputs": 1,
                        "aspect_ratio": "1:1",
                        "output_format": "png",
                    },
                },
            )
            resp.raise_for_status()
            prediction = resp.json()

            # Poll for completion
            prediction_url = prediction["urls"]["get"]
            for _ in range(60):  # Max 60 attempts, 2s each = 2 min
                await asyncio.sleep(2)
                status_resp = await client.get(
                    prediction_url,
                    headers={"Authorization": f"Bearer {REPLICATE_TOKEN}"},
                )
                status_data = status_resp.json()

                if status_data["status"] == "succeeded":
                    image_url = status_data["output"][0]
                    # Download image
                    img_resp = await client.get(image_url)
                    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, "wb") as f:
                        f.write(img_resp.content)
                    log.info(f"Image generated: {output_path}")
                    return output_path

                if status_data["status"] == "failed":
                    raise RuntimeError(f"Replicate prediction failed: {status_data.get('error')}")

            raise RuntimeError("Replicate prediction timed out")

    except Exception as e:
        log.error(f"Image generation failed: {e}")
        log_system_event("image-proc", "error", "error", f"Image gen failed: {e}", {"prompt": prompt[:200]})
        raise


# ============================================================
# Composite / Mockup Generation (Pillow)
# ============================================================

async def create_product_composite(
    product_image_path: str,
    background_path: str,
    output_path: str,
    text_overlay: str = "",
) -> str:
    """Composite product (bg-removed) onto a generated background."""
    log.info(f"Creating composite: product={product_image_path}")

    def _composite() -> str:
        product_img = Image.open(product_image_path).convert("RGBA")
        background = Image.open(background_path).convert("RGBA")

        # Resize product to fit within 60% of background
        bg_w, bg_h = background.size
        max_product_w = int(bg_w * 0.6)
        max_product_h = int(bg_h * 0.6)

        prod_w, prod_h = product_img.size
        scale = min(max_product_w / prod_w, max_product_h / prod_h)
        new_size = (int(prod_w * scale), int(prod_h * scale))
        product_img = product_img.resize(new_size, Image.Resampling.LANCZOS)

        # Center product on background
        x = (bg_w - new_size[0]) // 2
        y = (bg_h - new_size[1]) // 2
        background.paste(product_img, (x, y), product_img)

        # Add text overlay if provided
        if text_overlay:
            from PIL import ImageDraw, ImageFont
            draw = ImageDraw.Draw(background)
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
            except OSError:
                font = ImageFont.load_default()
            # Draw text at bottom
            text_y = bg_h - 80
            draw.text((bg_w // 2, text_y), text_overlay, fill="white", font=font, anchor="mm")

        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        background.save(str(output), "PNG")
        return str(output)

    result = await asyncio.to_thread(_composite)
    log.info(f"Composite created: {result}")
    return result


# ============================================================
# Full Image Pipeline for a Product
# ============================================================

async def process_product_images(
    product_id: str,
    source_image_urls: list[str],
) -> dict[str, Any]:
    """Full image pipeline: download → bg remove → generate scene → composite."""
    product_dir = IMAGES_DIR / product_id
    product_dir.mkdir(parents=True, exist_ok=True)

    results: dict[str, Any] = {"original": [], "bg_removed": [], "generated": [], "composites": []}

    # 1. Download source images
    async with httpx.AsyncClient(timeout=30) as client:
        for i, url in enumerate(source_image_urls[:3]):
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    img_path = str(product_dir / f"original_{i}.png")
                    with open(img_path, "wb") as f:
                        f.write(resp.content)
                    results["original"].append(img_path)
            except Exception as e:
                log.warning(f"Failed to download image {url}: {e}")

    if not results["original"]:
        log.warning(f"No images downloaded for product {product_id}")
        return results

    # 2. Remove backgrounds
    for img_path in results["original"]:
        try:
            out_path = img_path.replace("original_", "nobg_")
            result = await remove_background(img_path, out_path)
            results["bg_removed"].append(result)
        except Exception as e:
            log.warning(f"BG removal failed for {img_path}: {e}")
            # Fallback: use original image
            results["bg_removed"].append(img_path)

    # 3. Generate lifestyle backgrounds (if Replicate available)
    if REPLICATE_TOKEN:
        scenes = ["on a modern desk in a cozy room", "being used by a person, lifestyle photo"]
        for scene in scenes[:1]:  # Limit to save API cost
            try:
                prompt = f"Empty scene: {scene}, photorealistic, no product visible"
                gen_path = str(product_dir / f"scene_{scenes.index(scene)}.png")
                result = await generate_image(prompt, "product_scene", gen_path)
                results["generated"].append(result)
            except Exception as e:
                log.warning(f"Scene generation failed: {e}")

    # 4. Create composites
    if results["bg_removed"] and results["generated"]:
        for bg_path in results["bg_removed"][:1]:
            for scene_path in results["generated"]:
                try:
                    comp_path = str(product_dir / f"composite_{len(results['composites'])}.png")
                    result = await create_product_composite(bg_path, scene_path, comp_path)
                    results["composites"].append(result)
                except Exception as e:
                    log.warning(f"Composite failed: {e}")

    log.info(
        f"Image pipeline complete for {product_id}: "
        f"{len(results['original'])} originals, "
        f"{len(results['bg_removed'])} bg-removed, "
        f"{len(results['generated'])} generated, "
        f"{len(results['composites'])} composites"
    )
    return results


# ============================================================
# Main service (standalone mode)
# ============================================================

async def main() -> None:
    log.info("Image Processor starting")
    log_system_event("image-proc", "startup", "info", "Image Processor agent started")

    # In production, this service is called via the ROG Worker FastAPI.
    # Standalone mode processes any queued image jobs from the DB.
    while True:
        # Check for products in 'building' stage that need images
        from shared.training import get_db
        with get_db() as conn:
            rows = conn.execute("""
                SELECT p.id, p.keyword FROM products p
                WHERE p.stage = 'building'
                  AND NOT EXISTS (
                    SELECT 1 FROM ad_creatives ac
                    WHERE ac.product_id = p.id AND ac.file_path IS NOT NULL
                  )
                LIMIT 3
            """).fetchall()

        for row in rows:
            try:
                # Get supplier images
                with get_db() as conn:
                    supplier = conn.execute(
                        "SELECT raw_data FROM suppliers WHERE product_id = ? AND is_best = 1 LIMIT 1",
                        [row["id"]],
                    ).fetchone()

                image_urls: list[str] = []
                if supplier and supplier["raw_data"]:
                    import json
                    raw = json.loads(supplier["raw_data"])
                    # Extract image URLs from raw supplier data
                    for key in ["imageUrl", "image_url", "productImage", "mainImage"]:
                        if key in raw and raw[key]:
                            image_urls.append(raw[key])

                if image_urls:
                    await process_product_images(row["id"], image_urls)
            except Exception as e:
                log.error(f"Image processing failed for {row['id']}: {e}")

        await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(main())
