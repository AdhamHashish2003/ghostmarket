#!/bin/bash
# GhostMarket Master Test Script
# Tests every component, every integration, every endpoint

cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
PASS=0
FAIL=0
WARN=0

report() {
  if [ "$2" == "pass" ]; then
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASS++))
  elif [ "$2" == "fail" ]; then
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((FAIL++))
  else
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
    ((WARN++))
  fi
}

echo "=========================================="
echo "  GHOSTMARKET MASTER TEST"
echo "  $(date)"
echo "=========================================="
echo ""

# --- ENVIRONMENT ---
echo "--- Environment ---"
if [ -f .env ]; then report ".env file exists" "pass"; else report ".env file missing" "fail"; fi

for key in GROQ_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  val=$(grep "^${key}=" .env | cut -d'=' -f2-)
  if [ -n "$val" ] && [[ "$val" != your_* ]] && [[ "$val" != skip* ]]; then
    report "$key is set" "pass"
  else
    report "$key is missing or placeholder" "fail"
  fi
done

for key in GEMINI_API_KEY NVIDIA_NIM_API_KEY REPLICATE_API_TOKEN VERCEL_TOKEN BUFFER_ACCESS_TOKEN; do
  val=$(grep "^${key}=" .env | cut -d'=' -f2-)
  if [ -n "$val" ] && [[ "$val" != your_* ]] && [[ "$val" != skip* ]]; then
    report "$key is set" "pass"
  else
    report "$key is placeholder (non-critical)" "warn"
  fi
done

echo ""

# --- DATABASE ---
echo "--- Database ---"
DB_PATH="./data/ghostmarket.db"
if [ -f "$DB_PATH" ]; then
  report "SQLite database exists" "pass"

  for table in products trend_signals suppliers brand_kits landing_pages ad_creatives content_posts campaign_metrics outcomes learning_cycles operator_decisions system_events llm_calls; do
    count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM $table;" 2>/dev/null)
    if [ $? -eq 0 ]; then
      report "Table $table exists (${count} rows)" "pass"
    else
      report "Table $table missing or broken" "fail"
    fi
  done

  result=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM training_export;" 2>/dev/null)
  if [ $? -eq 0 ]; then
    report "training_export view works (${result} rows)" "pass"
  else
    report "training_export view broken" "fail"
  fi
else
  report "SQLite database does not exist" "fail"
fi

echo ""

# --- DEPENDENCIES ---
echo "--- Dependencies ---"
if [ -d "node_modules" ]; then report "root node_modules exists" "pass"; else report "root node_modules missing" "fail"; fi
if [ -d "src/dashboard/node_modules" ]; then report "dashboard node_modules exists" "pass"; else report "dashboard node_modules missing" "fail"; fi
if command -v python3 &>/dev/null; then report "python3 available ($(python3 --version 2>&1))" "pass"; else report "python3 not found" "fail"; fi
if command -v node &>/dev/null; then report "node available ($(node -v))" "pass"; else report "node not found" "fail"; fi
if command -v pm2 &>/dev/null; then report "pm2 available" "pass"; else report "pm2 not found" "fail"; fi
if [ -x /tmp/cloudflared ]; then report "cloudflared available" "pass"; else report "cloudflared not found at /tmp/cloudflared" "warn"; fi

echo ""

# --- TYPESCRIPT ---
echo "--- TypeScript ---"
npx tsc --noEmit 2>/tmp/tsc_errors.txt
if [ $? -eq 0 ]; then
  report "TypeScript compiles clean" "pass"
else
  ERRS=$(wc -l < /tmp/tsc_errors.txt)
  report "TypeScript has ${ERRS} error lines (see /tmp/tsc_errors.txt)" "fail"
fi

echo ""

# --- PYTHON IMPORTS ---
echo "--- Python Imports ---"
for mod in pytrends xgboost sklearn httpx pandas numpy PIL; do
  python3 -c "import $mod" 2>/dev/null
  if [ $? -eq 0 ]; then report "Python: $mod importable" "pass"; else report "Python: $mod missing" "fail"; fi
done

# Test our own modules
PYTHONPATH=src GHOSTMARKET_DB=./data/ghostmarket.db python3 -c "from shared.training import get_db; print('ok')" 2>/dev/null
if [ $? -eq 0 ]; then report "Python: shared.training importable" "pass"; else report "Python: shared.training broken" "fail"; fi

PYTHONPATH=src GHOSTMARKET_DB=./data/ghostmarket.db python3 -c "from agents.scout.light_sources import scrape_reddit; print('ok')" 2>/dev/null
if [ $? -eq 0 ]; then report "Python: scout.light_sources importable" "pass"; else report "Python: scout.light_sources broken" "fail"; fi

PYTHONPATH=src GHOSTMARKET_DB=./data/ghostmarket.db python3 -c "from agents.scorer.main import score_product; print('ok')" 2>/dev/null
if [ $? -eq 0 ]; then report "Python: scorer.main importable" "pass"; else report "Python: scorer.main broken" "fail"; fi

echo ""

# --- API KEY VALIDATION ---
echo "--- API Keys ---"
GROQ_KEY=$(grep "^GROQ_API_KEY=" .env | cut -d'=' -f2-)
if [ -n "$GROQ_KEY" ]; then
  RESP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "https://api.groq.com/openai/v1/chat/completions" \
    -H "Authorization: Bearer $GROQ_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"hi"}],"max_tokens":5}')
  if [ "$RESP" == "200" ]; then report "Groq API key valid" "pass"; else report "Groq API key invalid (HTTP $RESP)" "fail"; fi
fi

TG_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" .env | cut -d'=' -f2-)
if [ -n "$TG_TOKEN" ]; then
  RESP=$(curl -s --max-time 10 "https://api.telegram.org/bot${TG_TOKEN}/getMe" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('ok') else 'fail')" 2>/dev/null)
  if [ "$RESP" == "ok" ]; then report "Telegram bot token valid" "pass"; else report "Telegram bot token invalid" "fail"; fi
fi

REP_KEY=$(grep "^REPLICATE_API_TOKEN=" .env | cut -d'=' -f2-)
if [ -n "$REP_KEY" ] && [[ "$REP_KEY" != your_* ]]; then
  RESP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -H "Authorization: Bearer $REP_KEY" "https://api.replicate.com/v1/account")
  if [ "$RESP" == "200" ]; then report "Replicate API key valid" "pass"; else report "Replicate API key invalid (HTTP $RESP)" "warn"; fi
fi

echo ""

# --- SUMMARY ---
echo "=========================================="
echo -e "  RESULTS: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${WARN} warnings${NC}"
echo "=========================================="

exit $FAIL
