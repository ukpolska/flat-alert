// Shared logic: run all sources, drop cross-site duplicates, notify via ntfy.
const fs = require('fs');
const path = require('path');
const sources = require('./sources');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
if (process.env.NTFY_TOPIC) cfg.ntfyTopic = process.env.NTFY_TOPIC; // keeps the topic out of a public repo

const BASE = 'https://www.otodom.pl';
const LABEL = { otodom: 'Otodom', olx: 'OLX', morizon: 'Morizon', gratka: 'Gratka' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = s => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

async function notify(l, isTest = false) {
  const price = l.price ? `${l.price.toLocaleString('pl-PL')} zł` : 'cena brak';
  const body = [`${l.area ?? '?'} m² · ${l.rooms ?? '?'} pok. · ${l.pricePerM2 ?? '?'} zł/m²`,
    [l.sub, l.street].filter(Boolean).join(' · '),
    `Źródło: ${LABEL[l.source] || l.source || 'test'}`].join('\n');
  const res = await fetch(`${cfg.ntfyServer}/${cfg.ntfyTopic}`, {
    method: 'POST',
    headers: { Title: b64(`${isTest ? '[TEST] ' : 'Nowe: '}${price}`), Priority: '4', Tags: 'house', Click: l.url },
    body,
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

// Same flat on another portal: same price and (nearly) the same area. Only compared across
// different sources, so two different flats on one portal are never merged.
const sameFlat = (a, b) => a.source !== b.source && a.price != null && a.price === b.price
  && a.area != null && b.area != null && Math.abs(a.area - b.area) <= 0.6;

function migrate(db) {
  db.sources = db.sources || {};
  if (db.initialized && !db.sources.otodom) db.sources.otodom = true; // state from the Otodom-only version
  for (const [oldId, l] of Object.entries({ ...db.listings })) {
    if (l.source) continue;
    delete db.listings[oldId];
    db.listings[`otodom:${l.id}`] = { ...l, source: 'otodom' };
  }
}

// One check. Mutates db. A source seen for the first time is recorded silently, so adding a
// portal never floods the phone with its existing listings.
async function runOnce(db, { send = true } = {}) {
  migrate(db);
  const now = new Date().toISOString();
  const errors = {}, counts = {}, seeded = [];
  const fresh = [];
  const known = Object.values(db.listings);
  let first = true;
  for (const name of cfg.sources) {
    if (!first) await sleep(2000);
    first = false;
    let list;
    try { list = await sources[name](cfg); } catch (e) { errors[name] = e.message; continue; }
    counts[name] = list.length;
    const seed = !db.sources[name];
    if (seed) seeded.push(name);
    for (const raw of list) {
      const gid = `${name}:${raw.id}`;
      if (db.listings[gid]) continue;
      const l = { ...raw, id: raw.id, source: name, firstSeen: now };
      // One-to-one matching: an original can be the twin of at most one listing per other site,
      // so a developer's identical units are never mistaken for copies of each other.
      const dup = known.find(k => !k.duplicateOf && sameFlat(k, l) && !(k.twinSources || []).includes(name));
      if (dup) { l.duplicateOf = `${dup.source}:${dup.id}`; (dup.twinSources ||= []).push(name); }
      db.listings[gid] = l;
      known.push(l);
      if (!seed && !dup) fresh.push(l);
    }
    db.sources[name] = true;
  }
  db.initialized = true;
  db.lastCheck = now;
  db.errors = errors;
  let notifyError = null;
  if (send) {
    for (const l of [...fresh].reverse()) { // oldest first, newest ends on top
      try { await notify(l); } catch (e) { notifyError = 'ntfy: ' + e.message; }
    }
  }
  return { now, counts, errors, seeded, fresh: fresh.length, notifyError };
}

module.exports = { cfg, runOnce, notify, BASE };
