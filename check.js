// Single check, for scheduled runs (GitHub Actions). Keeps state in seen.json.
const fs = require('fs');
const path = require('path');
const { runOnce } = require('./lib');

const DB_FILE = path.join(__dirname, 'seen.json');
let db = { initialized: false, listings: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}

(async () => {
  const r = await runOnce(db);
  // Prune listings not seen for 90 days is unnecessary at this size; keep everything.
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
  console.log(`${r.now} matched=${r.found} new=${r.seed ? '(seeded)' : r.fresh}`);
  if (r.notifyError) { console.error(r.notifyError); process.exit(1); }
})().catch(e => { console.error(e.message); process.exit(1); });
