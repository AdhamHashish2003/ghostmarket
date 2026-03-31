#!/usr/bin/env bash
# ============================================================
# GhostMarket ROG Worker Setup Script
# Run ONCE on the ASUS ROG machine:
#   chmod +x setup-rog.sh && sudo ./setup-rog.sh
#
# What this does:
#   1. Installs Python 3.11, pip, CUDA toolkit
#   2. Installs PyTorch with CUDA + all ML deps (QLoRA, xgboost, etc.)
#   3. Creates /opt/ghostmarket-rog/ with the worker service
#   4. Starts FastAPI worker on port 5555 via systemd
#   5. Optionally pulls Llama-3.1-8B model weights
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[setup]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
die()  { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── Sanity checks ──────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Run as root: sudo ./setup-rog.sh"
command -v nvidia-smi &>/dev/null || warn "nvidia-smi not found — install GPU drivers first if you want GPU acceleration"

log "=== GhostMarket ROG Worker Setup ==="
log "This will take 10-20 minutes depending on internet speed."
echo

# ── 1. System packages ─────────────────────────────────────────
log "Installing system packages..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    software-properties-common \
    build-essential \
    curl \
    wget \
    git \
    unzip \
    lsof \
    net-tools \
    ca-certificates \
    gnupg \
    libssl-dev \
    libffi-dev \
    python3-pip \
    python3-venv \
    python3-dev 2>&1 | tail -5

# ── 2. Python 3.11 ────────────────────────────────────────────
log "Checking Python 3.11..."
if ! python3.11 --version &>/dev/null; then
    log "Installing Python 3.11..."
    add-apt-repository -y ppa:deadsnakes/ppa 2>&1 | tail -2
    apt-get update -qq
    apt-get install -y python3.11 python3.11-venv python3.11-dev 2>&1 | tail -3
fi
PYTHON=$(command -v python3.11)
ok "Python: $($PYTHON --version)"

# ── 3. Virtual environment ─────────────────────────────────────
INSTALL_DIR="/opt/ghostmarket-rog"
log "Creating install dir: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [[ ! -d venv ]]; then
    $PYTHON -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip --quiet
ok "Virtualenv ready: $INSTALL_DIR/venv"

# ── 4. Detect CUDA and install PyTorch ────────────────────────
log "Detecting CUDA..."
CUDA_VERSION=""
if command -v nvcc &>/dev/null; then
    CUDA_VERSION=$(nvcc --version | grep -oP 'release \K[\d.]+' | head -1)
fi
if [[ -z "$CUDA_VERSION" ]] && command -v nvidia-smi &>/dev/null; then
    CUDA_VERSION=$(nvidia-smi | grep -oP 'CUDA Version: \K[\d.]+' | head -1)
fi

if [[ -z "$CUDA_VERSION" ]]; then
    warn "No CUDA detected — installing CPU-only PyTorch (GPU disabled)"
    pip install torch torchvision torchaudio --quiet
else
    # Map CUDA version to torch index URL
    CUDA_MAJOR="${CUDA_VERSION%%.*}"
    CUDA_MINOR="${CUDA_VERSION##*.}"
    if [[ "$CUDA_MAJOR" -ge 12 ]]; then
        TORCH_CUDA="cu121"
    elif [[ "$CUDA_MAJOR" -eq 11 ]]; then
        TORCH_CUDA="cu118"
    else
        TORCH_CUDA="cpu"
        warn "CUDA $CUDA_VERSION too old — falling back to CPU"
    fi

    log "Installing PyTorch with CUDA $TORCH_CUDA..."
    pip install torch torchvision torchaudio \
        --index-url "https://download.pytorch.org/whl/$TORCH_CUDA" \
        --quiet
    ok "PyTorch installed with $TORCH_CUDA"
fi

# ── 5. ML/QLoRA dependencies ──────────────────────────────────
log "Installing QLoRA stack (transformers, peft, bitsandbytes, trl)..."
pip install \
    transformers>=4.40.0 \
    peft>=0.10.0 \
    bitsandbytes>=0.43.0 \
    trl>=0.8.0 \
    datasets>=2.18.0 \
    accelerate>=0.28.0 \
    sentencepiece \
    protobuf \
    --quiet

# Try unsloth (faster QLoRA) — optional, falls back to standard if it fails
log "Attempting to install unsloth (optimized QLoRA)..."
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git" --quiet 2>&1 | tail -3 || \
    warn "unsloth not installed (GPU/CUDA mismatch) — will use standard peft instead"

# ── 6. Scraping dependencies ──────────────────────────────────
log "Installing scraping stack..."
pip install \
    fastapi>=0.111.0 \
    uvicorn[standard]>=0.29.0 \
    httpx>=0.27.0 \
    beautifulsoup4>=4.12.0 \
    lxml \
    playwright \
    xgboost>=2.0.0 \
    scikit-learn \
    pandas \
    numpy \
    pillow \
    aiofiles \
    python-multipart \
    --quiet

# Install Playwright browsers (headless Chrome)
log "Installing Playwright Chromium..."
python -m playwright install chromium 2>&1 | tail -3 || warn "Playwright install failed — scraping will use httpx only"

ok "All dependencies installed"

# ── 7. Copy worker file ───────────────────────────────────────
log "Installing rog-worker.py..."
# Find the script relative to this setup script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_SRC="$SCRIPT_DIR/../src/infra/rog-worker.py"

if [[ -f "$WORKER_SRC" ]]; then
    cp "$WORKER_SRC" "$INSTALL_DIR/worker.py"
    ok "Worker copied from $WORKER_SRC"
else
    warn "rog-worker.py not found at $WORKER_SRC — you must copy it manually to $INSTALL_DIR/worker.py"
fi

# ── 8. .env file ──────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    log "Creating .env file (fill in MAIN_MACHINE_IP below)..."
    cat > "$ENV_FILE" << 'EOF'
# ROG Worker Configuration
ROG_PORT=5555
ROG_SECRET=ghostmarket-rog-secret

# IP of your main PC (where orchestrator runs)
MAIN_MACHINE_URL=http://192.168.1.XXX:4000

# Hugging Face token (needed for gated models like Llama)
HF_TOKEN=

# Models dir
MODELS_DIR=/opt/ghostmarket-rog/models
DATA_DIR=/opt/ghostmarket-rog/data
EOF
    warn "Edit $ENV_FILE and set MAIN_MACHINE_URL to your PC's local IP"
fi

mkdir -p "$INSTALL_DIR/models" "$INSTALL_DIR/data"

# ── 9. Systemd service ────────────────────────────────────────
log "Installing systemd service..."
cat > /etc/systemd/system/ghostmarket-rog.service << EOF
[Unit]
Description=GhostMarket ROG Worker (FastAPI on port 5555)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv/bin/uvicorn worker:app --host 0.0.0.0 --port 5555 --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ghostmarket-rog

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ghostmarket-rog
systemctl restart ghostmarket-rog
sleep 2

if systemctl is-active --quiet ghostmarket-rog; then
    ok "ghostmarket-rog service is RUNNING on port 5555"
else
    warn "Service failed to start — check: journalctl -u ghostmarket-rog -n 50"
fi

# ── 10. Optional: Pull Llama-3.1-8B ──────────────────────────
if [[ "${PULL_MODEL:-0}" == "1" ]]; then
    log "Pulling Llama-3.1-8B model weights (this requires HF_TOKEN in .env and ~16GB disk)..."
    source "$ENV_FILE" 2>/dev/null || true
    if [[ -n "${HF_TOKEN:-}" ]]; then
        pip install huggingface_hub --quiet
        python -c "
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='unsloth/Meta-Llama-3.1-8B-Instruct-bnb-4bit',
    local_dir='/opt/ghostmarket-rog/models/llama-3.1-8b',
    token='$HF_TOKEN'
)
print('Model downloaded!')
"
        ok "Model downloaded to /opt/ghostmarket-rog/models/llama-3.1-8b"
    else
        warn "HF_TOKEN not set — skipping model download. Set it in $ENV_FILE and run: PULL_MODEL=1 $0"
    fi
else
    log "Skipping model download. To download Llama-3.1-8B later:"
    log "  Set HF_TOKEN in $ENV_FILE, then run: PULL_MODEL=1 sudo $0"
fi

# ── 11. Firewall ──────────────────────────────────────────────
log "Opening port 5555 in firewall..."
if command -v ufw &>/dev/null; then
    ufw allow 5555/tcp 2>/dev/null || true
    ok "ufw rule added for port 5555"
fi

# ── Done ──────────────────────────────────────────────────────
echo
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        ROG Worker Setup Complete!                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo
echo -e "  Worker running at: ${CYAN}http://$(hostname -I | awk '{print $1}'):5555${NC}"
echo -e "  Health check:      ${CYAN}curl http://localhost:5555/health${NC}"
echo -e "  Logs:              ${CYAN}journalctl -u ghostmarket-rog -f${NC}"
echo -e "  Config:            ${CYAN}$ENV_FILE${NC}"
echo
echo -e "${YELLOW}Next steps on your main PC:${NC}"
echo -e "  1. Edit .env and set: ${CYAN}ROG_ENABLED=true${NC}"
echo -e "  2. Edit .env and set: ${CYAN}ROG_HOST=<ROG's local IP>${NC}"
echo -e "  3. Edit .env and set: ${CYAN}ROG_PORT=5555${NC}"
echo -e "  4. Restart: ${CYAN}pm2 restart all${NC}"
echo
