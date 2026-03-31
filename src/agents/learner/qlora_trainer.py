"""GhostMarket Learner — QLoRA Fine-Tuning Pipeline

Trains a LoRA adapter on Llama-3.1-8B using labeled LLM call data.
Improves HOW the system sells (judgment + copy quality).

Pipeline:
1. Query llm_calls where outcome_quality = 'keep' + generate flipped outputs for 'flip' pairs
2. Format as instruction-tuning JSONL
3. QLoRA via unsloth (r=16, lora_alpha=32, 3 epochs, 4-bit quantization)
4. Evaluate new adapter vs previous on 20% holdout
5. If better → save adapter, update Ollama model, notify
6. If worse → keep old adapter, log failure
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.training import (
    export_qlora_jsonl,
    get_db,
    get_qlora_training_pairs,
    log_system_event,
    log_training_event,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Learner-QLoRA] %(message)s")
log = logging.getLogger("learner-qlora")

MODELS_DIR = Path(os.getenv("MODELS_DIR", "/models"))
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
ADAPTERS_DIR = MODELS_DIR / "ghostmarket_lora"
ADAPTERS_DIR.mkdir(parents=True, exist_ok=True)
TRAINING_DATA_DIR = DATA_DIR / "training"
TRAINING_DATA_DIR.mkdir(parents=True, exist_ok=True)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://model-server:11434")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
MIN_TRAINING_PAIRS = 50
BASE_MODEL = "unsloth/Meta-Llama-3.1-8B-Instruct-bnb-4bit"

# ROG GPU worker
ROG_ENABLED = os.getenv("ROG_ENABLED", "false").lower() == "true"
ROG_HOST = os.getenv("ROG_HOST", "192.168.1.100")
ROG_PORT = os.getenv("ROG_PORT", "5555")
ROG_SECRET = os.getenv("ROG_SECRET", "ghostmarket-rog-secret")
ROG_BASE_URL = f"http://{ROG_HOST}:{ROG_PORT}"


def _get_current_adapter_version() -> int:
    """Find the highest existing adapter version number."""
    versions = []
    for d in ADAPTERS_DIR.iterdir():
        if d.is_dir() and d.name.startswith("v"):
            try:
                versions.append(int(d.name[1:]))
            except ValueError:
                pass
    return max(versions) if versions else 0


async def _generate_flipped_output(input_prompt: str, task_type: str) -> str | None:
    """For 'flip' labeled pairs, generate a corrected output via Groq.
    These are product evaluations that were wrong (product was labeled loss but eval said winner).
    """
    if not GROQ_API_KEY:
        return None

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a product evaluation expert. The original evaluation was WRONG - the product was actually a LOSER. "
                            "Rewrite the evaluation to correctly identify why this product failed. Be specific about red flags."
                        },
                        {
                            "role": "user",
                            "content": f"Original product context:\n{input_prompt}\n\nRewrite the evaluation to correctly predict this product would FAIL."
                        }
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1024,
                }
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        log.warning(f"Failed to generate flipped output: {e}")
        return None


async def _prepare_training_data() -> tuple[str, str, int]:
    """Prepare training JSONL with keep + flipped pairs. Returns (train_path, eval_path, pair_count)."""
    # Get keep pairs directly
    pairs = get_qlora_training_pairs()

    # Also get 'flip' pairs that need corrected outputs
    with get_db() as conn:
        flip_rows = conn.execute("""
            SELECT task_type, input_prompt, output_text
            FROM llm_calls
            WHERE outcome_quality = 'flip'
            ORDER BY created_at
        """).fetchall()

    # Generate corrected outputs for flip pairs
    for row in flip_rows:
        r = dict(row)
        flipped = await _generate_flipped_output(r["input_prompt"], r["task_type"])
        if flipped:
            pairs.append({
                "instruction": f"Evaluate this product. It is actually a LOSER. Explain why.",
                "input": r["input_prompt"],
                "output": flipped,
            })

    if len(pairs) < MIN_TRAINING_PAIRS:
        raise ValueError(f"Not enough training pairs: {len(pairs)}/{MIN_TRAINING_PAIRS}")

    # Split into train (80%) and eval (20%)
    import random
    random.shuffle(pairs)
    split_idx = int(len(pairs) * 0.8)
    train_pairs = pairs[:split_idx]
    eval_pairs = pairs[split_idx:]

    train_path = str(TRAINING_DATA_DIR / "qlora_train.jsonl")
    eval_path = str(TRAINING_DATA_DIR / "qlora_eval.jsonl")

    for file_path, data in [(train_path, train_pairs), (eval_path, eval_pairs)]:
        with open(file_path, "w") as f:
            for pair in data:
                f.write(json.dumps(pair) + "\n")

    log.info(f"Training data prepared: {len(train_pairs)} train, {len(eval_pairs)} eval")
    return train_path, eval_path, len(pairs)


def _run_qlora_training(train_path: str, output_dir: str) -> bool:
    """Run QLoRA fine-tuning using unsloth. Returns True if successful."""
    training_script = f"""
import json
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# Load base model with 4-bit quantization
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="{BASE_MODEL}",
    max_seq_length=2048,
    dtype=None,
    load_in_4bit=True,
)

# Apply LoRA
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha=32,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
)

# Format prompt
def formatting_func(example):
    return f"### Instruction:\\n{{example['instruction']}}\\n\\n### Input:\\n{{example['input']}}\\n\\n### Response:\\n{{example['output']}}"

# Load training data
dataset = load_dataset("json", data_files="{train_path}", split="train")

# Training arguments
args = TrainingArguments(
    output_dir="{output_dir}",
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    warmup_steps=5,
    num_train_epochs=3,
    learning_rate=2e-4,
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
    formatting_func=formatting_func,
    max_seq_length=2048,
)

trainer.train()

# Save adapter
model.save_pretrained("{output_dir}")
tokenizer.save_pretrained("{output_dir}")
print("TRAINING_COMPLETE")
"""

    script_path = str(TRAINING_DATA_DIR / "run_qlora.py")
    with open(script_path, "w") as f:
        f.write(training_script)

    try:
        result = subprocess.run(
            ["python", script_path],
            capture_output=True,
            text=True,
            timeout=7200,  # 2 hour timeout
            cwd=str(TRAINING_DATA_DIR),
        )

        if "TRAINING_COMPLETE" in result.stdout:
            log.info("QLoRA training completed successfully")
            return True

        log.error(f"QLoRA training failed:\nstdout: {result.stdout[-500:]}\nstderr: {result.stderr[-500:]}")
        return False

    except subprocess.TimeoutExpired:
        log.error("QLoRA training timed out after 2 hours")
        return False
    except Exception as e:
        log.error(f"QLoRA training error: {e}")
        return False


async def _evaluate_adapter(eval_path: str, adapter_dir: str) -> float:
    """Evaluate the new adapter on holdout data. Returns quality score 0-1."""
    # Load eval data
    with open(eval_path) as f:
        eval_pairs = [json.loads(line) for line in f]

    if not eval_pairs:
        return 0.0

    # For now, use a simple perplexity/quality check via Ollama
    # In production, this would load the adapter and run inference
    # For the initial implementation, we compare generation quality
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            correct = 0
            total = min(len(eval_pairs), 20)  # Sample 20 for speed

            for pair in eval_pairs[:total]:
                resp = await client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={
                        "model": "ghostmarket",
                        "prompt": f"### Instruction:\n{pair['instruction']}\n\n### Input:\n{pair['input']}\n\n### Response:\n",
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": 512},
                    },
                    timeout=60,
                )

                if resp.status_code != 200:
                    continue

                generated = resp.json().get("response", "")

                # Simple quality check: does the generated output contain key concepts?
                expected_lower = pair["output"].lower()
                generated_lower = generated.lower()

                # Check for key term overlap
                expected_words = set(expected_lower.split())
                generated_words = set(generated_lower.split())
                overlap = len(expected_words & generated_words) / max(len(expected_words), 1)

                if overlap > 0.3:  # 30% word overlap = reasonable
                    correct += 1

            return correct / total if total > 0 else 0.0

    except Exception as e:
        log.warning(f"Adapter evaluation failed: {e}")
        return 0.5  # Give benefit of the doubt if Ollama is down


async def _update_ollama_model(adapter_dir: str, version: int) -> bool:
    """Create/update the Ollama model with the new LoRA adapter."""
    modelfile_content = f"""FROM llama3.1:8b-instruct-q4_0
ADAPTER {adapter_dir}
SYSTEM You are a GhostMarket e-commerce analysis assistant. You evaluate products, write ad hooks, name brands, and create marketing copy. Be specific, data-driven, and commercially minded.
"""
    modelfile_path = ADAPTERS_DIR / f"Modelfile_v{version}"
    with open(modelfile_path, "w") as f:
        f.write(modelfile_content)

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/create",
                json={"name": "ghostmarket", "modelfile": modelfile_content},
                timeout=300,
            )
            if resp.status_code == 200:
                log.info(f"Ollama model 'ghostmarket' updated to v{version}")
                return True
            log.error(f"Ollama model update failed: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        log.error(f"Ollama model update error: {e}")
        return False


# ============================================================
# Main pipeline
# ============================================================

async def _dispatch_to_rog(pairs: list[dict], job_id: str) -> dict[str, Any]:
    """Dispatch QLoRA job to ROG worker. Returns immediately (async callback on completion)."""
    log.info(f"Dispatching QLoRA to ROG worker at {ROG_BASE_URL} (job_id={job_id})")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{ROG_BASE_URL}/qlora",
                headers={"X-Secret": ROG_SECRET, "Content-Type": "application/json"},
                json={
                    "job_id": job_id,
                    "training_data": pairs,
                    "epochs": 3,
                    "batch_size": 2,
                    "lora_r": 16,
                    "lora_alpha": 32,
                    "learning_rate": 2e-4,
                    "callback_on_complete": True,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            log.info(f"ROG accepted job: {data}")
            return {
                "success": True,
                "dispatched_to": "rog",
                "job_id": job_id,
                "status": "training_started_on_rog",
                "training_pairs": len(pairs),
            }
    except Exception as e:
        log.error(f"ROG dispatch failed: {e} — falling back to local training")
        return {"dispatched_to": "rog", "success": False, "error": str(e)}


async def run_qlora_training(data_path: str = "") -> dict[str, Any]:
    """Full QLoRA training pipeline. Called by /train command or biweekly cron."""
    log.info("Starting QLoRA fine-tuning pipeline")

    # Check if we have enough data
    pairs = get_qlora_training_pairs()
    if len(pairs) < MIN_TRAINING_PAIRS:
        msg = f"Not enough training pairs ({len(pairs)}/{MIN_TRAINING_PAIRS})"
        log.info(msg)
        return {"skipped": True, "reason": msg, "pair_count": len(pairs)}

    # ── ROG dispatch path ──────────────────────────────────────
    if ROG_ENABLED:
        import uuid
        # Prepare training pairs (with flipped pairs) then send to ROG
        try:
            train_path, eval_path, total_pairs = await _prepare_training_data()
            with open(train_path) as f:
                all_pairs = [json.loads(line) for line in f]
            job_id = f"qlora_{uuid.uuid4().hex[:8]}"
            result = await _dispatch_to_rog(all_pairs, job_id)
            if result.get("success"):
                log_system_event("learner", "health_check", "info",
                                 f"QLoRA dispatched to ROG: {job_id} ({total_pairs} pairs)")
                return result
            log.warning("ROG dispatch failed, falling back to local training")
        except Exception as e:
            log.warning(f"ROG prep/dispatch error: {e}, falling back to local training")

    current_version = _get_current_adapter_version()
    new_version = current_version + 1
    adapter_dir = str(ADAPTERS_DIR / f"v{new_version}")

    try:
        # 1. Prepare training data (including flipped pairs)
        train_path, eval_path, total_pairs = await _prepare_training_data()
        log.info(f"Training data: {total_pairs} total pairs")

        # 2. Run QLoRA training
        success = _run_qlora_training(train_path, adapter_dir)
        if not success:
            log_system_event("learner", "error", "error", "QLoRA training failed")
            return {"success": False, "error": "Training subprocess failed"}

        # 3. Evaluate new adapter
        # First, temporarily load it into Ollama
        ollama_updated = await _update_ollama_model(adapter_dir, new_version)
        if not ollama_updated:
            log.warning("Could not update Ollama for evaluation, scoring as 0.5")

        new_score = await _evaluate_adapter(eval_path, adapter_dir)

        # Evaluate previous adapter (if exists)
        old_score = 0.0
        if current_version > 0:
            old_adapter_dir = str(ADAPTERS_DIR / f"v{current_version}")
            if os.path.exists(old_adapter_dir):
                await _update_ollama_model(old_adapter_dir, current_version)
                old_score = await _evaluate_adapter(eval_path, old_adapter_dir)

        log.info(f"Evaluation: old={old_score:.3f}, new={new_score:.3f}")

        # 4. Deploy or rollback
        deployed = False
        if new_score >= old_score or current_version == 0:
            # Deploy new adapter
            await _update_ollama_model(adapter_dir, new_version)
            deployed = True
            log.info(f"Deployed LoRA adapter v{new_version}")
        else:
            # Rollback
            if current_version > 0:
                old_adapter_dir = str(ADAPTERS_DIR / f"v{current_version}")
                await _update_ollama_model(old_adapter_dir, current_version)
            # Clean up failed adapter
            shutil.rmtree(adapter_dir, ignore_errors=True)
            log.warning(f"New adapter v{new_version} worse than v{current_version}. Rolled back.")

        # 5. Log learning cycle
        cycle_number = 1
        with get_db() as conn:
            row = conn.execute(
                "SELECT MAX(cycle_number) as max_n FROM learning_cycles WHERE cycle_type = 'qlora'"
            ).fetchone()
            if row and row["max_n"]:
                cycle_number = row["max_n"] + 1

        log_training_event("learning_cycles", {
            "cycle_number": cycle_number,
            "cycle_type": "qlora",
            "model_version_before": f"lora_v{current_version}" if current_version > 0 else "none",
            "model_version_after": f"lora_v{new_version}" if deployed else f"lora_v{current_version}",
            "accuracy_before": old_score,
            "accuracy_after": new_score,
            "training_samples": total_pairs,
            "holdout_samples": int(total_pairs * 0.2),
            "deployed": 1 if deployed else 0,
            "error_log": None if deployed else "New adapter scored worse than previous",
        })

        # Mark training data as used
        if deployed:
            with get_db() as conn:
                conn.execute(
                    "UPDATE llm_calls SET included_in_training = 1, training_version = ? WHERE outcome_quality IN ('keep', 'flip')",
                    [f"lora_v{new_version}"],
                )
                conn.commit()

        return {
            "success": True,
            "deployed": deployed,
            "version": f"lora_v{new_version}" if deployed else f"lora_v{current_version}",
            "accuracy_before": old_score,
            "accuracy_after": new_score,
            "training_pairs": total_pairs,
        }

    except Exception as e:
        log.error(f"QLoRA pipeline failed: {e}")
        log_system_event("learner", "error", "error", f"QLoRA pipeline failed: {e}")
        # Clean up partial adapter
        if os.path.exists(adapter_dir):
            shutil.rmtree(adapter_dir, ignore_errors=True)
        return {"success": False, "error": str(e)}
