import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DB_PATH = resolve(import.meta.dirname, '../data/radar.db');

const SCHEMA = `
-- Her toplama koşusu bir snapshot.
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  note TEXT
);

-- Uygulama kimliği: (store, store_id) tekil. iOS ve Android sürümleri ayrı satır,
-- eşleşmeleri app_links üzerinden kurulur.
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store TEXT NOT NULL,
  store_id TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  icon TEXT,
  url TEXT,
  genres TEXT,
  released_at TEXT,
  first_seen TEXT NOT NULL,
  UNIQUE (store, store_id)
);

-- Snapshot başına ölçülen uygulama durumu (ülkeden bağımsız, global alanlar).
CREATE TABLE IF NOT EXISTS app_metrics (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  app_id INTEGER NOT NULL REFERENCES apps(id),
  rating_count INTEGER,
  rating_avg REAL,
  real_installs INTEGER,
  installs_bucket TEXT,
  iap_range TEXT,
  price REAL,
  version TEXT,
  updated_at TEXT,
  PRIMARY KEY (snapshot_id, app_id)
);

-- Snapshot x ülke x chart başına sıra.
CREATE TABLE IF NOT EXISTS ranks (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  app_id INTEGER NOT NULL REFERENCES apps(id),
  country TEXT NOT NULL,
  chart TEXT NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, app_id, country, chart)
);

-- iOS <-> Android eşleşmesi (normalize başlık + yayıncı ile kurulur).
CREATE TABLE IF NOT EXISTS app_links (
  ios_app_id INTEGER NOT NULL REFERENCES apps(id),
  android_app_id INTEGER NOT NULL REFERENCES apps(id),
  confidence REAL NOT NULL,
  PRIMARY KEY (ios_app_id, android_app_id)
);

-- Skor çıktısı, snapshot başına dondurulur (geçmişe dönük yeniden yazılmaz).
CREATE TABLE IF NOT EXISTS scores (
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  app_id INTEGER NOT NULL REFERENCES apps(id),
  hype REAL NOT NULL,
  tier TEXT NOT NULL,
  components TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_ranks_app ON ranks(app_id, chart, country);
CREATE INDEX IF NOT EXISTS idx_ranks_snap ON ranks(snapshot_id, chart);
CREATE INDEX IF NOT EXISTS idx_metrics_app ON app_metrics(app_id);
`;

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function startSnapshot(db, note = null) {
  const stmt = db.prepare('INSERT INTO snapshots (taken_at, status, note) VALUES (?, ?, ?)');
  const info = stmt.run(new Date().toISOString(), 'running', note);
  return Number(info.lastInsertRowid);
}

export function finishSnapshot(db, id, status = 'ok', note = null) {
  db.prepare('UPDATE snapshots SET status = ?, note = COALESCE(?, note) WHERE id = ?').run(status, note, id);
}

export function upsertApp(db, { store, storeId, title, publisher, icon, url, genres, releasedAt }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO apps (store, store_id, title, publisher, icon, url, genres, released_at, first_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(store, store_id) DO UPDATE SET
       title = COALESCE(excluded.title, apps.title),
       publisher = COALESCE(excluded.publisher, apps.publisher),
       icon = COALESCE(excluded.icon, apps.icon),
       url = COALESCE(excluded.url, apps.url),
       genres = COALESCE(excluded.genres, apps.genres),
       released_at = COALESCE(excluded.released_at, apps.released_at)`
  ).run(store, storeId, title ?? null, publisher ?? null, icon ?? null, url ?? null,
        genres ? JSON.stringify(genres) : null, releasedAt ?? null, now);
  return db.prepare('SELECT id FROM apps WHERE store = ? AND store_id = ?').get(store, storeId).id;
}
