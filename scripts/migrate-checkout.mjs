#!/usr/bin/env node
/**
 * Migrate existing landing pages to include checkout/waitlist section.
 * - Replaces final-cta section with gm-checkout waitlist form
 * - Rewires hero CTA from href="#order" to href="#gm-checkout"
 * - Injects checkout CSS styles into <head>
 * - Updates both files on disk and html_content in DB
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = process.env.GHOSTMARKET_DB || '/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db';
const PAGES_DIR = '/mnt/c/Users/Adham/ghostmarket/data/landing_pages';

const CHECKOUT_CSS = `
    .gm-checkout { padding: 48px 20px; text-align: center; background: #111; }
    .gm-checkout h2 { color: #fff; font-size: 1.6rem; margin-bottom: 20px; }
    .gm-buy-btn { display: inline-block; background: #FF6B00; color: #fff; padding: 18px 56px;
      border-radius: 8px; font-size: 1.3rem; font-weight: 800; text-decoration: none;
      text-transform: uppercase; letter-spacing: 1px; transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 20px rgba(255,107,0,0.4); }
    .gm-buy-btn:hover { transform: scale(1.05); box-shadow: 0 6px 28px rgba(255,107,0,0.6); }
    .gm-waitlist { max-width: 420px; margin: 0 auto; }
    .gm-waitlist p { color: #aaa; margin-bottom: 16px; font-size: 1rem; }
    .gm-waitlist-form { display: flex; gap: 8px; }
    .gm-waitlist-form input[type="email"] { flex: 1; padding: 14px 16px; border: 2px solid #333;
      border-radius: 8px; background: #1a1a1a; color: #fff; font-size: 1rem; outline: none; }
    .gm-waitlist-form input[type="email"]:focus { border-color: #FF6B00; }
    .gm-waitlist-form button { background: #FF6B00; color: #fff; border: none; padding: 14px 24px;
      border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; white-space: nowrap;
      transition: transform 0.2s; }
    .gm-waitlist-form button:hover { transform: scale(1.05); }
    .gm-waitlist-msg { margin-top: 12px; font-size: 0.95rem; }
    .gm-waitlist-msg.ok { color: #22C55E; }
    .gm-waitlist-msg.err { color: #DC2626; }`;

const MOBILE_CSS = `
    @media (max-width: 480px) {
      .gm-waitlist-form { flex-direction: column; }
      .gm-buy-btn { display: block; width: 100%; max-width: 320px; margin: 0 auto; padding: 16px 20px; font-size: 1.1rem; }
    }`;

function makeCheckoutSection(productId) {
  return `  <section class="gm-checkout" id="gm-checkout">
    <h2>Coming Soon &mdash; Join the Waitlist</h2>
    <div class="gm-waitlist">
      <p>Be the first to know when this drops. No spam, just one email.</p>
      <form class="gm-waitlist-form" id="gm-waitlist-form">
        <input type="email" name="email" placeholder="you@example.com" required />
        <button type="submit">Notify Me</button>
      </form>
      <div class="gm-waitlist-msg" id="gm-waitlist-msg"></div>
    </div>
  </section>
  <script>
  (function(){
    var form=document.getElementById('gm-waitlist-form');
    var msg=document.getElementById('gm-waitlist-msg');
    if(!form)return;
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var email=form.querySelector('input[name="email"]').value;
      msg.textContent='Signing up...';msg.className='gm-waitlist-msg';
      fetch('/api/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:email,product_id:"${productId}"})})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d.ok){msg.textContent="You're on the list!";msg.className='gm-waitlist-msg ok';form.reset();}
        else{msg.textContent=d.error||'Something went wrong';msg.className='gm-waitlist-msg err';}
      }).catch(function(){msg.textContent='Network error — try again';msg.className='gm-waitlist-msg err';});
    });
  })();
  </script>`;
}

function migrateHtml(html, productId) {
  // Skip if already migrated
  if (html.includes('gm-checkout')) return null;

  // Inject checkout CSS before </style> or before </head>
  if (html.includes('</style>')) {
    // Add mobile CSS for checkout if there's already a mobile block
    let cssToInject = CHECKOUT_CSS;
    // Check if there's an existing @media (max-width: 480px) block — add our rules inside
    html = html.replace('</style>', cssToInject + '\n  </style>');

    // Add mobile rules — inject before the last closing </style> after existing 480px block
    if (!html.includes('.gm-waitlist-form { flex-direction')) {
      html = html.replace('</style>', MOBILE_CSS + '\n  </style>');
    }
  }

  // Replace final-cta section with checkout section
  html = html.replace(
    /<section class="final-cta"[^>]*>[\s\S]*?<\/section>/,
    makeCheckoutSection(productId)
  );

  // Rewire hero CTA
  html = html.replace(/href="#order"/g, 'href="#gm-checkout"');
  html = html.replace(/<a\s+href="#"\s+class="cta"/g, '<a href="#gm-checkout" class="cta"');

  return html;
}

// Main
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Get all landing pages with their product IDs
const rows = db.prepare(`
  SELECT lp.id, lp.product_id, lp.html_path, lp.html_content
  FROM landing_pages lp
  WHERE lp.html_content IS NOT NULL OR lp.html_path IS NOT NULL
`).all();

let fileUpdated = 0;
let dbUpdated = 0;
let skipped = 0;

for (const row of rows) {
  const productId = row.product_id;

  // Update html_content in DB
  if (row.html_content) {
    const migrated = migrateHtml(row.html_content, productId);
    if (migrated) {
      db.prepare('UPDATE landing_pages SET html_content = ? WHERE id = ?').run(migrated, row.id);
      dbUpdated++;
    } else {
      skipped++;
    }
  }

  // Update file on disk
  if (row.html_path && fs.existsSync(row.html_path)) {
    const fileHtml = fs.readFileSync(row.html_path, 'utf-8');
    const migrated = migrateHtml(fileHtml, productId);
    if (migrated) {
      fs.writeFileSync(row.html_path, migrated);
      fileUpdated++;
    }
  }
}

// Also update any deploy copies
const deployDir = '/mnt/c/Users/Adham/ghostmarket/data/deploy';
if (fs.existsSync(deployDir)) {
  const productDirs = fs.readdirSync(deployDir);
  for (const pid of productDirs) {
    const pDir = path.join(deployDir, pid);
    if (!fs.statSync(pDir).isDirectory()) continue;
    const variants = fs.readdirSync(pDir);
    for (const v of variants) {
      const indexPath = path.join(pDir, v, 'index.html');
      if (fs.existsSync(indexPath)) {
        const html = fs.readFileSync(indexPath, 'utf-8');
        const migrated = migrateHtml(html, pid);
        if (migrated) {
          fs.writeFileSync(indexPath, migrated);
          fileUpdated++;
        }
      }
    }
  }
}

console.log(`Migration complete: ${dbUpdated} DB rows updated, ${fileUpdated} files updated, ${skipped} already migrated`);
db.close();
