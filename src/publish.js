// Panel HTML'ini üretir: şablon + o anki rapor JSON'u tek dosyaya gömülür.
// Artifact yayını statik olduğu için veri sayfaya gömülüyor; her tazelemede
// sayfa yeniden üretilip AYNI URL'e yayımlanır.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReport } from './report.js';

const ROOT = resolve(import.meta.dirname, '..');
const TEMPLATE = resolve(ROOT, 'web/template.html');
const OUT = resolve(ROOT, 'web/dashboard.html');

// Yayımlanan sayfada gömülecek alt küme.
// İki kısıt var:
//  1) Artifact CSP dış görselleri engelliyor -> mağaza ikon URL'leri atılıyor,
//     sayfa başlıktan türetilen renkli karo çiziyor.
//  2) Yayın boyut kapısı -> radarın anlamlı üst kısmı gömülüyor, tamamı
//     data/radar.json dosyasında kalıyor.
const EMBED_LIMIT = 400;

function pickEmbedded(games) {
  const keep = new Map();
  const add = (g) => { if (!keep.has(g.key)) keep.set(g.key, g); };
  games.slice().sort((a, b) => b.hype - a.hype).slice(0, EMBED_LIMIT).forEach(add);
  // Sekmelerin boş kalmaması için: hasılat ilk 60 ve 120 günden genç olanlar her hâlükârda girsin.
  games.filter((g) => g.bestGross !== null).sort((a, b) => a.bestGross - b.bestGross).slice(0, 60).forEach(add);
  games.filter((g) => g.ageDays !== null && g.ageDays <= 120)
       .sort((a, b) => b.hype - a.hype).slice(0, 80).forEach(add);
  return [...keep.values()].sort((a, b) => b.hype - a.hype);
}

function slim(report) {
  return {
    ...report,
    embedded: true,
    totalGames: report.games.length,
    // Özet şeridi TÜM taramayı anlatmalı; gömülü alt kümeden hesaplanırsa
    // sayılar sessizce küçülür. Bu yüzden burada, tam liste üzerinden hesaplanıyor.
    summary: {
      breakout: report.games.filter((g) => g.tier === 'breakout').length,
      rising: report.games.filter((g) => g.tier === 'rising').length,
      established: report.games.filter((g) => g.tier === 'established').length,
      crossPlatform: report.counts.crossPlatform,
      revenueDaily: report.games.reduce((s, g) => s + (g.revenueDailyEstimate || 0), 0),
      measuredInstalls: report.games.reduce((s, g) => s + (g.downloads.androidTotal || 0), 0),
    },
    games: pickEmbedded(report.games).map((g) => ({
      key: g.key, title: g.title, publisher: g.publisher, genres: g.genres,
      releasedAt: g.releasedAt, ageDays: g.ageDays, hype: g.hype, tier: g.tier,
      components: g.components, coverage: g.coverage, platforms: g.platforms,
      ranks: g.ranks, countryCount: g.countryCount, bestGross: g.bestGross, bestFree: g.bestFree,
      downloads: g.downloads, revenueDailyEstimate: g.revenueDailyEstimate, iapRange: g.iapRange,
    })),
  };
}

const report = buildReport();
const tpl = readFileSync(TEMPLATE, 'utf8');
// </script> dizisi gömülü JSON'u erken kapatabilir; kaçır.
const json = JSON.stringify(slim(report)).replace(/<\//g, '<\\/');
writeFileSync(OUT, tpl.replace('__RADAR_DATA__', json));
const kb = Math.round(Buffer.byteLength(readFileSync(OUT)) / 1024);
console.log(`panel yazıldı: ${OUT} (${kb} KB, ${report.games.length} oyun)`);
