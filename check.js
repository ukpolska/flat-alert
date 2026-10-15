// Single check, for scheduled runs (GitHub Actions). Keeps state in seen.json.
const fs = require('fs');
const path = require('path');
const { cfg, runOnce } = require('./lib');

const DB_FILE = path.join(__dirname, 'seen.json');
let db = { initialized: false, listings: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}

(async () => {
  const r = await runOnce(db);
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
  console.log(`${r.now} counts=${JSON.stringify(r.counts)} new=${r.fresh} seeded=[${r.seeded}]`);
  for (const [n, e] of Object.entries(r.errors)) console.error(`source ${n} failed: ${e}`);
  // Fail the run (so GitHub flags it) only if every source failed or the phone push failed.
  if (Object.keys(r.errors).length >= cfg.sources.length || r.notifyError) {
    if (r.notifyError) console.error(r.notifyError);
    process.exit(1);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
