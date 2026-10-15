// Local mode: polls on a timer and serves a small dashboard. Needs Node 18+, no dependencies.
// (For always-on use without a PC, see .github/workflows/check.yml and check.js.)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { cfg, runOnce, notify, BASE } = require('./lib');

const DIR = __dirname;
const DB_FILE = path.join(DIR, 'seen.json');
let db = { initialized: false, listings: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
const state = { lastRun: null, lastError: null, lastCount: 0 };

let running = false;
async function poll() {
  if (running) return;
  running = true;
  try {
    const r = await runOnce(db);
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
    state.lastRun = r.now; state.lastCount = Object.values(r.counts).reduce((a, b) => a + b, 0);
    state.lastError = r.notifyError || Object.entries(r.errors).map(([n, e]) => `${n}: ${e}`).join('; ') || null;
    console.log(`${r.now} counts=${JSON.stringify(r.counts)} new=${r.fresh} seeded=[${r.seeded}]`);
  } catch (e) {
    state.lastError = e.message;
    console.error(new Date().toISOString(), e.message);
  } finally { running = false; }
}

const server = http.createServer(async (req, res) => {
  const json = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/api/listings') {
    const list = Object.values(db.listings).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
    return json({ state, topic: cfg.ntfyTopic, server: cfg.ntfyServer, priceMax: cfg.priceMax, listings: list });
  }
  if (req.url === '/api/test' && req.method === 'POST') {
    try {
      await notify({ price: 799000, area: 50, rooms: 2, pricePerM2: 15980, sub: 'Natolin', street: 'Test', url: BASE }, true);
      return json({ ok: true });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(DIR, 'public', 'index.html')));
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(cfg.port, () => {
  console.log(`Dashboard: http://localhost:${cfg.port}`);
  poll();
  setInterval(poll, cfg.intervalMinutes * 60 * 1000);
});
