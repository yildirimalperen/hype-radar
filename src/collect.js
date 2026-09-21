import { openDb, startSnapshot, finishSnapshot, upsertApp } from './db.js';
import { COUNTRIES, APPLE_FEEDS, PLAY_COLLECTIONS } from './config.js';
import { fetchAppleChart, enrichAppleApps } from './sources/apple.js';
import { fetchPlayChart, enrichPlayApps } from './sources/play.js';
import { linkStores } from './link.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export async function collect({ note = null } = {}) {
  const db = openDb();
  const snapshotId = startSnapshot(db, note);
  log(`snapshot #${snapshotId} başladı`);

  const insertRank = db.prepare(
    'INSERT OR REPLACE INTO ranks (snapshot_id, app_id, country, chart, rank) VALUES (?, ?, ?, ?, ?)'
  );
  const idCache = new Map(); // "store:storeId" -> app_id
  const appIdFor = (store, row) => {
    const key = `${store}:${row.storeId}`;
    if (!idCache.has(key)) {
      idCache.set(key, upsertApp(db, { store, ...row }));
    }
    return idCache.get(key);
  };

  const iosIds = new Set();
  const androidIds = new Set();
  let rankRows = 0;

  for (const { code } of COUNTRIES) {
    // Apple: 4 besleme paralel, RSS ucuz.
    const appleResults = await Promise.allSettled(
      Object.keys(APPLE_FEEDS).map(async (chart) => [chart, await fetchAppleChart(code, chart)])
    );
    for (const res of appleResults) {
      if (res.status !== 'fulfilled') { log('  apple hata:', code, res.reason?.message); continue; }
      const [chart, rows] = res.value;
      for (const row of rows) {
        insertRank.run(snapshotId, appIdFor('ios', row), code, chart, row.rank);
        iosIds.add(row.storeId);
        rankRows++;
      }
    }

    // Play: RPC, sıralı gidiyoruz ki 429 yemeyelim.
    for (const chart of Object.keys(PLAY_COLLECTIONS)) {
      try {
        const rows = await fetchPlayChart(code, chart);
        for (const row of rows) {
          insertRank.run(snapshotId, appIdFor('android', row), code, chart, row.rank);
          androidIds.add(row.storeId);
          rankRows++;
        }
      } catch (err) {
        log('  play hata:', code, chart, err.message);
      }
    }
    log(`  ${code}: toplam ${rankRows} sıra satırı`);
  }

  log(`chart taraması bitti — ${iosIds.size} iOS / ${androidIds.size} Android tekil oyun`);

  // Detay zenginleştirme
  const [ios, android] = await Promise.all([
    enrichAppleApps([...iosIds]),
    enrichPlayApps([...androidIds]),
  ]);
  log(`detay: iOS ${ios.size}/${iosIds.size}, Android ${android.size}/${androidIds.size}`);

  // Apple'ın "newfreeapplications" beslemesi genre=6014 filtresini yok sayıyor:
  // oyun olmayan uygulamalar (verimlilik, sağlık vb.) chart'a sızıyor. Lookup'tan
  // gelen tür listesiyle eliyoruz; elenenlerin sıra satırları da siliniyor.
  const deleteRanks = db.prepare('DELETE FROM ranks WHERE snapshot_id = ? AND app_id = ?');
  let dropped = 0;
  for (const [storeId, d] of ios) {
    const isGame = Array.isArray(d.genres) && d.genres.includes('Games');
    if (isGame) continue;
    const key = `ios:${storeId}`;
    const appId = idCache.get(key);
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
      // İkinci upsert: chart satırında olmayan alanları (tür, çıkış tarihi) tamamlar.
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
  log(`snapshot #${snapshotId} tamam`);
  db.close();
  return snapshotId;
}

if (import.meta.filename === process.argv[1]) {
  collect({ note: process.argv[2] ?? null }).catch((err) => {
    console.error('TOPLAMA HATASI', err);
    process.exit(1);
  });
}
