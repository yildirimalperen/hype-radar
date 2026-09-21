import { openDb } from './db.js';
import { COUNTRIES, CHART_DEPTH } from './config.js';

const CW = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.weight]));
const MISSING_RANK = CHART_DEPTH + 25; // chart dışındaki oyun için varsayılan "sıra"
const DAY = 86_400_000;

// Bileşen ağırlıkları. Bir bileşen ölçülemezse (ör. ilk koşuda pencere ivmesi yok)
// ağırlığı kalanlara yeniden dağıtılır — eksik veri oyunu cezalandırmaz.
export const WEIGHTS = {
  rankMomentum: 0.26,   // pencere içi sıra ivmesi (log-rank)
  downloadVelocity: 0.18, // pencere içi indirme/rating hızı
  lifetimeVelocity: 0.16, // çıkıştan bu yana ortalama hız — tek snapshot'ta da çalışır
  breadth: 0.12,        // kaç ülkede chart'ta
  newEntry: 0.10,       // chart'a ilk giriş
  monetization: 0.12,   // grossing gücü
  youth: 0.06,          // yeni oyun çarpanı
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Kohort içi yüzdelik sıra — aykırı değerlere dayanıklı normalizasyon. */
function percentileMap(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return (v) => {
    if (!Number.isFinite(v) || !sorted.length) return null;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
    return sorted.length === 1 ? 0.5 : lo / (sorted.length - 1);
  };
}

function loadSnapshot(db, snapshotId) {
  const ranks = db.prepare('SELECT app_id, country, chart, rank FROM ranks WHERE snapshot_id = ?').all(snapshotId);
  const metrics = db.prepare('SELECT * FROM app_metrics WHERE snapshot_id = ?').all(snapshotId);
  const byApp = new Map();
  for (const r of ranks) {
    if (!byApp.has(r.app_id)) byApp.set(r.app_id, { ranks: [], metric: null });
    byApp.get(r.app_id).ranks.push(r);
  }
  for (const m of metrics) {
    if (!byApp.has(m.app_id)) byApp.set(m.app_id, { ranks: [], metric: null });
    byApp.get(m.app_id).metric = m;
  }
  return byApp;
}

/**
 * İki chart-sıra kümesi arasında ağırlıklı log-rank ivmesi.
 * log kullanmanın sebebi: 60→10 hareketi 95→85'ten kıyasla çok daha büyük sayılmalı.
 */
function rankMomentum(prevRanks, nowRanks, chart) {
  const prev = new Map(prevRanks.filter((r) => r.chart === chart).map((r) => [r.country, r.rank]));
  const now = new Map(nowRanks.filter((r) => r.chart === chart).map((r) => [r.country, r.rank]));
  const countries = new Set([...prev.keys(), ...now.keys()]);
  if (!countries.size) return null;
  let num = 0, den = 0;
  for (const c of countries) {
    const w = CW[c] ?? 0.5;
    const p = prev.get(c) ?? MISSING_RANK;
    const n = now.get(c) ?? MISSING_RANK;
    num += w * (Math.log(p) - Math.log(n));
    den += w;
  }
  return num / den;
}

function daysBetween(a, b) {
  return Math.max(1 / 24, (new Date(b) - new Date(a)) / DAY);
}

export function computeScores(db, { snapshotId, prevSnapshotId } = {}) {
  const snaps = db.prepare("SELECT id, taken_at FROM snapshots WHERE status='ok' ORDER BY id DESC").all();
  if (!snaps.length) throw new Error('tamamlanmış snapshot yok');
  const cur = snapshotId ? snaps.find((s) => s.id === snapshotId) : snaps[0];
  const prev = prevSnapshotId
    ? snaps.find((s) => s.id === prevSnapshotId)
    : snaps.find((s) => s.id < cur.id) ?? null;

  const nowData = loadSnapshot(db, cur.id);
  const prevData = prev ? loadSnapshot(db, prev.id) : new Map();
  const windowDays = prev ? daysBetween(prev.taken_at, cur.taken_at) : null;

  const apps = new Map(db.prepare('SELECT id, store, store_id, title, publisher, icon, url, genres, released_at FROM apps').all().map((a) => [a.id, a]));

  // --- ham bileşenler ---
  const raw = [];
  for (const [appId, d] of nowData) {
    if (!d.ranks.length) continue; // chart dışı: radara girmez
    const app = apps.get(appId);
    if (!app) continue;
    const p = prevData.get(appId);

    const freeMom = prev ? rankMomentum(p?.ranks ?? [], d.ranks, 'free') : null;
    const grossMom = prev ? rankMomentum(p?.ranks ?? [], d.ranks, 'grossing') : null;
    const momentum = prev
      ? (freeMom ?? 0) * 0.65 + (grossMom ?? 0) * 0.35
      : null;

    // pencere içi indirme hızı: Android gerçek kurulum, iOS rating sayısı
    let velocity = null;
    if (prev && p?.metric && d.metric && windowDays) {
      const dInstalls = (d.metric.real_installs ?? 0) - (p.metric.real_installs ?? 0);
      const dRatings = (d.metric.rating_count ?? 0) - (p.metric.rating_count ?? 0);
      const per = app.store === 'android' && d.metric.real_installs ? dInstalls : dRatings;
      if (Number.isFinite(per) && per >= 0) velocity = per / windowDays;
    }

    // yaşam boyu hız: tek snapshot'ta da hesaplanır
    let lifetime = null;
    if (app.released_at && d.metric) {
      const age = daysBetween(app.released_at, cur.taken_at);
      const base = app.store === 'android' && d.metric.real_installs
        ? d.metric.real_installs
        : d.metric.rating_count;
      if (base) lifetime = base / age;
    }

    const countriesNow = new Set(d.ranks.filter((r) => r.chart !== 'paid').map((r) => r.country));
    const countriesPrev = new Set((p?.ranks ?? []).filter((r) => r.chart !== 'paid').map((r) => r.country));
    const breadth = [...countriesNow].reduce((s, c) => s + (CW[c] ?? 0.5), 0);

    // yeni giriş: bu snapshot'ta chart'ta olup öncekinde olmayan ülke oranı;
    // geçmiş yoksa Apple'ın "yeni çıkanlar" beslemesindeki varlığı kullanılır.
    const newCountries = [...countriesNow].filter((c) => !countriesPrev.has(c)).length;
    const inNewFeed = d.ranks.some((r) => r.chart === 'new');
    const newEntry = prev
      ? (countriesNow.size ? newCountries / countriesNow.size : 0)
      : (inNewFeed ? 1 : 0);

    const grossRanks = d.ranks.filter((r) => r.chart === 'grossing');
    const bestGross = grossRanks.length ? Math.min(...grossRanks.map((r) => r.rank)) : null;
    const freeRanks = d.ranks.filter((r) => r.chart === 'free');
    const bestFree = freeRanks.length ? Math.min(...freeRanks.map((r) => r.rank)) : null;
    // para kazanma gücü: grossing sırası free sırasından iyiyse güçlü monetizasyon
    // grossing chart'ta hiç olmamak "veri yok" değil, ölçülmüş zayıflıktır -> null değil 0.
    const monetization = bestGross
      ? Math.log(MISSING_RANK / bestGross) * (bestFree ? clamp01(bestFree / bestGross) + 0.5 : 1)
      : 0;

    const ageDays = app.released_at ? daysBetween(app.released_at, cur.taken_at) : null;
    const youth = ageDays === null ? null : clamp01(1 - Math.log10(Math.max(ageDays, 7) / 7) / Math.log10(365 / 7));

    raw.push({ appId, app, metric: d.metric, ranks: d.ranks, ageDays, bestGross, bestFree,
      countriesNow: countriesNow.size,
      c: { rankMomentum: momentum, downloadVelocity: velocity, lifetimeVelocity: lifetime,
           breadth, newEntry, monetization, youth } });
  }

  // --- normalizasyon: her bileşen kohort yüzdeliğine çevrilir ---
  const pct = {};
  for (const k of Object.keys(WEIGHTS)) {
    pct[k] = percentileMap(raw.map((r) => r.c[k]).filter((v) => Number.isFinite(v)));
  }

  const scored = raw.map((r) => {
    let sum = 0, wsum = 0;
    const parts = {};
    for (const [k, w] of Object.entries(WEIGHTS)) {
      const v = r.c[k];
      if (!Number.isFinite(v)) { parts[k] = null; continue; }
      const n = k === 'newEntry' ? clamp01(v) : pct[k](v); // newEntry zaten 0..1
      if (n === null) { parts[k] = null; continue; }
      parts[k] = Math.round(n * 100) / 100;
      sum += n * w; wsum += w;
    }
    const coverage = wsum / Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    // Kapsam cezası: az bileşenle yüksek skor, çok bileşenle aynı skora eşit sayılmasın.
    const base = wsum > 0 ? sum / wsum : 0;
    const hype = Math.round(base * (0.6 + 0.4 * coverage) * 1000) / 10;
    return { ...r, hype, parts, coverage };
  });

  // --- kademe ---
  for (const s of scored) {
    const young = s.ageDays !== null && s.ageDays < 180;
    const topGross = s.bestGross !== null && s.bestGross <= 20;
    if (young && s.hype >= 60) s.tier = 'breakout';
    else if (s.hype >= 60) s.tier = 'rising';
    else if (topGross) s.tier = 'established';
    else if (s.hype >= 45) s.tier = 'rising';
    else s.tier = 'watch';
  }

  scored.sort((a, b) => b.hype - a.hype);

  const insert = db.prepare('INSERT OR REPLACE INTO scores (snapshot_id, app_id, hype, tier, components) VALUES (?, ?, ?, ?, ?)');
  for (const s of scored) {
    insert.run(cur.id, s.appId, s.hype, s.tier, JSON.stringify({ ...s.parts, coverage: s.coverage }));
  }

  return { snapshot: cur, prev, windowDays, scored };
}

if (import.meta.filename === process.argv[1]) {
  const db = openDb();
  const { snapshot, prev, windowDays, scored } = computeScores(db);
  console.log(`snapshot #${snapshot.id}${prev ? ` (önceki #${prev.id}, pencere ${windowDays.toFixed(1)} gün)` : ' — SOĞUK BAŞLANGIÇ, pencere ivmesi yok'}`);
  console.log(`${scored.length} oyun skorlandı\n`);
  for (const s of scored.slice(0, 15)) {
    console.log(
      String(Math.round(s.hype)).padStart(3),
      s.tier.padEnd(11),
      (s.app.store === 'ios' ? '' : '') ,
      s.app.title?.slice(0, 40).padEnd(40),
      `yaş=${s.ageDays ? Math.round(s.ageDays) + 'g' : '?'}`,
      `ülke=${s.countriesNow}`,
      `gross=${s.bestGross ?? '-'}`
    );
  }
  db.close();
}
