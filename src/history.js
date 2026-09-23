// Uzun vadeli trend serisi.
//
// Neden snapshot'lardan ayrı: kapsam 11 kata çıkınca tam snapshot dosyası
// megabaytlara çıkıyor ve 90 dosya tutmak repo'yu şişirir. İvme için yalnız
// SON birkaç snapshot gerekiyor (pencere 2 gün); trend içinse uygulama başına
// birkaç sayı yetiyor. Bu yüzden:
//   data/snapshots/  -> tam veri, kısa saklama (ivme için)
//   data/history/    -> uygulama başına kompakt satır, süresiz (trend için)
//
// Satır biçimi bilerek kısa: aylık dosyada on binlerce satır olacak.
//   d ölçüm tarihi · s mağaza · i mağaza kimliği
//   f en iyi ücretsiz sıra · g en iyi hasılat sırası · c chart'ta olduğu ülke sayısı
//   r değerlendirme sayısı · n kümülatif kurulum (yalnız Android'de ölçüm)

import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const HISTORY_DIR = resolve(import.meta.dirname, '../data/history');

const fileFor = (iso) => join(HISTORY_DIR, `${iso.slice(0, 7)}.ndjson.gz`);

function readFile(path) {
  if (!existsSync(path)) return [];
  return gunzipSync(readFileSync(path)).toString('utf8').split('\n')
    .filter(Boolean).map((l) => JSON.parse(l));
}

/** Bir snapshot'ı kompakt geçmiş serisine ekler. Aynı tarih tekrar yazılmaz. */
export function appendHistory(db, snapshotId) {
  const snap = db.prepare('SELECT taken_at FROM snapshots WHERE id = ?').get(snapshotId);
  const day = snap.taken_at.slice(0, 10);

  const rows = db.prepare(`
    SELECT a.store AS s, a.store_id AS i,
           MIN(CASE WHEN r.chart = 'free' THEN r.rank END)     AS f,
           MIN(CASE WHEN r.chart = 'grossing' THEN r.rank END) AS g,
           COUNT(DISTINCT r.country) AS c,
           m.rating_count AS r_, m.real_installs AS n
    FROM ranks r
    JOIN apps a ON a.id = r.app_id
    LEFT JOIN app_metrics m ON m.app_id = r.app_id AND m.snapshot_id = r.snapshot_id
    WHERE r.snapshot_id = ?
    GROUP BY a.id`).all(snapshotId);

  mkdirSync(HISTORY_DIR, { recursive: true });
  const path = fileFor(day);
  const existing = readFile(path).filter((x) => x.d !== day);   // aynı günü tazele
  const fresh = rows.map((x) => ({
    d: day, s: x.s, i: x.i, f: x.f ?? null, g: x.g ?? null,
    c: x.c, r: x.r_ ?? null, n: x.n ?? null,
  }));

  const all = [...existing, ...fresh];
  writeFileSync(path, gzipSync(Buffer.from(all.map((x) => JSON.stringify(x)).join('\n')), { level: 9 }));
  return { rows: fresh.length, file: path, total: all.length };
}

/**
 * Skorlanmış değerleri ayrı bir seriye yazar (hype, günlük gelir tahmini).
 * Ayrı dosya, çünkü bunlar toplama anında değil SKORLAMA anında oluşuyor ve
 * model değişirse geçmişe dönük yeniden üretilebilmeleri gerekiyor.
 */
export function appendScores(day, rows) {
  mkdirSync(HISTORY_DIR, { recursive: true });
  const path = join(HISTORY_DIR, `scores-${day.slice(0, 7)}.ndjson.gz`);
  const existing = readFile(path).filter((x) => x.d !== day);
  const all = [...existing, ...rows.map((r) => ({ d: day, k: r.key, h: r.hype, v: r.rev ?? null }))];
  writeFileSync(path, gzipSync(Buffer.from(all.map((x) => JSON.stringify(x)).join('\n')), { level: 9 }));
  return { rows: rows.length, file: path };
}

/** Skor serisini oyun anahtarına göre döner. */
export function loadScores() {
  const byKey = new Map();
  let files = [];
  try { files = readdirSync(HISTORY_DIR).filter((f) => f.startsWith('scores-')).sort(); } catch { return byKey; }
  for (const f of files) {
    for (const x of readFile(join(HISTORY_DIR, f))) {
      if (!byKey.has(x.k)) byKey.set(x.k, []);
      byKey.get(x.k).push(x);
    }
  }
  for (const s of byKey.values()) s.sort((a, b) => a.d.localeCompare(b.d));
  return byKey;
}

/**
 * Tüm geçmişi "store:storeId" -> tarih sıralı seri olarak döner.
 * Trend çizimi ve kümülatif hesaplar bunu kullanıyor.
 */
export function loadHistory() {
  const byApp = new Map();
  let files = [];
  try { files = readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.ndjson.gz')).sort(); } catch { return byApp; }
  for (const f of files) {
    for (const x of readFile(join(HISTORY_DIR, f))) {
      const key = `${x.s}:${x.i}`;
      if (!byApp.has(key)) byApp.set(key, []);
      byApp.get(key).push(x);
    }
  }
  for (const series of byApp.values()) series.sort((a, b) => a.d.localeCompare(b.d));
  return byApp;
}
