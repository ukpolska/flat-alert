// Shared logic: fetch Otodom, filter, normalise, notify via ntfy.
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
if (process.env.NTFY_TOPIC) cfg.ntfyTopic = process.env.NTFY_TOPIC; // keeps the topic out of a public repo

const UA = 'Mozilla/5.0 (personal listing alert; low-frequency)';
const BASE = 'https://www.otodom.pl';
const SEARCH = `${BASE}/pl/wyniki/sprzedaz/mieszkanie/mazowieckie/warszawa/warszawa/warszawa/ursynow`;
const ROOMS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6 };
const names = (it, level) => (it.location?.reverseGeocoding?.locations || [])
  .filter(l => l.locationLevel === level).map(l => l.name);

function matches(it) {
  const area = names(it, 'residential').join(' ').toLowerCase();
  if (cfg.excludeAreas.some(x => area.includes(x.toLowerCase()))) return false;
  return names(it, 'district').includes(cfg.districtName)
    || cfg.extraAreaMatches.some(x => area.includes(x.toLowerCase()));
}

function normalise(it) {
  return {
    id: String(it.id),
    title: it.title,
    price: it.totalPrice?.value ?? null,
    area: it.areaInSquareMeters ?? null,
    rooms: ROOMS[it.roomsNumber] ?? null,
    pricePerM2: it.pricePerSquareMeter?.value ? Math.round(it.pricePerSquareMeter.value) : null,
    sub: names(it, 'residential').join(', '),
    street: it.location?.address?.street?.name || '',
    created: it.createdAtFirst || it.dateCreated,
    url: `${BASE}/pl/oferta/${it.slug}`,
    image: it.images?.[0]?.medium || null,
  };
}

async function fetchPage(page) {
  const q = new URLSearchParams({
    limit: '72', priceMax: String(cfg.priceMax), by: 'LATEST', direction: 'DESC', page: String(page),
  });
  const res = await fetch(`${SEARCH}?${q}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'pl' } });
  if (!res.ok) throw new Error(`Otodom HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!m) throw new Error('Otodom page had no listing data (layout changed or blocked)');
  const ads = JSON.parse(m[1]).props.pageProps.data.searchAds;
  return { items: ads.items, totalPages: ads.pagination.totalPages };
}

const b64 = s => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

async function notify(l, isTest = false) {
  const price = l.price ? `${l.price.toLocaleString('pl-PL')} zł` : 'cena brak';
  const body = [`${l.area ?? '?'} m² · ${l.rooms ?? '?'} pok. · ${l.pricePerM2 ?? '?'} zł/m²`,
    [l.sub, l.street].filter(Boolean).join(' · ')].join('\n');
  const res = await fetch(`${cfg.ntfyServer}/${cfg.ntfyTopic}`, {
    method: 'POST',
    headers: { Title: b64(`${isTest ? '[TEST] ' : 'Nowe: '}${price}`), Priority: '4', Tags: 'house', Click: l.url },
    body,
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

// One check. Mutates db; the first ever run records listings silently.
async function runOnce(db, { send = true } = {}) {
  const found = [];
  const ids = new Set();
  let totalPages = 1;
  for (let p = 1; p <= Math.min(totalPages, cfg.maxPages); p++) {
    const r = await fetchPage(p);
    totalPages = r.totalPages;
    for (const it of r.items) {
      if (it.estate === 'FLAT' && matches(it) && !ids.has(String(it.id))) { ids.add(String(it.id)); found.push(normalise(it)); }
    }
    if (p < Math.min(totalPages, cfg.maxPages)) await new Promise(r => setTimeout(r, 2000));
  }
  const fresh = found.filter(l => !db.listings[l.id]);
  const now = new Date().toISOString();
  for (const l of fresh) db.listings[l.id] = { ...l, firstSeen: now };
  const seed = !db.initialized;
  db.initialized = true;
  db.lastCheck = now;
  let notifyError = null;
  if (!seed && send) {
    for (const l of [...fresh].reverse()) { // oldest first, newest ends on top
      try { await notify(l); } catch (e) { notifyError = 'ntfy: ' + e.message; }
    }
  }
  return { found: found.length, fresh: fresh.length, seed, now, notifyError };
}

module.exports = { cfg, runOnce, notify, BASE };
