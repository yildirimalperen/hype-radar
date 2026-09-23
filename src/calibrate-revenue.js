// Gelir eğrisini kalibre eder: data/calibration/revenue-anchors.json içindeki
// üçüncü taraf aylık gelir tahminlerine karşı A ve b parametrelerini fit eder.
//
// Neden ayrı bir script: bu sayılar panelde görünen her gelir rakamının altında
// duruyor. Elle "şu daha doğru görünüyor" diye oynatmak yerine ölçülebilir bir
// hata metriğine bağlı olsun istiyoruz — çapa eklendiğinde yeniden koşturulur,
// hatanın düşüp düşmediği görülür.
//
// Kullanım:
//   node src/calibrate-revenue.js            # mevcut sabitlerin hatasını ölç + öneri üret
//   node src/calibrate-revenue.js --write    # önerilen sabitleri estimate.js'e yaz

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from './db.js';
import { importSnapshots } from './snapshot-io.js';
import { COUNTRY_REV_WEIGHT, PLATFORM_REV_FACTOR, GLOBAL_COVERAGE_UPLIFT, REV_CURVE } from './estimate.js';

const ROOT = resolve(import.meta.dirname, '..');
const ANCHORS = resolve(ROOT, 'data/calibration/revenue-anchors.json');
const ESTIMATE_FILE = resolve(ROOT, 'src/estimate.js');
const DAYS_PER_MONTH = 30.44;

/** Bir oyunun günlük gelirini verilen (A,b) ile hesaplar. */
function modelDaily(ranksByStore, A, b) {
  let total = 0;
  for (const [store, ranks] of Object.entries(ranksByStore)) {
    let sum = 0;
    for (const r of ranks) sum += A * Math.pow(r.rank, -b) * (COUNTRY_REV_WEIGHT[r.country] ?? 0.03);
    total += sum * (PLATFORM_REV_FACTOR[store] ?? 1);
  }
  return total * GLOBAL_COVERAGE_UPLIFT;
}

/** Çapaların hasılat sıralarını en güncel snapshot'tan toplar. */
function loadAnchorRanks(db, anchors) {
  const snap = db.prepare("SELECT id, taken_at FROM snapshots WHERE status='ok' ORDER BY id DESC LIMIT 1").get();
  // scope = 'all' ŞART: üretimdeki gelir modeli yalnız genel chart sıralarını
  // kullanıyor. Kalibrasyon farklı girdiyle çalışırsa fit ettiği sabit yanlış
  // olur — alt tür sıraları dahilken model 4 kat şişiyor ve A o kadar düşük
  // fit ediliyordu.
  const stmt = db.prepare(`
    SELECT r.country, r.rank FROM ranks r
    JOIN apps a ON a.id = r.app_id
    WHERE r.snapshot_id = ? AND r.chart = 'grossing' AND r.scope = 'all'
      AND a.store = ? AND a.store_id = ?`);

  const out = [];
  for (const a of anchors) {
    const ranksByStore = {};
    for (const store of ['ios', 'android']) {
      if (!a[store]) continue;
      const rows = stmt.all(snap.id, store, a[store]);
      if (rows.length) ranksByStore[store] = rows;
    }
    const countries = new Set(Object.values(ranksByStore).flat().map((r) => r.country));
    if (!countries.size) { out.push({ ...a, skip: 'hasılat chartında hiç yok' }); continue; }
    out.push({ ...a, ranksByStore, countryCount: countries.size,
               bestRank: Math.min(...Object.values(ranksByStore).flat().map((r) => r.rank)),
               reportedDaily: a.monthlyUsd / DAYS_PER_MONTH });
  }
  return { snap, rows: out };
}

/**
 * Hata: log uzayında ortalama kare. Log kullanmanın sebebi, gelirin büyüklük
 * mertebesiyle değişmesi — $3M'lik oyundaki %50 sapma ile $300K'liktekini
 * eşit ağırlıkta saymak istiyoruz, mutlak dolar farkını değil.
 * Düşük güvenli çapalar yarım ağırlık alır.
 */
function logError(rows, A, b) {
  let sum = 0, w = 0;
  for (const r of rows) {
    if (r.skip) continue;
    const weight = r.confidence === 'low' ? 0.5 : 1;
    const d = Math.log(modelDaily(r.ranksByStore, A, b)) - Math.log(r.reportedDaily);
    sum += weight * d * d; w += weight;
  }
  return Math.sqrt(sum / w);
}

/** Verilen eğim için en iyi ölçeği bulur (tek boyutlu, daraltmalı arama). */
function fitScale(rows, b) {
  let lo = 100_000, hi = 20_000_000, best = { A: lo, err: Infinity };
  for (let pass = 0; pass < 8; pass++) {
    const step = (hi - lo) / 60;
    for (let A = lo; A <= hi; A += step) {
      const err = logError(rows, A, b);
      if (err < best.err) best = { A, err };
    }
    lo = Math.max(10_000, best.A - step * 2); hi = best.A + step * 2;
  }
  return { ...best, b };
}

/**
 * Serbest fit: A ve b birlikte.
 * İki boyutlu kaba ızgara yerel bir noktaya takılıyordu — sabit eğimli fit'ten
 * DAHA KÖTÜ sonuç bildiriyordu ki bu matematiksel olarak imkânsız. Onun yerine
 * eğimi ince adımlarla tarayıp her adımda ölçeği tek boyutlu (sağlam) arıyoruz.
 */
function fitFree(rows) {
  let best = { A: REV_CURVE.A, b: REV_CURVE.b, err: logError(rows, REV_CURVE.A, REV_CURVE.b) };
  for (let b = 0.30; b <= 2.0; b += 0.005) {
    const { A, err } = fitScale(rows, b);
    if (err < best.err) best = { A, b, err };
  }
  return best;
}

/**
 * Eğim taraması. Bunu basmak şart, çünkü asıl bulgu burada görünüyor:
 * çapaların hepsi ilk 10'de olduğu için eğimi neredeyse hiç kısıtlamıyorlar —
 * hata b boyunca neredeyse düz. Serbest fit'in eğimi yatırması bir kanıt değil,
 * alt sıra verisinin yokluğunun yan etkisi. Eğimi ayırt eden tek nokta
 * ilk 10 dışındaki çapadır; tarama bu gerilimi görünür kılar.
 */
function slopeSweep(rows) {
  const deep = rows.filter((r) => !r.skip && r.bestRank > 10);
  const head = rows.filter((r) => !r.skip && r.bestRank <= 10);
  console.log('\nEĞİM TARAMASI — her b için en iyi A');
  console.log('   b        A(fit)   log-RMSE   ilk-10 medyan   alt-sıra medyan');
  console.log('─'.repeat(66));
  for (const b of [0.60, 0.70, 0.80, 0.90, 1.00]) {
    const { A, err } = fitScale(rows, b);
    const med = (set) => {
      if (!set.length) return '   —';
      const v = set.map((r) => modelDaily(r.ranksByStore, A, b) / r.reportedDaily).sort((x, y) => x - y);
      return v[Math.floor(v.length / 2)].toFixed(2) + '×';
    };
    console.log(
      b.toFixed(2).padStart(4), String(Math.round(A)).padStart(13), err.toFixed(3).padStart(10),
      med(head).padStart(14), med(deep).padStart(16)
    );
  }
  console.log(`(ilk-10: ${head.length} çapa · alt-sıra: ${deep.length} çapa)`);
}

const fmt = (n) => '$' + (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n / 1e3) + 'K');

function table(rows, A, b, title) {
  console.log(`\n${title}  (A=${Math.round(A).toLocaleString('tr-TR')}, b=${b.toFixed(3)})`);
  console.log('oyun                      en iyi  ülke   bildirilen/gün   model/gün    oran');
  console.log('─'.repeat(78));
  const ratios = [];
  for (const r of rows) {
    if (r.skip) { console.log(r.name.padEnd(26) + ' — ' + r.skip); continue; }
    const m = modelDaily(r.ranksByStore, A, b);
    const ratio = m / r.reportedDaily;
    ratios.push(ratio);
    console.log(
      r.name.slice(0, 25).padEnd(26),
      ('#' + r.bestRank).padStart(5),
      String(r.countryCount).padStart(5),
      fmt(r.reportedDaily).padStart(14),
      fmt(m).padStart(12),
      (ratio.toFixed(2) + '×').padStart(8),
      r.confidence === 'low' ? ' (düşük güven)' : ''
    );
  }
  ratios.sort((x, y) => x - y);
  const med = ratios[Math.floor(ratios.length / 2)];
  const within2x = ratios.filter((x) => x >= 0.5 && x <= 2).length;
  console.log('─'.repeat(78));
  console.log(`medyan oran ${med.toFixed(2)}×  |  2 kat içinde ${within2x}/${ratios.length}  |  log-RMSE ${logError(rows, A, b).toFixed(3)}`);
  return { med, within2x, n: ratios.length };
}

// --- ana akış ---
const cfg = JSON.parse(readFileSync(ANCHORS, 'utf8'));
const db = openDb();
importSnapshots(db);
const { snap, rows } = loadAnchorRanks(db, cfg.anchors);

console.log(`çapa dönemi: ${cfg.period}  |  sıra verisi: snapshot #${snap.id} (${snap.taken_at.slice(0, 10)})`);
console.log(`${rows.filter((r) => !r.skip).length}/${rows.length} çapa eşleşti  |  dışlanan: ${cfg.excluded.length}`);

const SLOPE = Number(process.env.FIT_SLOPE ?? REV_CURVE.b); // eğim korunur, ölçek fit edilir

const before = table(rows, REV_CURVE.A, REV_CURVE.b, 'MEVCUT');
slopeSweep(rows);

const free = fitFree(rows);
console.log(`\nserbest fit (referans): A=${Math.round(free.A).toLocaleString('tr-TR')}, b=${free.b.toFixed(3)}, log-RMSE ${free.err.toFixed(3)}`);

const best = fitScale(rows, SLOPE);
const after = table(rows, best.A, best.b, 'ÖNERİLEN (eğim sabit, ölçek fit)');

console.log(`\nlog-RMSE: ${logError(rows, REV_CURVE.A, REV_CURVE.b).toFixed(3)} -> ${best.err.toFixed(3)}`);
console.log(`2 kat içinde: ${before.within2x}/${before.n} -> ${after.within2x}/${after.n}`);

if (process.argv.includes('--write')) {
  const A = Math.round(best.A / 1000) * 1000;
  const b = Math.round(best.b * 1000) / 1000;
  let s = readFileSync(ESTIMATE_FILE, 'utf8');
  s = s.replace(/export const REV_CURVE = \{ A: [\d_]+, b: [\d.]+ \};/,
    `export const REV_CURVE = { A: ${A.toLocaleString('en-US').replace(/,/g, '_')}, b: ${b} };`);
  writeFileSync(ESTIMATE_FILE, s);
  console.log(`\nestimate.js güncellendi: A=${A}, b=${b}`);
} else {
  console.log('\n(yazmak için: node src/calibrate-revenue.js --write)');
}
db.close();
