import { openDb, startSnapshot, finishSnapshot, upsertApp } from './db.js';
import {
  COUNTRIES, APPLE_FEEDS, PLAY_COLLECTIONS, APPLE_SUBGENRES, PLAY_SUBCATEGORIES,
  SUBGENRE_CHARTS, APPLE_GAMES_GENRE, APPLE_FEED_CONCURRENCY, PLAY_DETAIL_BUDGET,
} from './config.js';
import { fetchAppleChart, enrichAppleApps } from './sources/apple.js';
import { fetchPlayChart, enrichPlayApps } from './sources/play.js';
import { linkStores } from './link.js';
import { importSnapshots, exportSnapshot, pruneSnapshots } from './snapshot-io.js';
import { appendHistory } from './history.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Sınırlı eşzamanlılıkla iş kuyruğu; RSS ve RPC uçlarını boğmamak için. */
async function pool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try { await worker(item); } catch (err) { log('  görev hatası:', err.message); }
    }
  });
  await Promise.all(runners);
}

export async function collect({ note = null } = {}) {
  const t0 = Date.now();
  const db = openDb();
  // Actions runner temiz başladığı için geçmiş repo'daki snapshot dosyalarından kurulur.
  const restored = importSnapshots(db);
  if (restored.loaded) log(`${restored.loaded} snapshot repo'dan geri yüklendi (${restored.files} dosya)`);

  const snapshotId = startSnapshot(db, note);
  log(`snapshot #${snapshotId} başladı`);

  const insertRank = db.prepare(
    'INSERT OR REPLACE INTO ranks (snapshot_id, app_id, country, chart, scope, rank) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const idCache = new Map();
  const appIdFor = (store, row) => {
    const key = `${store}:${row.storeId}`;
    if (!idCache.has(key)) idCache.set(key, upsertApp(db, { store, ...row }));
    return idCache.get(key);
  };

  // Her uygulamanın gördüğü EN İYİ sıra: detay bütçesini önceliklendirmek için.
  const bestRank = new Map();   // "store:storeId" -> en iyi sıra
  const iosIds = new Set();
  const androidIds = new Set();
  let rankRows = 0;

  const record = (store, row, country, chart, scope) => {
    insertRank.run(snapshotId, appIdFor(store, row), country, chart, scope, row.rank);
    (store === 'ios' ? iosIds : androidIds).add(row.storeId);
    const key = `${store}:${row.storeId}`;
    if (!bestRank.has(key) || row.rank < bestRank.get(key)) bestRank.set(key, row.rank);
    rankRows++;
  };

  // --- tarama görev listesi: ana chart'lar her ülkede, alt türler yalnız derin ülkelerde
  const appleJobs = [];
  const playJobs = [];
  for (const c of COUNTRIES) {
    for (const chart of Object.keys(APPLE_FEEDS)) {
      appleJobs.push({ country: c.code, chart, genre: APPLE_GAMES_GENRE, scope: 'all' });
    }
    for (const chart of Object.keys(PLAY_COLLECTIONS)) {
      playJobs.push({ country: c.code, chart, category: 'GAME', scope: 'all' });
    }
    if (!c.deep) continue;
    for (const genre of Object.keys(APPLE_SUBGENRES)) {
      for (const chart of SUBGENRE_CHARTS) appleJobs.push({ country: c.code, chart, genre: Number(genre), scope: String(genre) });
    }
    for (const category of PLAY_SUBCATEGORIES) {
      for (const chart of SUBGENRE_CHARTS) playJobs.push({ country: c.code, chart, category, scope: category });
    }
  }
  log(`tarama planı: ${appleJobs.length} Apple beslemesi + ${playJobs.length} Play listesi ` +
      `(${COUNTRIES.length} ülke, ${COUNTRIES.filter((c) => c.deep).length} derin)`);

  await pool(appleJobs, APPLE_FEED_CONCURRENCY, async (job) => {
    const rows = await fetchAppleChart(job.country, job.chart, job.genre);
    for (const row of rows) record('ios', row, job.country, job.chart, job.scope);
  });
  log(`Apple bitti — ${rankRows} sıra satırı, ${iosIds.size} tekil oyun`);

  // Play RPC'si daha hassas; düşük eşzamanlılıkta gidiyoruz.
  await pool(playJobs, 3, async (job) => {
    const rows = await fetchPlayChart(job.country, job.chart, job.category);
    for (const row of rows) record('android', row, job.country, job.chart, job.scope);
  });
  log(`Play bitti — toplam ${rankRows} sıra satırı, ${androidIds.size} tekil Android oyun`);

  // --- detay zenginleştirme ---
  // Apple lookup 100'lük partiler hâlinde, ucuz: hepsini çekiyoruz.
  // Play detayı uygulama başına bir istek: bütçeyle sınırlı, en iyi sıraya göre öncelikli.
  const androidRanked = [...androidIds]
    .sort((a, b) => (bestRank.get(`android:${a}`) ?? 999) - (bestRank.get(`android:${b}`) ?? 999));
  const androidToFetch = androidRanked.slice(0, PLAY_DETAIL_BUDGET);
  if (androidRanked.length > androidToFetch.length) {
    log(`Play detay bütçesi: ${androidToFetch.length}/${androidRanked.length} ` +
        `(kalanlar sıra tabanlı bileşenlerle skorlanır)`);
  }

  // Vitrin yedeği: yalnız kendi ülkesinde satılan oyun ABD lookup'ında bulunamıyor.
  const fallbackStores = COUNTRIES.filter((c) => c.deep && c.code !== 'us').map((c) => c.code);
  const [ios, android] = await Promise.all([
    enrichAppleApps([...iosIds], 'us', fallbackStores),
    enrichPlayApps(androidToFetch),
  ]);
  log(`detay: iOS ${ios.size}/${iosIds.size}, Android ${android.size}/${androidToFetch.length}`);

  // Apple'ın "newfreeapplications" beslemesi genre filtresini yok sayıyor:
  // oyun olmayan uygulamalar chart'a sızıyor. Lookup türleriyle eliyoruz.
  const deleteRanks = db.prepare('DELETE FROM ranks WHERE snapshot_id = ? AND app_id = ?');
  let dropped = 0;
  for (const [storeId, d] of ios) {
    if (Array.isArray(d.genres) && d.genres.includes('Games')) continue;
    const appId = idCache.get(`ios:${storeId}`);
    if (appId) deleteRanks.run(snapshotId, appId);
    ios.delete(storeId);
    dropped++;
  }
  log(`oyun olmayan ${dropped} iOS uygulaması elendi (new-feed sızıntısı)`);

  const insertMetric = db.prepare(
    `INSERT OR REPLACE INTO app_metrics
     (snapshot_id, app_id, rating_count, rating_avg, real_installs, installs_bucket, iap_range, price, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [store, map] of [['ios', ios], ['android', android]]) {
    for (const [storeId, d] of map) {
      const appId = appIdFor(store, { storeId, ...d });
      upsertApp(db, { store, ...d });
      insertMetric.run(
        snapshotId, appId,
        d.ratingCount ?? null, d.ratingAvg ?? null,
        d.realInstalls ?? null, d.installsBucket ?? null,
        d.iapRange ?? null, d.price ?? null, d.version ?? null, d.updatedAt ?? null
      );
    }
  }

  const links = linkStores(db);
  log(`iOS↔Android eşleşmesi: ${links} çift`);

  finishSnapshot(db, snapshotId, 'ok', `${rankRows} sıra, ${iosIds.size + androidIds.size} oyun`);

  const exported = exportSnapshot(db, snapshotId);
  const pruned = pruneSnapshots();
  const hist = appendHistory(db, snapshotId);
  log(`snapshot: ${exported.file.split('/').pop()} (${exported.ranks} sıra, ${exported.sizeKb} KB)`);
  log(`geçmiş serisi: ${hist.rows} satır -> ${hist.file.split('/').pop()}`);
  if (pruned) log(`${pruned} eski snapshot dosyası budandı`);
  log(`snapshot #${snapshotId} tamam — ${((Date.now() - t0) / 1000 / 60).toFixed(1)} dk`);
  db.close();
  return snapshotId;
}

if (import.meta.filename === process.argv[1]) {
  collect({ note: process.argv[2] ?? null }).catch((err) => {
    console.error('TOPLAMA HATASI', err);
    process.exit(1);
  });
}
