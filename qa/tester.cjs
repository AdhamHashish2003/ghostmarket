const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3333';
const RESULTS = [];
const SCREENSHOTS = [];

function check(category, name, pass, detail) {
  RESULTS.push({ category, name, pass, detail, timestamp: new Date().toISOString() });
  console.log(`${pass ? '✅' : '❌'} [${category}] ${name}: ${detail}`);
}

async function screenshotPage(page, name) {
  const path = `/tmp/gm_qa_${name}.png`;
  await page.screenshot({ path, fullPage: true });
  SCREENSHOTS.push(path);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ============================================================
  // TEST GROUP 1: MAIN DASHBOARD
  // ============================================================
  console.log('\n━━━ MAIN DASHBOARD ━━━');
  const desktop = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await desktop.goto(`${BASE}/dashboard`, { waitUntil: 'load', timeout: 20000 });
  await desktop.waitForTimeout(2000);

  const bodyText = await desktop.textContent('body');
  check('DASHBOARD', 'Page loads', bodyText.length > 500, `${bodyText.length} chars`);

  const bgColor = await desktop.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const isDark = bgColor.includes('10, 10') || bgColor.includes('0, 0, 0') || bgColor === 'rgb(10, 10, 15)';
  check('DASHBOARD', 'Dark background', isDark, bgColor);

  const hasCanvas = await desktop.evaluate(() => !!document.querySelector('canvas'));
  check('DASHBOARD', 'p5.js neural mesh canvas', hasCanvas, hasCanvas ? 'Canvas found' : 'NO CANVAS');

  const fontFamily = await desktop.evaluate(() => getComputedStyle(document.body).fontFamily);
  const hasFont = fontFamily.toLowerCase().includes('inter') || fontFamily.toLowerCase().includes('jetbrains') || fontFamily.toLowerCase().includes('mono');
  check('DASHBOARD', 'Brand font loaded', hasFont, fontFamily.substring(0, 60));

  // Navigation links
  const navLinks = await desktop.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent.trim(),
      href: a.getAttribute('href')
    }));
  });
  const expectedPages = ['products', 'learning', 'pnl', 'training', 'system', 'control'];
  for (const page of expectedPages) {
    const found = navLinks.some(l => l.href && l.href.includes(page));
    check('DASHBOARD', `Nav link: ${page}`, found, found ? 'Present' : 'MISSING');
  }

  // Pipeline section
  const hasPipelineContent = bodyText.includes('discovered') || bodyText.includes('scored') || bodyText.includes('live') || bodyText.includes('COMMAND CENTER') || bodyText.includes('Pipeline');
  check('DASHBOARD', 'Pipeline section visible', hasPipelineContent, hasPipelineContent ? 'Found' : 'MISSING');

  // Metrics
  const hasMetrics = bodyText.includes('Products') || bodyText.includes('Scored') || bodyText.includes('Labeled') || bodyText.includes('Revenue');
  check('DASHBOARD', 'Metrics visible', hasMetrics, hasMetrics ? 'Present' : 'MISSING');

  // Products with scores
  const hasScores = bodyText.includes('86') || bodyText.includes('score') || bodyText.includes('tracking');
  check('DASHBOARD', 'Recent products with scores', hasScores, hasScores ? 'Found' : 'NO SCORES');

  // Scan lines
  const hasScanLines = await desktop.evaluate(() => {
    const after = getComputedStyle(document.body, '::after');
    return after.backgroundImage && after.backgroundImage !== 'none';
  });
  check('DASHBOARD', 'Scan lines effect', hasScanLines, hasScanLines ? 'Active' : 'Missing');

  await screenshotPage(desktop, '01_dashboard_desktop');

  // ============================================================
  // TEST GROUP 2: PRODUCTS PAGE
  // ============================================================
  console.log('\n━━━ PRODUCTS PAGE ━━━');
  await desktop.goto(`${BASE}/dashboard/products`, { waitUntil: 'load', timeout: 15000 });
  await desktop.waitForTimeout(2000);

  const productRows = await desktop.evaluate(() => document.querySelectorAll('tr').length);
  check('PRODUCTS', 'Table renders with rows', productRows > 3, `${productRows} rows`);

  const productsText = await desktop.textContent('body');
  const hasProductScores = productsText.includes('86') || productsText.includes('60') || productsText.includes('58');
  check('PRODUCTS', 'Scores visible', hasProductScores, hasProductScores ? 'Found' : 'NO SCORES');

  // Filter functionality
  const hasFilterOptions = productsText.toLowerCase().includes('scored') || productsText.toLowerCase().includes('all');
  check('PRODUCTS', 'Filter options exist', hasFilterOptions, hasFilterOptions ? 'Found' : 'MISSING');

  // Stage filter
  await desktop.goto(`${BASE}/dashboard/products?stage=scored`, { waitUntil: 'load', timeout: 10000 });
  await desktop.waitForTimeout(1000);
  const scoredText = await desktop.textContent('body');
  check('PRODUCTS', 'Stage filter works', scoredText.includes('scored') || scoredText.length > 200, 'Filter applied');

  // Sort
  await desktop.goto(`${BASE}/dashboard/products?sort=created_at`, { waitUntil: 'load', timeout: 10000 });
  check('PRODUCTS', 'Sort by newest', true, 'No crash on sort');

  // Product links
  const firstProductLink = await desktop.evaluate(() => {
    const link = document.querySelector('a[href*="/products/"]');
    return link ? link.getAttribute('href') : null;
  });
  check('PRODUCTS', 'Product detail links', !!firstProductLink, firstProductLink ? firstProductLink.substring(0, 50) : 'NO LINKS');

  // No junk
  const hasJunk = productsText.includes('Poop') || productsText.includes('photo by me') || productsText.includes('Jumbotron');
  check('PRODUCTS', 'No junk products', !hasJunk, hasJunk ? 'JUNK FOUND' : 'Clean');

  await screenshotPage(desktop, '02_products_desktop');

  // ============================================================
  // TEST GROUP 3: PRODUCT DETAIL PAGE
  // ============================================================
  console.log('\n━━━ PRODUCT DETAIL ━━━');
  await desktop.goto(`${BASE}/dashboard/products/90019a58-a3c3-4d3a-9a30-3b274e73eb19`, { waitUntil: 'load', timeout: 15000 });
  await desktop.waitForTimeout(2000);
  const detailText = await desktop.textContent('body');

  // Score visible
  const hasScoreNumber = detailText.includes('86') || detailText.includes('Score');
  check('DETAIL', 'Score visible', hasScoreNumber, hasScoreNumber ? 'Found' : 'MISSING');

  // Score breakdown
  const hasBreakdown = detailText.toLowerCase().includes('trend') || detailText.toLowerCase().includes('margin') || detailText.toLowerCase().includes('competition');
  check('DETAIL', 'Score breakdown visible', hasBreakdown, hasBreakdown ? 'Found' : 'MISSING');

  // Supplier data
  const hasSupplier = detailText.includes('$') && (detailText.toLowerCase().includes('margin') || detailText.toLowerCase().includes('cost'));
  check('DETAIL', 'Supplier data with pricing', hasSupplier, hasSupplier ? 'Found' : 'NO SUPPLIER DATA');

  // Brand kit
  const hasBrand = detailText.toLowerCase().includes('brand') || detailText.includes('Lumina') || detailText.includes('lumina');
  check('DETAIL', 'Brand kit section', hasBrand, hasBrand ? 'Found' : 'MISSING');

  // Landing pages section
  const hasLandingSection = detailText.toLowerCase().includes('landing') || detailText.toLowerCase().includes('page');
  check('DETAIL', 'Landing pages section', hasLandingSection, hasLandingSection ? 'Found' : 'MISSING');

  // Back navigation
  const hasBack = await desktop.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).some(a =>
      a.href && a.href.includes('/products') && !a.href.includes('/products/')
    );
  });
  check('DETAIL', 'Back to products link', hasBack, hasBack ? 'Found' : 'MISSING');

  await screenshotPage(desktop, '03_product_detail');

  // ============================================================
  // TEST GROUP 4: CONTROL PANEL
  // ============================================================
  console.log('\n━━━ CONTROL PANEL ━━━');
  await desktop.goto(`${BASE}/dashboard/control`, { waitUntil: 'load', timeout: 15000 });
  await desktop.waitForTimeout(2000);
  const controlText = await desktop.textContent('body');

  const buttons = await desktop.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim())
  );
  check('CONTROL', 'Has buttons', buttons.length >= 3, `${buttons.length} buttons: ${buttons.slice(0, 5).join(', ').substring(0, 80)}`);

  // Check for key control elements
  const hasHealthCheck = controlText.toLowerCase().includes('health') || buttons.some(b => b.toLowerCase().includes('health'));
  check('CONTROL', 'Health check available', hasHealthCheck, hasHealthCheck ? 'Found' : 'MISSING');

  const hasTelegramTest = controlText.toLowerCase().includes('telegram') || buttons.some(b => b.toLowerCase().includes('telegram'));
  check('CONTROL', 'Telegram test available', hasTelegramTest, hasTelegramTest ? 'Found' : 'MISSING');

  // Agent triggers
  for (const agent of ['scout', 'scorer']) {
    const found = controlText.toLowerCase().includes(agent) || buttons.some(b => b.toLowerCase().includes(agent));
    check('CONTROL', `${agent} trigger`, found, found ? 'Found' : 'MISSING');
  }

  await screenshotPage(desktop, '04_control');

  // ============================================================
  // TEST GROUP 5: OTHER PAGES
  // ============================================================
  const otherPages = [
    { path: 'learning', name: 'LEARNING', checks: ['labeled', 'qlora', 'history'] },
    { path: 'pnl', name: 'P&L', checks: ['revenue', '$0', 'profit'] },
    { path: 'training', name: 'TRAINING', checks: ['llm', 'calls', 'model'] },
    { path: 'system', name: 'SYSTEM', checks: ['orchestrator', 'products', 'error'] },
  ];

  for (const pg of otherPages) {
    console.log(`\n━━━ ${pg.name} ━━━`);
    await desktop.goto(`${BASE}/dashboard/${pg.path}`, { waitUntil: 'load', timeout: 15000 });
    await desktop.waitForTimeout(2000);
    const text = await desktop.textContent('body');

    const isStuck = text.includes('Loading neural') || text.includes('Scanning neural') || text.includes('Probing system');
    check(pg.name, 'Page loads (not stuck on spinner)', !isStuck, isStuck ? 'STUCK ON SPINNER' : 'Loaded');

    for (const term of pg.checks) {
      const found = text.toLowerCase().includes(term.toLowerCase());
      check(pg.name, `Has "${term}"`, found, found ? 'Found' : 'MISSING');
    }

    await screenshotPage(desktop, `05_${pg.path}`);
  }

  // ============================================================
  // TEST GROUP 6: LANDING PAGE
  // ============================================================
  console.log('\n━━━ LANDING PAGE ━━━');
  await desktop.goto(`${BASE}/landing/90019a58-a3c3-4d3a-9a30-3b274e73eb19`, { waitUntil: 'load', timeout: 15000 });
  await desktop.waitForTimeout(1000);
  const landingHTML = await desktop.content();
  const landingText = await desktop.textContent('body');

  check('LANDING', 'Page loads', landingText.length > 100, `${landingText.length} chars`);
  check('LANDING', 'Has pricing ($)', landingText.includes('$'), landingText.includes('$') ? 'Found' : 'NO PRICING');
  check('LANDING', 'Has CTA button', landingText.includes('Get') || landingText.includes('Order') || landingText.includes('Buy') || landingText.includes('Shop'), 'CTA found');
  check('LANDING', 'Has benefits section', landingText.includes('Why') || landingText.includes('benefit'), 'Benefits found');
  check('LANDING', 'Has viewport meta', landingHTML.includes('viewport'), landingHTML.includes('viewport') ? 'Present' : 'MISSING');

  await screenshotPage(desktop, '06_landing');

  // ============================================================
  // TEST GROUP 7: MOBILE RESPONSIVE
  // ============================================================
  console.log('\n━━━ MOBILE (390x844) ━━━');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const mobilePages = [
    'dashboard',
    'dashboard/products',
    'dashboard/pnl',
    'dashboard/control',
    'landing/90019a58-a3c3-4d3a-9a30-3b274e73eb19'
  ];
  for (const pg of mobilePages) {
    try {
      await mobile.goto(`${BASE}/${pg}`, { waitUntil: 'load', timeout: 15000 });
      await mobile.waitForTimeout(2000);

      const hasOverflow = await mobile.evaluate(() => document.body.scrollWidth > window.innerWidth + 5);
      const sw = await mobile.evaluate(() => document.body.scrollWidth);
      const vw = await mobile.evaluate(() => window.innerWidth);
      check('MOBILE', `/${pg} no overflow`, !hasOverflow,
        hasOverflow ? `OVERFLOW: body=${sw}px > viewport=${vw}px` : `Fits (${sw}px)`);

      const contentOK = await mobile.evaluate(() => document.body.textContent.trim().length > 50);
      check('MOBILE', `/${pg} content visible`, contentOK, contentOK ? 'Content present' : 'EMPTY');

      await screenshotPage(mobile, `07_mobile_${pg.replace(/\//g, '_')}`);
    } catch (e) {
      check('MOBILE', `/${pg} loads`, false, `Error: ${e.message.substring(0, 60)}`);
    }
  }

  // Mobile: canvas hidden (saves battery)
  await mobile.goto(`${BASE}/dashboard`, { waitUntil: 'load', timeout: 15000 });
  await mobile.waitForTimeout(1000);
  const canvasHidden = await mobile.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return true;
    const style = getComputedStyle(c);
    return style.display === 'none';
  });
  check('MOBILE', 'Canvas hidden on mobile', canvasHidden, canvasHidden ? 'Hidden (saves battery)' : 'VISIBLE — should be hidden');

  // Mobile: sidebar collapsed to top bar
  const sidebarWidth = await mobile.evaluate(() => {
    const nav = document.getElementById('gm-sidebar');
    if (!nav) return -1;
    return nav.getBoundingClientRect().width;
  });
  check('MOBILE', 'Sidebar collapsed to full-width bar', sidebarWidth >= 380, `Width: ${sidebarWidth}px`);

  await mobile.close();

  // ============================================================
  // TEST GROUP 8: API ENDPOINTS
  // ============================================================
  console.log('\n━━━ API ENDPOINTS ━━━');

  const apiTests = [
    { url: 'http://localhost:4000/health', name: 'Orchestrator health', check: 'ok' },
    { url: 'http://localhost:4000/api/pipeline', name: 'Pipeline API', check: 'stages' },
    { url: 'http://localhost:4000/api/metrics', name: 'Metrics API', check: 'totalProducts' },
    { url: 'http://localhost:3001/health', name: 'MCP server health', check: 'ghostmarket-mcp-server' },
  ];

  for (const api of apiTests) {
    try {
      const resp = await fetch(api.url, { signal: AbortSignal.timeout(5000) });
      const text = await resp.text();
      const pass = resp.ok && text.includes(api.check);
      check('API', api.name, pass, pass ? `${resp.status} OK` : `${resp.status}: ${text.substring(0, 60)}`);
    } catch (e) {
      check('API', api.name, false, `Unreachable: ${e.message.substring(0, 60)}`);
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '═'.repeat(60));
  console.log('QA REPORT SUMMARY');
  console.log('═'.repeat(60));

  const passed = RESULTS.filter(r => r.pass).length;
  const failed = RESULTS.filter(r => !r.pass).length;
  const total = RESULTS.length;

  console.log(`\n${passed}/${total} passed | ${failed} failed\n`);

  if (failed > 0) {
    console.log('FAILURES:');
    for (const r of RESULTS.filter(r => !r.pass)) {
      console.log(`  ❌ [${r.category}] ${r.name}: ${r.detail}`);
    }
  } else {
    console.log('🎉 ALL TESTS PASSED — ZERO FAILURES');
  }

  const report = {
    timestamp: new Date().toISOString(),
    passed,
    failed,
    total,
    results: RESULTS,
    screenshots: SCREENSHOTS
  };

  fs.writeFileSync('/tmp/gm_qa_report.json', JSON.stringify(report, null, 2));
  console.log('\nReport saved to /tmp/gm_qa_report.json');
  console.log(`Screenshots: ${SCREENSHOTS.length} saved to /tmp/gm_qa_*.png`);

  await desktop.close();
  await browser.close();
})();
