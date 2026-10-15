// One reader per portal. Each returns normalised listings:
// { id, title, price, area, rooms, pricePerM2, sub, street, created, url, image }
// Only public search pages are requested, slowly, with a plain descriptive User-Agent.
// No attempt is made to get past any bot check: if a site refuses, that source just reports an error.
const UA = 'Mozilla/5.0 (personal listing alert; low-frequency)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pl' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const ROOMS_WORDS = { one: 1, two: 2, three: 3, four: 4 };
const ROOMS_OTODOM = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6 };

// ---------- Otodom ----------
const OTODOM = 'https://www.otodom.pl';
const otoNames = (it, level) => (it.location?.reverseGeocoding?.locations || [])
  .filter(l => l.locationLevel === level).map(l => l.name);

async function otodom(cfg) {
  const out = [];
  let totalPages = 1;
  for (let p = 1; p <= Math.min(totalPages, cfg.maxPages); p++) {
    const q = new URLSearchParams({ limit: '72', priceMax: String(cfg.priceMax), by: 'LATEST', direction: 'DESC', page: String(p) });
    const html = await get(`${OTODOM}/pl/wyniki/sprzedaz/mieszkanie/mazowieckie/warszawa/warszawa/warszawa/ursynow?${q}`);
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!m) throw new Error('no listing data in page (layout changed or blocked)');
    const ads = JSON.parse(m[1]).props.pageProps.data.searchAds;
    totalPages = ads.pagination.totalPages;
    for (const it of ads.items) {
      const area = otoNames(it, 'residential').join(' ').toLowerCase();
      if (it.estate !== 'FLAT') continue;
      if (cfg.excludeAreas.some(x => area.includes(x.toLowerCase()))) continue;
      const ok = otoNames(it, 'district').includes(cfg.districtName)
        || cfg.extraAreaMatches.some(x => area.includes(x.toLowerCase()));
      if (!ok) continue;
      out.push({
        id: String(it.id), title: it.title, price: it.totalPrice?.value ?? null,
        area: it.areaInSquareMeters ?? null, rooms: ROOMS_OTODOM[it.roomsNumber] ?? null,
        pricePerM2: it.pricePerSquareMeter?.value ? Math.round(it.pricePerSquareMeter.value) : null,
        sub: otoNames(it, 'residential').join(', '), street: it.location?.address?.street?.name || '',
        created: it.createdAtFirst || it.dateCreated, url: `${OTODOM}/pl/oferta/${it.slug}`,
        image: it.images?.[0]?.medium || null,
      });
    }
    if (p < Math.min(totalPages, cfg.maxPages)) await sleep(2000);
  }
  return out;
}

// ---------- OLX ----------
const OLX_DISTRICT_URSYNOW = 373; // from OLX's own district facet on the search page

async function olx(cfg) {
  const out = [];
  let totalPages = 1;
  for (let p = 1; p <= Math.min(totalPages, cfg.maxPages); p++) {
    const q = `search%5Bdistrict_id%5D=${OLX_DISTRICT_URSYNOW}&search%5Bfilter_float_price%3Ato%5D=${cfg.priceMax}&search%5Border%5D=created_at%3Adesc${p > 1 ? `&page=${p}` : ''}`;
    const html = await get(`https://www.olx.pl/nieruchomosci/mieszkania/sprzedaz/warszawa/?${q}`);
    const m = html.match(/window\.__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*");/);
    if (!m) throw new Error('no listing data in page (layout changed or blocked)');
    const listing = JSON.parse(JSON.parse(m[1])).listing.listing;
    totalPages = listing.totalPages || 1;
    for (const ad of listing.ads || []) {
      if (!ad.isActive || ad.isJob || !ad.url) continue;
      const par = k => ad.params?.find(x => x.key === k)?.normalizedValue;
      const district = ad.location?.districtName;
      if (district && district !== cfg.districtName) continue;
      const price = ad.price?.regularPrice?.value ?? null;
      if (price == null || price > cfg.priceMax) continue;
      const area = parseFloat(par('m'));
      out.push({
        id: String(ad.id), title: ad.title, price,
        area: Number.isFinite(area) ? area : null, rooms: ROOMS_WORDS[par('rooms')] ?? null,
        pricePerM2: par('price_per_m') ? Math.round(parseFloat(par('price_per_m'))) : null,
        sub: district || '', street: '', created: ad.createdTime, url: ad.url,
        image: ad.photos?.[0] ? String(ad.photos[0]).split(';')[0] : null,
      });
    }
    if (p < Math.min(totalPages, cfg.maxPages)) await sleep(2000);
  }
  return out;
}

// ---------- Morizon & Gratka (same site family; listings are in JSON-LD) ----------
function ldOffers(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>(.*?)<\/script>/gs)) {
    try {
      const d = JSON.parse(m[1]);
      if (d['@type'] === 'Product' && d.offers?.offers) return d.offers.offers;
    } catch {}
  }
  throw new Error('no listing data in page (layout changed or blocked)');
}

async function ldPortal(cfg, urlFor, idFrom) {
  const out = [];
  for (let p = 1; p <= cfg.maxPages; p++) {
    const offers = ldOffers(await get(urlFor(p)));
    if (!offers.length) break;
    for (const o of offers) {
      const it = o.itemOffered || {};
      const price = parseFloat(o.price);
      const id = idFrom(o.url);
      if (!id || !Number.isFinite(price) || price > cfg.priceMax) continue;
      if (it.address?.addressLocality && it.address.addressLocality !== cfg.districtName) continue;
      const area = parseFloat(it.floorSize?.value);
      out.push({
        id, title: o.name, price, area: Number.isFinite(area) ? area : null,
        rooms: it.numberOfRooms ?? null, pricePerM2: Number.isFinite(area) && area > 0 ? Math.round(price / area) : null,
        sub: it.address?.addressLocality || '', street: it.address?.streetAddress || '',
        created: null, url: o.url, image: o.image || null,
      });
    }
    if (p < cfg.maxPages) await sleep(2000);
  }
  return out;
}

const morizon = cfg => ldPortal(cfg,
  p => `https://www.morizon.pl/mieszkania/najnowsze/warszawa/ursynow/?ps%5Bprice_to%5D=${cfg.priceMax}${p > 1 ? `&page=${p}` : ''}`,
  url => url.match(/mzn(\d+)/)?.[1]);

const gratka = cfg => ldPortal(cfg,
  p => `https://gratka.pl/nieruchomosci/mieszkania/warszawa/ursynow?cena-calkowita:max=${cfg.priceMax}&sort=newest${p > 1 ? `&page=${p}` : ''}`,
  url => url.match(/\/ob\/(\d+)/)?.[1]);

module.exports = { otodom, olx, morizon, gratka };
