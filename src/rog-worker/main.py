"""GhostMarket — ROG Worker (FastAPI)

Runs on ASUS ROG. Accepts heavy-compute jobs from the PC orchestrator:
scraping (Playwright), background removal (CarveKit), image gen (Replicate/SDXL),
model evaluation (Ollama), fine-tuning (unsloth), and Claude Code execution.
"""

import asyncio
import logging
import os
import subprocess
from typing import Any

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ROG] %(message)s")
log = logging.getLogger("rog-worker")

app = FastAPI(title="GhostMarket ROG Worker", version="1.0.0")

CALLBACK_URL = os.getenv("ORCHESTRATOR_CALLBACK_URL", "http://localhost:4000/callback")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://model-server:11434")


class ScrapeJob(BaseModel):
    job_id: str
    source: str  # tiktok_cc, amazon, aliexpress
    params: dict[str, Any] = {}
    callback_url: str = ""


class ImageJob(BaseModel):
    job_id: str
    image_path: str
    output_path: str
    callback_url: str = ""


class ImageGenJob(BaseModel):
    job_id: str
    prompt: str
    style: str = "product_lifestyle"
    output_path: str = ""
    callback_url: str = ""


class EvalJob(BaseModel):
    job_id: str
    prompt: str
    system_prompt: str = "You are a helpful e-commerce analysis assistant."
    temperature: float = 0.7
    max_tokens: int = 2048


class TrainJob(BaseModel):
    job_id: str
    train_type: str  # "xgboost" or "qlora"
    data_path: str = ""
    callback_url: str = ""


class ClaudeCodeJob(BaseModel):
    job_id: str
    prompt: str
    project_path: str = "/app/ghostmarket"
    callback_url: str = ""


async def send_callback(url: str, job_id: str, job_type: str, success: bool, data: Any = None, error: str | None = None) -> None:
    target = url or CALLBACK_URL
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(target, json={
                "job_id": job_id,
                "job_type": job_type,
                "success": success,
                "data": data,
                "error": error,
            })
    except Exception as e:
        log.error(f"Callback failed for job {job_id}: {e}")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "rog-worker"}


@app.post("/scrape")
async def scrape(job: ScrapeJob) -> dict[str, str]:
    log.info(f"Scrape job {job.job_id}: source={job.source}")
    # Actual scraping logic will be implemented in Step 2
    asyncio.create_task(_run_scrape(job))
    return {"status": "accepted", "job_id": job.job_id}


async def _run_scrape(job: ScrapeJob) -> None:
    try:
        # Import the appropriate scraper based on source
        if job.source == "tiktok_cc":
            from scrapers.tiktok import scrape_tiktok
            results = await scrape_tiktok(job.params)
        elif job.source == "amazon":
            from scrapers.amazon import scrape_amazon
            results = await scrape_amazon(job.params)
        elif job.source == "aliexpress":
            from scrapers.aliexpress import scrape_aliexpress
            results = await scrape_aliexpress(job.params)
        else:
            raise ValueError(f"Unknown source: {job.source}")
        await send_callback(job.callback_url, job.job_id, "scrape", True, results)
    except Exception as e:
        log.error(f"Scrape job {job.job_id} failed: {e}")
        await send_callback(job.callback_url, job.job_id, "scrape", False, error=str(e))


@app.post("/remove-bg")
async def remove_background(job: ImageJob) -> dict[str, str]:
    log.info(f"BG removal job {job.job_id}: {job.image_path}")
    asyncio.create_task(_run_bg_removal(job))
    return {"status": "accepted", "job_id": job.job_id}


async def _run_bg_removal(job: ImageJob) -> None:
    try:
        from image_pipeline import remove_background as do_remove
        result_path = await do_remove(job.image_path, job.output_path)
        await send_callback(job.callback_url, job.job_id, "remove_bg", True, {"output_path": result_path})
    except Exception as e:
        log.error(f"BG removal job {job.job_id} failed: {e}")
        await send_callback(job.callback_url, job.job_id, "remove_bg", False, error=str(e))


@app.post("/generate-image")
async def generate_image(job: ImageGenJob) -> dict[str, str]:
    log.info(f"Image gen job {job.job_id}: {job.prompt[:50]}...")
    asyncio.create_task(_run_image_gen(job))
    return {"status": "accepted", "job_id": job.job_id}


async def _run_image_gen(job: ImageGenJob) -> None:
    try:
        from image_pipeline import generate_image as do_generate
        result_path = await do_generate(job.prompt, job.style, job.output_path)
        await send_callback(job.callback_url, job.job_id, "generate_image", True, {"output_path": result_path})
    except Exception as e:
        log.error(f"Image gen job {job.job_id} failed: {e}")
        await send_callback(job.callback_url, job.job_id, "generate_image", False, error=str(e))


@app.post("/evaluate")
async def evaluate_product(job: EvalJob) -> dict[str, Any]:
    """Call local Ollama for product evaluation / copy generation."""
    log.info(f"Eval job {job.job_id}: {job.prompt[:50]}...")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/generate", json={
                "model": os.getenv("OLLAMA_MODEL", "ghostmarket"),
                "prompt": job.prompt,
                "system": job.system_prompt,
                "options": {
                    "temperature": job.temperature,
                    "num_predict": job.max_tokens,
                },
                "stream": False,
            })
            resp.raise_for_status()
            data = resp.json()
            return {
                "job_id": job.job_id,
                "text": data.get("response", ""),
                "model": data.get("model", "ghostmarket"),
                "tokens_in": data.get("prompt_eval_count", 0),
                "tokens_out": data.get("eval_count", 0),
            }
    except Exception as e:
        log.error(f"Eval job {job.job_id} failed: {e}")
        return {"job_id": job.job_id, "text": "", "error": str(e)}


@app.post("/train")
async def run_training(job: TrainJob) -> dict[str, str]:
    log.info(f"Train job {job.job_id}: type={job.train_type}")
    asyncio.create_task(_run_training(job))
    return {"status": "accepted", "job_id": job.job_id}


async def _run_training(job: TrainJob) -> None:
    try:
        if job.train_type == "qlora":
            from learner.qlora_trainer import run_qlora_training
            result = await run_qlora_training(job.data_path)
        elif job.train_type == "xgboost":
            from learner.xgboost_trainer import run_xgboost_training
            result = await run_xgboost_training()
        else:
            raise ValueError(f"Unknown train type: {job.train_type}")
        await send_callback(job.callback_url, job.job_id, "train", True, result)
    except Exception as e:
        log.error(f"Train job {job.job_id} failed: {e}")
        await send_callback(job.callback_url, job.job_id, "train", False, error=str(e))


@app.post("/claude-code")
async def run_claude_code(job: ClaudeCodeJob) -> dict[str, str]:
    log.info(f"Claude Code job {job.job_id}: {job.prompt[:80]}...")
    asyncio.create_task(_run_claude_code(job))
    return {"status": "accepted", "job_id": job.job_id}


async def _run_claude_code(job: ClaudeCodeJob) -> None:
    try:
        result = await asyncio.to_thread(
            subprocess.run,
            ["claude", "-p", job.prompt, "--dangerously-skip-permissions"],
            capture_output=True,
            text=True,
            cwd=job.project_path,
            timeout=600,
        )
        await send_callback(job.callback_url, job.job_id, "claude_code", result.returncode == 0, {
            "stdout": result.stdout[-2000:] if result.stdout else "",
            "stderr": result.stderr[-1000:] if result.stderr else "",
        })
    except subprocess.TimeoutExpired:
        await send_callback(job.callback_url, job.job_id, "claude_code", False, error="Claude Code timed out after 600s")
    except Exception as e:
        log.error(f"Claude Code job {job.job_id} failed: {e}")
        await send_callback(job.callback_url, job.job_id, "claude_code", False, error=str(e))
