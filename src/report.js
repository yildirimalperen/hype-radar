import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from './db.js';
import { computeScores, WEIGHTS } from './score.js';
import { COUNTRIES } from './config.js';
import { estimateDailyRevenue, calibrateInstallsPerRating, estimateIosInstalls } from './estimate.js';
import { importSnapshots } from './snapshot-io.js';
import { linkStores } from './link.js';

const OUT = resolve(import.meta.dirname, '../data/radar.json');

/**
 * iOS ve Android satırlarını tek oyun kimliğinde birleştirir.
 * Skor: iki platformun en yükseği (hype tek platformda patlayabilir).
 * İndirme: Android ölçülmüş + iOS tahmini toplanır, kaynak ayrı ayrı etiketlenir.
 */
function mergeCrossStore(db, scored) {
  const links = db.prepare('SELECT ios_app_id, android_app_id FROM app_links').all();
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  for (const s of scored) add(s.appId);
  for (const l of links) {
    if (!parent.has(l.ios_app_id) || !parent.has(l.android_app_id)) continue;
    const a = find(l.ios_app_id), b = find(l.android_app_id);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const s of scored) {
    const k = find(s.appId);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return [...groups.values()];
}

function bestRanks(members) {
  // ülke -> chart -> en iyi sıra (platformlar arası)
  const out = {};
  for (const m of members) {
    for (const r of m.ranks) {
      out[r.country] ??= {};
      const cur = out[r.country][r.chart];
      if (cur === undefined || r.rank < cur) out[r.country][r.chart] = r.rank;
    }
  }
  return out;
}

export function buildReport() {
  const db = openDb();

  // Rapor, yeniden toplamadan da üretilebilmeli: temiz bir çalışma alanında
  // (CI runner'ı, yeni klon, worktree) DB yoktur ama snapshot dosyaları repo'dadır.
  // İçe aktarma tekrar-güvenli; yüklü snapshot'ı atlar.
  const restored = importSnapshots(db);
  if (restored.loaded) linkStores(db);

  const { snapshot, prev, windowDays, scored } = computeScores(db);

  // iOS indirme tahmini için oranı bu koşunun kendi eşleşmiş çiftlerinden kalibre et
  const pairs = db.prepare(`
    SELECT am.real_installs AS androidInstalls, am.rating_count AS androidRatings
    FROM app_links l
    JOIN app_metrics am ON am.app_id = l.android_app_id AND am.snapshot_id = ?
    WHERE am.real_installs IS NOT NULL AND am.rating_count IS NOT NULL`).all(snapshot.id);
  const installsPerRating = calibrateInstallsPerRating(pairs);

  // önceki snapshot metrikleri (delta için)
  const prevMetrics = prev
    ? new Map(db.prepare('SELECT app_id, rating_count, real_installs FROM app_metrics WHERE snapshot_id = ?')
        .all(prev.id).map((m) => [m.app_id, m]))
    : new Map();

  const games = mergeCrossStore(db, scored).map((members) => {
    members.sort((a, b) => b.hype - a.hype);
    const lead = members[0];
    const ios = members.find((m) => m.app.store === 'ios');
    const android = members.find((m) => m.app.store === 'android');
    const ranks = bestRanks(members);

    // --- indirmeler ---
    const androidInstalls = android?.metric?.real_installs ?? null;
    const iosInstalls = ios?.metric?.rating_count
      ? estimateIosInstalls(ios.metric.rating_count, installsPerRating) : null;

    // pencere içi indirme artışı
    let downloadsWindow = null;
    if (prev && windowDays) {
      let delta = 0, any = false;
      if (android && androidInstalls !== null) {
        const p = prevMetrics.get(android.appId);
        if (p?.real_installs != null) { delta += androidInstalls - p.real_installs; any = true; }
      }
      if (ios?.metric?.rating_count != null) {
        const p = prevMetrics.get(ios.appId);
        if (p?.rating_count != null) {
          delta += Math.max(0, ios.metric.rating_count - p.rating_count) * installsPerRating;
          any = true;
        }
      }
      if (any) downloadsWindow = Math.round(delta);
    }

    // --- gelir (TAHMİN) ---
    const revenue = members.reduce((sum, m) => {
      const r = estimateDailyRevenue(m.app.store, m.ranks);
      return r === null ? sum : sum + r;
    }, 0) || null;

    // --- IAP: Play ölçülmüş; iOS eşleşmiş Android sürümünden devralır ---
    const iap = android?.metric?.iap_range ?? null;

    return {
      key: `g${lead.appId}`,
      title: lead.app.title,
      publisher: lead.app.publisher,
      icon: lead.app.icon,
      genres: lead.app.genres ? JSON.parse(lead.app.genres) : [],
      releasedAt: lead.app.released_at,
      ageDays: lead.ageDays === null ? null : Math.round(lead.ageDays),
      hype: Math.max(...members.map((m) => m.hype)),
      tier: lead.tier,
      components: lead.parts,
      coverage: Math.round(lead.coverage * 100) / 100,
      platforms: {
        ios: ios ? { id: ios.app.store_id, url: ios.app.url, rating: ios.metric?.rating_avg ?? null,
                     ratingCount: ios.metric?.rating_count ?? null, hype: ios.hype } : null,
        android: android ? { id: android.app.store_id, url: android.app.url, rating: android.metric?.rating_avg ?? null,
                             ratingCount: android.metric?.rating_count ?? null, hype: android.hype } : null,
      },
      ranks,
      countryCount: Object.keys(ranks).length,
      bestGross: Math.min(...members.map((m) => m.bestGross ?? 999)) === 999 ? null
                 : Math.min(...members.map((m) => m.bestGross ?? 999)),
      bestFree: Math.min(...members.map((m) => m.bestFree ?? 999)) === 999 ? null
                : Math.min(...members.map((m) => m.bestFree ?? 999)),
      downloads: {
        androidTotal: androidInstalls,          // ÖLÇÜLDÜ (Play)
        iosTotalEstimate: iosInstalls,          // TAHMİN (rating x kalibre oran)
        total: (androidInstalls ?? 0) + (iosInstalls ?? 0) || null,
        windowDelta: downloadsWindow,           // pencere içi artış
        source: androidInstalls !== null ? 'mixed' : 'estimated',
      },
      revenueDailyEstimate: revenue,            // TAHMİN (grossing sırası modeli)
      iapRange: iap,
    };
  });

  games.sort((a, b) => b.hype - a.hype);

  const report = {
    generatedAt: new Date().toISOString(),
    snapshotId: snapshot.id,
    takenAt: snapshot.taken_at,
    previousSnapshotId: prev?.id ?? null,
    windowDays: windowDays ? Math.round(windowDays * 10) / 10 : null,
    coldStart: !prev,
    weights: WEIGHTS,
    countries: COUNTRIES,
    calibration: { installsPerRating: Math.round(installsPerRating * 10) / 10, pairs: pairs.length },
    methodology: {
      measured: ['chart sırası (App Store + Google Play)', 'Play kümülatif kurulum', 'rating sayısı/puanı', 'Play IAP fiyat aralığı', 'çıkış/güncelleme tarihi'],
      estimated: ['iOS indirme (rating x kalibre oran)', 'günlük gelir (grossing sırası güç yasası modeli)'],
      note: 'Gelir verisini hiçbir mağaza ücretsiz vermiyor; gelir sütunu modeldir, ölçüm değildir.',
    },
    counts: {
      games: games.length,
      ios: games.filter((g) => g.platforms.ios).length,
      android: games.filter((g) => g.platforms.android).length,
      crossPlatform: games.filter((g) => g.platforms.ios && g.platforms.android).length,
    },
    games,
  };

  mkdirSync(resolve(import.meta.dirname, '../data'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  db.close();
  return report;
}

if (import.meta.filename === process.argv[1]) {
  const r = buildReport();
  console.log(`rapor yazıldı: ${OUT}`);
  console.log(`snapshot #${r.snapshotId} | ${r.counts.games} oyun (${r.counts.crossPlatform} çapraz platform) | soğuk başlangıç: ${r.coldStart}`);
  console.log(`kalibrasyon: 1 rating ≈ ${r.calibration.installsPerRating} indirme (${r.calibration.pairs} çiftten)\n`);
  for (const g of r.games.slice(0, 12)) {
    console.log(
      String(Math.round(g.hype)).padStart(3),
      g.tier.padEnd(11),
      (g.title ?? '').slice(0, 32).padEnd(32),
      `${g.platforms.ios ? 'iOS' : '   '}${g.platforms.android ? '+And' : '    '}`,
      `ülke=${String(g.countryCount).padStart(2)}`,
      `gross=${String(g.bestGross ?? '-').padStart(3)}`,
      `indirme=${g.downloads.total ? (g.downloads.total / 1e6).toFixed(1) + 'M' : '-'}`,
      `gelir/gün≈${g.revenueDailyEstimate ? '$' + Math.round(g.revenueDailyEstimate / 1000) + 'k' : '-'}`
    );
  }
}
