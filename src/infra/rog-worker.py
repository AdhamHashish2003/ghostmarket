"""GhostMarket ROG Worker — FastAPI service running on the ASUS ROG laptop.

Endpoints:
  GET  /health         — liveness check + GPU info
  POST /qlora          — run QLoRA fine-tuning job
  POST /scrape         — heavy Playwright/BS4 scraping
  POST /imagegen       — batch image generation via local diffusion

Start:
  uvicorn rog-worker:app --host 0.0.0.0 --port 5555

Auth: all POST endpoints require header  X-Secret: <ROG_SECRET from .env>
"""

import asyncio
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ROG] %(message)s")
log = logging.getLogger("rog-worker")

ROG_SECRET = os.getenv("ROG_SECRET", "ghostmarket-rog-secret")
MAIN_MACHINE_URL = os.getenv("MAIN_MACHINE_URL", "")
MODELS_DIR = Path(os.getenv("MODELS_DIR", "/opt/ghostmarket-rog/models"))
DATA_DIR = Path(os.getenv("DATA_DIR", "/opt/ghostmarket-rog/data"))
HF_TOKEN = os.getenv("HF_TOKEN", "")
BASE_MODEL = "unsloth/Meta-Llama-3.1-8B-Instruct-bnb-4bit"

MODELS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="GhostMarket ROG Worker", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Track running jobs
_jobs: dict[str, dict[str, Any]] = {}


# ── Auth ──────────────────────────────────────────────────────

def _check_auth(request: Request) -> None:
    secret = request.headers.get("X-Secret", "")
    if secret != ROG_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── GPU info ──────────────────────────────────────────────────

def _gpu_info() -> dict[str, Any]:
    try:
        import torch
        if torch.cuda.is_available():
            return {
                "available": True,
                "device": torch.cuda.get_device_name(0),
                "vram_total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1),
                "vram_free_gb": round((torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated(0)) / 1e9, 1),
            }
    except Exception:
        pass
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            parts = result.stdout.strip().split(",")
            return {
                "available": True,
                "device": parts[0].strip(),
                "vram_total_gb": round(float(parts[1].strip()) / 1024, 1),
                "vram_free_gb": round(float(parts[2].strip()) / 1024, 1),
            }
    except Exception:
        pass
    return {"available": False, "device": "none"}


# ── Callback helper ───────────────────────────────────────────

async def _send_callback(job_id: str, result: dict[str, Any]) -> None:
    if not MAIN_MACHINE_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(
                f"{MAIN_MACHINE_URL}/callback",
                json={"job_id": job_id, **result},
                headers={"X-Secret": ROG_SECRET},
            )
        log.info(f"Callback sent for job {job_id}")
    except Exception as e:
        log.warning(f"Callback failed for {job_id}: {e}")


# ═══════════════════════════════════════════════════════════════
# GET /health
# ═══════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {
        "status": "online",
        "gpu": _gpu_info(),
        "jobs": {jid: {"status": j["status"]} for jid, j in _jobs.items()},
        "python": sys.version.split()[0],
    }


# ═══════════════════════════════════════════════════════════════
# POST /qlora  — QLoRA fine-tuning
# ═══════════════════════════════════════════════════════════════

class QLoRARequest(BaseModel):
    job_id: str
    training_data: list[dict]   # list of {instruction, input, output}
    base_model: str = BASE_MODEL
    epochs: int = 3
    batch_size: int = 2
    lora_r: int = 16
    lora_alpha: int = 32
    learning_rate: float = 2e-4
    callback_on_complete: bool = True


@app.post("/qlora")
async def qlora(req: QLoRARequest, request: Request, background: BackgroundTasks):
    _check_auth(request)

    if req.job_id in _jobs and _jobs[req.job_id]["status"] == "running":
        raise HTTPException(status_code=409, detail=f"Job {req.job_id} already running")

    _jobs[req.job_id] = {"status": "running", "started": time.time()}
    background.add_task(_run_qlora, req)
    return {"job_id": req.job_id, "status": "accepted"}


async def _run_qlora(req: QLoRARequest) -> None:
    job_id = req.job_id
    log.info(f"[qlora/{job_id}] Starting with {len(req.training_data)} pairs")

    adapter_dir = str(MODELS_DIR / f"adapter_{job_id}")
    train_file = DATA_DIR / f"train_{job_id}.jsonl"

    try:
        # Write training data to disk
        with open(train_file, "w") as f:
            for pair in req.training_data:
                f.write(json.dumps(pair) + "\n")

        # Build training script
        script = f"""
import json, sys

try:
    from unsloth import FastLanguageModel
    USE_UNSLOTH = True
except ImportError:
    USE_UNSLOTH = False

from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

print(f"USE_UNSLOTH={{USE_UNSLOTH}}", flush=True)

if USE_UNSLOTH:
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name="{req.base_model}",
        max_seq_length=2048,
        dtype=None,
        load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r={req.lora_r},
        target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
        lora_alpha={req.lora_alpha},
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )
else:
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import get_peft_model, LoraConfig, TaskType
    import torch

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_quant_type="nf4",
    )
    tokenizer = AutoTokenizer.from_pretrained("{req.base_model}", token="{HF_TOKEN}" or None)
    model = AutoModelForCausalLM.from_pretrained(
        "{req.base_model}",
        quantization_config=bnb_config,
        device_map="auto",
        token="{HF_TOKEN}" or None,
    )
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r={req.lora_r},
        lora_alpha={req.lora_alpha},
        target_modules=["q_proj","k_proj","v_proj","o_proj"],
        lora_dropout=0.05,
        bias="none",
    )
    model = get_peft_model(model, peft_config)

if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

def fmt(ex):
    return f"### Instruction:\\n{{ex['instruction']}}\\n\\n### Input:\\n{{ex['input']}}\\n\\n### Response:\\n{{ex['output']}}"

dataset = load_dataset("json", data_files="{str(train_file)}", split="train")

args = TrainingArguments(
    output_dir="{adapter_dir}",
    per_device_train_batch_size={req.batch_size},
    gradient_accumulation_steps=4,
    warmup_steps=5,
    num_train_epochs={req.epochs},
    learning_rate={req.learning_rate},
    fp16=True,
    logging_steps=10,
    save_strategy="epoch",
    optim="adamw_8bit",
    seed=42,
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=args,
    formatting_func=fmt,
    max_seq_length=2048,
)

trainer.train()
model.save_pretrained("{adapter_dir}")
tokenizer.save_pretrained("{adapter_dir}")
print("TRAINING_COMPLETE", flush=True)
"""
        script_path = DATA_DIR / f"run_qlora_{job_id}.py"
        with open(script_path, "w") as f:
            f.write(script)

        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            timeout=7200,
        )

        if "TRAINING_COMPLETE" in result.stdout:
            log.info(f"[qlora/{job_id}] Training complete, adapter at {adapter_dir}")
            _jobs[job_id] = {"status": "done", "adapter_dir": adapter_dir}
            if req.callback_on_complete:
                await _send_callback(job_id, {
                    "job_type": "qlora",
                    "success": True,
                    "adapter_dir": adapter_dir,
                })
        else:
            tail_out = result.stdout[-1000:] if result.stdout else ""
            tail_err = result.stderr[-1000:] if result.stderr else ""
            log.error(f"[qlora/{job_id}] Failed\nstdout: {tail_out}\nstderr: {tail_err}")
            _jobs[job_id] = {"status": "failed", "error": tail_err[-300:]}
            await _send_callback(job_id, {
                "job_type": "qlora",
                "success": False,
                "error": tail_err[-300:],
            })

    except Exception as e:
        log.error(f"[qlora/{job_id}] Exception: {e}\n{traceback.format_exc()}")
        _jobs[job_id] = {"status": "failed", "error": str(e)}
        await _send_callback(job_id, {"job_type": "qlora", "success": False, "error": str(e)})
    finally:
        # Clean up temp files
        for p in [train_file, DATA_DIR / f"run_qlora_{job_id}.py"]:
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass


# ═══════════════════════════════════════════════════════════════
# POST /scrape  — heavy Playwright scraping
# ═══════════════════════════════════════════════════════════════

class ScrapeRequest(BaseModel):
    job_id: str
    urls: list[str]
    extract: str = "text"          # "text" | "html" | "links" | "price"
    wait_for: str = ""             # CSS selector to wait for
    timeout_ms: int = 15000
    callback_on_complete: bool = True


@app.post("/scrape")
async def scrape(req: ScrapeRequest, request: Request, background: BackgroundTasks):
    _check_auth(request)
    _jobs[req.job_id] = {"status": "running", "started": time.time()}
    background.add_task(_run_scrape, req)
    return {"job_id": req.job_id, "status": "accepted", "url_count": len(req.urls)}


async def _run_scrape(req: ScrapeRequest) -> None:
    job_id = req.job_id
    log.info(f"[scrape/{job_id}] Scraping {len(req.urls)} URLs")
    results = []

    try:
        # Try Playwright first (handles JS-rendered pages)
        try:
            from playwright.async_api import async_playwright
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                )

                for url in req.urls:
                    try:
                        page = await context.new_page()
                        await page.goto(url, wait_until="domcontentloaded", timeout=req.timeout_ms)

                        if req.wait_for:
                            try:
                                await page.wait_for_selector(req.wait_for, timeout=5000)
                            except Exception:
                                pass

                        if req.extract == "html":
                            content = await page.content()
                        elif req.extract == "links":
                            links = await page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
                            content = json.dumps(links)
                        elif req.extract == "price":
                            # Common price selectors
                            price = None
                            for sel in ["[class*='price']", "[itemprop='price']", ".price", "#price"]:
                                try:
                                    el = page.locator(sel).first
                                    price = await el.inner_text(timeout=2000)
                                    break
                                except Exception:
                                    pass
                            content = price or ""
                        else:  # text
                            content = await page.inner_text("body")

                        results.append({"url": url, "success": True, "content": content[:50000]})
                        await page.close()
                    except Exception as e:
                        log.warning(f"[scrape/{job_id}] {url}: {e}")
                        results.append({"url": url, "success": False, "error": str(e)})

                await browser.close()

        except ImportError:
            # Fallback: httpx + BeautifulSoup
            log.warning(f"[scrape/{job_id}] Playwright not available, using httpx fallback")
            from bs4 import BeautifulSoup

            async with httpx.AsyncClient(
                timeout=req.timeout_ms / 1000,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                follow_redirects=True,
            ) as client:
                for url in req.urls:
                    try:
                        resp = await client.get(url)
                        soup = BeautifulSoup(resp.text, "lxml")

                        if req.extract == "html":
                            content = resp.text[:50000]
                        elif req.extract == "links":
                            links = [a.get("href", "") for a in soup.find_all("a", href=True)]
                            content = json.dumps(links[:500])
                        else:
                            content = soup.get_text(separator=" ", strip=True)[:50000]

                        results.append({"url": url, "success": True, "content": content})
                    except Exception as e:
                        results.append({"url": url, "success": False, "error": str(e)})

        _jobs[job_id] = {"status": "done", "result_count": len(results)}
        await _send_callback(job_id, {
            "job_type": "scrape",
            "success": True,
            "results": results,
        })
        log.info(f"[scrape/{job_id}] Done: {len(results)} URLs scraped")

    except Exception as e:
        log.error(f"[scrape/{job_id}] Exception: {e}")
        _jobs[job_id] = {"status": "failed", "error": str(e)}
        await _send_callback(job_id, {"job_type": "scrape", "success": False, "error": str(e)})


# ═══════════════════════════════════════════════════════════════
# POST /imagegen  — batch image generation
# ═══════════════════════════════════════════════════════════════

class ImageGenRequest(BaseModel):
    job_id: str
    prompts: list[str]            # one image per prompt
    model: str = "sdxl-turbo"     # "sdxl-turbo" | "flux-schnell"
    width: int = 1024
    height: int = 1024
    steps: int = 4
    guidance: float = 0.0
    output_format: str = "png"    # "png" | "base64"
    callback_on_complete: bool = True


@app.post("/imagegen")
async def imagegen(req: ImageGenRequest, request: Request, background: BackgroundTasks):
    _check_auth(request)
    _jobs[req.job_id] = {"status": "running", "started": time.time()}
    background.add_task(_run_imagegen, req)
    return {"job_id": req.job_id, "status": "accepted", "prompt_count": len(req.prompts)}


async def _run_imagegen(req: ImageGenRequest) -> None:
    job_id = req.job_id
    log.info(f"[imagegen/{job_id}] Generating {len(req.prompts)} images with {req.model}")
    images: list[dict] = []

    try:
        import torch
        from diffusers import AutoPipelineForText2Image

        gpu_info = _gpu_info()
        device = "cuda" if gpu_info["available"] else "cpu"

        # Model ID mapping
        model_ids = {
            "sdxl-turbo": "stabilityai/sdxl-turbo",
            "flux-schnell": "black-forest-labs/FLUX.1-schnell",
        }
        model_id = model_ids.get(req.model, "stabilityai/sdxl-turbo")

        log.info(f"[imagegen/{job_id}] Loading {model_id} on {device}...")
        pipe = AutoPipelineForText2Image.from_pretrained(
            model_id,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
            variant="fp16" if device == "cuda" else None,
        )
        pipe = pipe.to(device)

        output_dir = DATA_DIR / f"imagegen_{job_id}"
        output_dir.mkdir(parents=True, exist_ok=True)

        for i, prompt in enumerate(req.prompts):
            try:
                result = pipe(
                    prompt=prompt,
                    num_inference_steps=req.steps,
                    guidance_scale=req.guidance,
                    width=req.width,
                    height=req.height,
                )
                img = result.images[0]

                if req.output_format == "base64":
                    import base64
                    import io
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    b64 = base64.b64encode(buf.getvalue()).decode()
                    images.append({"index": i, "prompt": prompt, "base64": b64})
                else:
                    img_path = output_dir / f"image_{i:04d}.png"
                    img.save(str(img_path))
                    images.append({"index": i, "prompt": prompt, "path": str(img_path)})

                log.info(f"[imagegen/{job_id}] {i+1}/{len(req.prompts)} done")

            except Exception as e:
                log.warning(f"[imagegen/{job_id}] Image {i} failed: {e}")
                images.append({"index": i, "prompt": prompt, "error": str(e)})

        del pipe
        if device == "cuda":
            torch.cuda.empty_cache()

        _jobs[job_id] = {"status": "done", "image_count": len(images)}
        await _send_callback(job_id, {
            "job_type": "imagegen",
            "success": True,
            "images": images,
        })
        log.info(f"[imagegen/{job_id}] Done: {len(images)} images generated")

    except ImportError as e:
        log.error(f"[imagegen/{job_id}] diffusers not installed: {e}")
        _jobs[job_id] = {"status": "failed", "error": "diffusers not installed"}
        await _send_callback(job_id, {
            "job_type": "imagegen",
            "success": False,
            "error": "diffusers package not installed on ROG worker",
        })
    except Exception as e:
        log.error(f"[imagegen/{job_id}] Exception: {e}")
        _jobs[job_id] = {"status": "failed", "error": str(e)}
        await _send_callback(job_id, {"job_type": "imagegen", "success": False, "error": str(e)})


# ── Entry ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("ROG_PORT", "5555"))
    log.info(f"Starting ROG Worker on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, workers=1)
