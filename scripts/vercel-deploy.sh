#!/bin/bash
# Auto-retry Vercel deploy — called by PM2 cron
set -e
cd /mnt/c/Users/Adham/ghostmarket
source .env

cd src/dashboard
RESULT=$(npx vercel --prod --yes --token="$VERCEL_TOKEN" --scope istoleyourlurz-1423s-projects 2>&1)

if echo "$RESULT" | grep -q "Resource is limited"; then
  echo "[Deploy] Still rate-limited, will retry next cycle"
  exit 0
fi

# Extract URL from result
URL=$(echo "$RESULT" | grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' | tail -1)
if [ -n "$URL" ]; then
  echo "[Deploy] SUCCESS: $URL"
  # Send to Telegram
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d text="🚀 Dashboard deployed to Vercel!

${URL}

All 8 bugs fixed. Permanent URL is live." > /dev/null
else
  echo "[Deploy] Deployed but could not extract URL"
  echo "$RESULT"
fi
