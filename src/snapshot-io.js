// Snapshot'ların repo'da taşınabilir hâli.
//
// Neden: GitHub Actions runner'ı her koşuda temiz başlıyor, ama ivme bileşenleri
// geçmiş snapshot gerektiriyor. SQLite dosyasını commit'lemek hızla şişer ve diff'i
// okunmaz; onun yerine her snapshot sıkıştırılmış JSON olarak repo'ya yazılıyor,
// koşu başında DB bunlardan yeniden kuruluyor.

import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const SNAPSHOT_DIR = resolve(import.meta.dirname, '../data/snapshots');
// Tam snapshot yalnız ivme kıyası için gerekiyor (pencere 2 gün), uzun trend
// data/history/ içinde kompakt tutuluyor. Kapsam 11 kata çıkınca her dosya
// megabaytlara çıktığı için saklama kısaldı: 12 dosya ~ 24 gün.
export const RETENTION = 12;

export function exportSnapshot(db, snapshotId) {
  const snap = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(snapshotId);
  if (!snap) throw new Error(`snapshot ${snapshotId} yok`);

  // Sadece bu snapshot'ta geçen uygulamalar taşınır.
  const apps = db.prepare(`
    SELECT DISTINCT a.store, a.store_id, a.title, a.publisher, a.icon, a.url, a.genres, a.released_at
    FROM apps a
    WHERE a.id IN (SELECT app_id FROM ranks WHERE snapshot_id = ?)
       OR a.id IN (SELECT app_id FROM app_metrics WHERE snapshot_id = ?)`).all(snapshotId, snapshotId);

  const ranks = db.prepare(`
    SELECT a.store, a.store_id, r.country, r.chart, r.scope, r.rank
    FROM ranks r JOIN apps a ON a.id = r.app_id WHERE r.snapshot_id = ?`).all(snapshotId);

  const metrics = db.prepare(`
    SELECT a.store, a.store_id, m.rating_count, m.rating_avg, m.real_installs,
           m.installs_bucket, m.iap_range, m.price, m.version, m.updated_at
    FROM app_metrics m JOIN apps a ON a.id = m.app_id WHERE m.snapshot_id = ?`).all(snapshotId);

  const payload = { version: 2, takenAt: snap.taken_at, note: snap.note, coverage: snap.coverage ?? null, apps, ranks, metrics };
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = join(SNAPSHOT_DIR, `${snap.taken_at.slice(0, 19).replace(/[:T]/g, '-')}.json.gz`);
  const buf = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  writeFileSync(file, buf);
  return { file, apps: apps.length, ranks: ranks.length, metrics: metrics.length,
           sizeKb: Math.round(buf.length / 1024) };
}

function listFiles() {
  try {
    return readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json.gz')).sort();
  } catch { return []; }
}

/** Repo'daki snapshot dosyalarından DB'yi yeniden kurar. Zaten yüklü olanı atlar. */
export function importSnapshots(db) {
  const existing = new Set(db.prepare("SELECT taken_at FROM snapshots").all().map((s) => s.taken_at));
  const files = listFiles();
  let loaded = 0;

  const insertSnap = db.prepare("INSERT INTO snapshots (taken_at, status, note, coverage) VALUES (?, 'ok', ?, ?)");
  const insertRank = db.prepare('INSERT OR REPLACE INTO ranks (snapshot_id, app_id, country, chart, scope, rank) VALUES (?, ?, ?, ?, ?, ?)');
  const insertMetric = db.prepare(`INSERT OR REPLACE INTO app_metrics
    (snapshot_id, app_id, rating_count, rating_avg, real_installs, installs_bucket, iap_range, price, version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upsertAppStmt = db.prepare(`
    INSERT INTO apps (store, store_id, title, publisher, icon, url, genres, released_at, first_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, store_id) DO UPDATE SET
      title = COALESCE(excluded.title, apps.title),
      publisher = COALESCE(excluded.publisher, apps.publisher),
      icon = COALESCE(excluded.icon, apps.icon),
      url = COALESCE(excluded.url, apps.url),
      genres = COALESCE(excluded.genres, apps.genres),
      released_at = COALESCE(excluded.released_at, apps.released_at)`);
  const findApp = db.prepare('SELECT id FROM apps WHERE store = ? AND store_id = ?');

  for (const f of files) {
    const data = JSON.parse(gunzipSync(readFileSync(join(SNAPSHOT_DIR, f))).toString('utf8'));
    if (existing.has(data.takenAt)) continue;

    const snapshotId = Number(insertSnap.run(data.takenAt, data.note ?? null, data.coverage ?? null).lastInsertRowid);
    const idOf = new Map();
    for (const a of data.apps) {
      upsertAppStmt.run(a.store, a.store_id, a.title, a.publisher, a.icon, a.url, a.genres, a.released_at, data.takenAt);
      idOf.set(`${a.store}:${a.store_id}`, findApp.get(a.store, a.store_id).id);
    }
    for (const r of data.ranks) {
      const id = idOf.get(`${r.store}:${r.store_id}`);
      if (id) insertRank.run(snapshotId, id, r.country, r.chart, r.scope ?? 'all', r.rank);
    }
    for (const m of data.metrics) {
      const id = idOf.get(`${m.store}:${m.store_id}`);
      if (id) insertMetric.run(snapshotId, id, m.rating_count, m.rating_avg, m.real_installs,
        m.installs_bucket, m.iap_range, m.price, m.version, m.updated_at);
    }
    loaded++;
  }
  return { loaded, files: files.length };
}

/** Eski snapshot dosyalarını budar; ivme için yalnız yakın geçmiş gerekiyor. */
export function pruneSnapshots(keep = RETENTION) {
  const files = listFiles();
  const drop = files.slice(0, Math.max(0, files.length - keep));
  for (const f of drop) unlinkSync(join(SNAPSHOT_DIR, f));
  return drop.length;
}
