const Database = require('better-sqlite3');
const db = new Database('/mnt/c/Users/Adham/ghostmarket/data/ghostmarket.db', { readonly: true });
console.log('Products:', db.prepare('SELECT COUNT(*) as c FROM products').get());
console.log('Signals:', db.prepare('SELECT COUNT(*) as c FROM trend_signals').get());
console.log('Scored:', db.prepare('SELECT COUNT(*) as c FROM products WHERE score IS NOT NULL').get());
db.close();
