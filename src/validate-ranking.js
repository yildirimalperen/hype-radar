// Gelir modelinin SIRALAMASINI bağımsız bir referansa karşı ölçer.
//
// Neden: gelir rakamını kimse ücretsiz vermiyor, ama AppMagic'in açık
// top-charts sayfası girişsiz bir SIRALAMA veriyor (sayılar bantlı:
// "> 20,000,000"). Rakamı alamıyoruz, sırayı alabiliyoruz — ve bir gelir
// modelinin asıl işi zaten doğru sıralamak.
//
// Referans dosyası ELLE doldurulur (aylık, birkaç dakika):
//   data/calibration/reference-ranking.json
// Otomatik çekmiyoruz: sayfa JS-render, bot korumasına takılabilir ve
// kırıldığında radar sessizce yanlış çalışır. Elle giren 50 satır, sessizce
// bozulan bir boru hattından iyidir.
//
// Kullanım: node src/validate-ranking.js

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReport } from './report.js';

const REF = resolve(import.meta.dirname, '../data/calibration/reference-ranking.json');

/** Spearman sıra korelasyonu: iki sıralamanın ne kadar örtüştüğü (-1..1). */
function spearman(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    idx.forEach(([, i], k) => { r[i] = k + 1; });
    return r;
  };
  const ra = rank(pairs.map((p) => p.refRank));
  const rb = rank(pairs.map((p) => p.ourRank));
  const d2 = ra.reduce((s, _, i) => s + (ra[i] - rb[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

if (!existsSync(REF)) {
  console.log(`referans dosyası yok: ${REF}`);
  console.log('Doldurmak için: appmagic.rocks/top-charts -> Top Grossing -> Games -> Worldwide');
  console.log('ve sıralamayı {"period":"2026-09","entries":[{"rank":1,"ios":"...","android":"..."}]} biçiminde yaz.');
  process.exit(0);
}

const ref = JSON.parse(readFileSync(REF, 'utf8'));
const report = buildReport();

// Referanstaki her oyunu bizim modelin gelir sıralamasında bul.
const ours = report.games
  .filter((g) => g.revenueDailyEstimate)
  .sort((a, b) => b.revenueDailyEstimate - a.revenueDailyEstimate);
const posOf = new Map();
ours.forEach((g, i) => {
  if (g.platforms.ios?.id) posOf.set(`ios:${g.platforms.ios.id}`, i + 1);
  if (g.platforms.android?.id) posOf.set(`android:${g.platforms.android.id}`, i + 1);
});

const pairs = [];
const missing = [];
for (const e of ref.entries) {
  const ourRank = posOf.get(`ios:${e.ios}`) ?? posOf.get(`android:${e.android}`) ?? null;
  if (ourRank === null) { missing.push(e); continue; }
  pairs.push({ name: e.name ?? e.ios ?? e.android, refRank: e.rank, ourRank });
}

console.log(`referans: ${ref.period} · ${ref.entries.length} satır`);
console.log(`eşleşen: ${pairs.length} · radarda yok: ${missing.length}`);
console.log('\nreferans  bizim   fark  oyun');
console.log('─'.repeat(54));
for (const p of pairs.sort((a, b) => a.refRank - b.refRank)) {
  const d = p.ourRank - p.refRank;
  console.log(
    String(p.refRank).padStart(8), String(p.ourRank).padStart(7),
    (d > 0 ? '+' : '') + String(d).padStart(5), ' ', String(p.name).slice(0, 28)
  );
}
const rho = spearman(pairs);
console.log('─'.repeat(54));
console.log(`Spearman sıra korelasyonu: ${rho === null ? 'n<3' : rho.toFixed(3)}`);
if (missing.length) {
  console.log(`\nradarda hiç görünmeyenler (kapsam boşluğu):`);
  for (const m of missing.slice(0, 15)) console.log('  ', m.name ?? m.ios ?? m.android);
}
