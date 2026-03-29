#!/bin/bash
# GhostMarket Live Monitor
cd "$(dirname "$0")"

while true; do
  clear
  echo "╔══════════════════════════════════════╗"
  echo "║     GHOSTMARKET LIVE MONITOR        ║"
  echo "║     $(date '+%Y-%m-%d %H:%M:%S')           ║"
  echo "╚══════════════════════════════════════╝"
  echo ""

  # PM2 status (compact)
  pm2 jlist 2>/dev/null | python3 -c "
import sys,json
try:
  procs = json.load(sys.stdin)
  for p in procs:
    status = p['pm2_env']['status']
    icon = '🟢' if status == 'online' else '🔴'
    name = p['name']
    mem = round(p['monit']['memory'] / 1024 / 1024, 1)
    restarts = p['pm2_env']['restart_time']
    print(f'  {icon} {name:<16} {mem:>6}MB  restarts: {restarts}')
except: print('  ❌ PM2 not responding')
"

  echo ""
  echo "--- Database ---"
  sqlite3 data/ghostmarket.db "
    SELECT '  Products:     ' || COUNT(*) FROM products
    UNION ALL SELECT '  Signals:      ' || COUNT(*) FROM trend_signals
    UNION ALL SELECT '  LLM calls:    ' || COUNT(*) FROM llm_calls
    UNION ALL SELECT '  Scored:       ' || COUNT(*) FROM products WHERE score IS NOT NULL
    UNION ALL SELECT '  Approved:     ' || COUNT(*) FROM products WHERE stage = 'approved'
    UNION ALL SELECT '  Live:         ' || COUNT(*) FROM products WHERE stage = 'live';
  " 2>/dev/null

  echo ""
  echo "--- Last 5 Events ---"
  sqlite3 data/ghostmarket.db "SELECT datetime(created_at, 'localtime'), agent, event_type, substr(message,1,60) FROM system_events ORDER BY created_at DESC LIMIT 5;" 2>/dev/null

  echo ""
  echo "Press Ctrl+C to exit"
  sleep 30
done
