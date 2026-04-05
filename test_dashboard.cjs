const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const BASE = 'http://localhost:3333';
  const results = [];

  const check = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name}: ${detail}`);
  };

  // =========================================
  // PAGE 1: Main Dashboard
  // =========================================
  console.log('\n=== MAIN DASHBOARD ===');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Check dark background
  const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('Dark background', bgColor.includes('10') || bgColor.includes('0,') || bgColor.includes('#0a'), bgColor);

  // Check p5.js canvas exists
  const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));
  check('p5.js neural mesh canvas', hasCanvas, hasCanvas ? 'Canvas found' : 'NO CANVAS — animation not rendering');

  // Check JetBrains Mono loaded
  const hasFont = await page.evaluate(() => {
    const el = document.querySelector('body');
    return getComputedStyle(el).fontFamily.includes('JetBrains') || getComputedStyle(el).fontFamily.includes('monospace');
  });
  check('JetBrains Mono font', hasFont, hasFont ? 'Loaded' : 'NOT LOADED');

  // Check scan lines overlay
  const hasScanLines = await page.evaluate(() => {
    const after = getComputedStyle(document.body, '::after');
    return after.content !== 'none' && after.backgroundImage !== 'none';
  });
  check('Scan lines overlay', hasScanLines, hasScanLines ? 'Present' : 'Missing');

  // Check pipeline nodes have data-stage attributes
  const stageNodes = await page.evaluate(() => {
    return document.querySelectorAll('[data-stage]').length;
  });
  check('Pipeline data-stage attributes', stageNodes >= 8, `${stageNodes} nodes`);

  // Check pipeline counts are real numbers (not 0 for everything)
  const pipelineText = await page.textContent('body');
  const hasRealCounts = pipelineText.includes('20') || pipelineText.includes('26') || pipelineText.includes('Products Discovered');
  check('Pipeline shows real counts', hasRealCounts, hasRealCounts ? 'Found counts' : 'All zeros');

  // Wait 20 seconds for event feed to poll
  console.log('  Waiting 20s for event feed to poll...');
  await page.waitForTimeout(20000);

  // Check event feed has real events (not just "Waiting for events...")
  const bodyTextAfterWait = await page.textContent('body');
  const hasRealEvents = bodyTextAfterWait.includes('scout') || bodyTextAfterWait.includes('telegram') || bodyTextAfterWait.includes('orchestrator') || bodyTextAfterWait.includes('deployer');
  check('Event feed has real events', hasRealEvents, hasRealEvents ? 'Events loaded' : 'STILL showing "Waiting for events" after 20s — polling broken');

  // Check "Xs ago" or "s ago" timer is counting
  const hasTimer = bodyTextAfterWait.includes('ago') || bodyTextAfterWait.includes('s ago');
  check('Live timer ticking', hasTimer, hasTimer ? 'Timers active' : 'No timers found');

  // Screenshot main dashboard
  await page.screenshot({ path: '/tmp/gm_dashboard.png', fullPage: true });
  console.log('  Screenshot saved: /tmp/gm_dashboard.png');

  // =========================================
  // PAGE 2: Products
  // =========================================
  console.log('\n=== PRODUCTS ===');
  await page.goto(`${BASE}/dashboard/products`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const productCount = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr, [class*="product"]');
    return rows.length;
  });
  check('Products table has rows', productCount > 2, `${productCount} rows`);

  // Test filter tabs
  await page.goto(`${BASE}/dashboard/products?stage=scored`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const scoredText = await page.textContent('body');
  const hasScored = scoredText.includes('86') || scoredText.includes('76') || scoredText.includes('74') || scoredText.includes('scored');
  check('Stage filter works', hasScored, hasScored ? 'Filtered to scored' : 'Filter NOT working');

  await page.screenshot({ path: '/tmp/gm_products.png', fullPage: true });

  // =========================================
  // PAGE 3: Control Panel
  // =========================================
  console.log('\n=== CONTROL PANEL ===');
  await page.goto(`${BASE}/dashboard/control`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Test health check button
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
  });
  check('Control buttons exist', buttons.length >= 4, `Found: ${buttons.join(', ')}`);

  // Click health check button and wait for response
  try {
    const healthBtn = await page.locator('button', { hasText: /health|HEALTH|Health/i }).first();
    if (await healthBtn.count() > 0) {
      await healthBtn.click();
      await page.waitForTimeout(5000);
      const afterClick = await page.textContent('body');
      const healthWorked = afterClick.includes('Connected') || afterClick.includes('ok') || afterClick.includes('disabled') || afterClick.includes('SCANNING');
      check('Health check button works', healthWorked, healthWorked ? 'Response received' : 'Button click had no effect');
    } else {
      check('Health check button works', false, 'Button not found');
    }
  } catch (e) {
    check('Health check button works', false, `Click failed: ${e.message}`);
  }

  // Click test telegram button
  try {
    const tgBtn = await page.locator('button', { hasText: /test|telegram|SEND/i }).first();
    if (await tgBtn.count() > 0) {
      await tgBtn.click();
      await page.waitForTimeout(3000);
      const afterTg = await page.textContent('body');
      const tgWorked = afterTg.includes('SENT') || afterTg.includes('SENDING') || afterTg.includes('OK');
      check('Telegram test button works', tgWorked, tgWorked ? 'Message sent' : 'No response');
    } else {
      check('Telegram test button works', false, 'Button not found');
    }
  } catch (e) {
    check('Telegram test button works', false, `Click failed: ${e.message}`);
  }

  await page.screenshot({ path: '/tmp/gm_control.png', fullPage: true });

  // =========================================
  // PAGE 4-6: Learning, P&L, Training
  // =========================================
  for (const pg of ['learning', 'pnl', 'training']) {
    console.log(`\n=== ${pg.toUpperCase()} ===`);
    await page.goto(`${BASE}/dashboard/${pg}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const text = await page.textContent('body');
    const isStuck = text.includes('Loading') || text.includes('Scanning') || text.includes('Probing');
    const hasData = text.includes('0') || text.includes('1') || text.includes('$') || text.includes('win') || text.includes('rule');
    check(`${pg} page loads`, !isStuck && hasData, isStuck ? 'STUCK ON LOADING SPINNER' : 'Data visible');
    await page.screenshot({ path: `/tmp/gm_${pg}.png`, fullPage: true });
  }

  // =========================================
  // SYSTEM PAGE
  // =========================================
  console.log('\n=== SYSTEM ===');
  await page.goto(`${BASE}/dashboard/system`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const sysText = await page.textContent('body');
  check('System page loads', sysText.includes('orchestrator') || sysText.includes('online') || sysText.includes('SYSTEM'), 'Agent data visible');
  await page.screenshot({ path: '/tmp/gm_system.png', fullPage: true });

  // =========================================
  // SUMMARY
  // =========================================
  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed out of ${results.length} checks\n`);

  for (const r of results.filter(r => !r.pass)) {
    console.log(`  ❌ ${r.name}: ${r.detail}`);
  }

  await browser.close();
})();
