import gplayPkg from 'google-play-scraper';
import { PLAY_COLLECTIONS, CHART_DEPTH, PLAY_DETAIL_CONCURRENCY, PLAY_DETAIL_DELAY_MS,
         PLAY_DETAIL_DEADLINE_MS } from '../config.js';

const gplay = gplayPkg.default ?? gplayPkg;

/** Bir ülke + chart için sıralı oyun listesi (Play GAME kategorisi). */
export async function fetchPlayChart(country, chart, category = 'GAME') {
  const collection = PLAY_COLLECTIONS[chart];
  if (!collection) return [];
  const res = await gplay.list({
    collection,
    category,
    num: CHART_DEPTH,
    country,
    lang: 'en',
    throttle: 10,
  });
  return res.map((a, i) => ({
    storeId: a.appId,
    title: a.title,
    publisher: a.developer,
    icon: a.icon ?? null,
    url: a.url ?? null,
    rank: i + 1,
  }));
}

/**
 * Play detayları. realInstalls Play'in verdiği GERÇEK kümülatif kurulum sayısı —
 * radardaki tek ölçülmüş (tahmin olmayan) indirme metriği.
 */
export async function enrichPlayApps(appIds, country = 'us') {
  const out = new Map();
  const queue = [...appIds];
  const deadline = Date.now() + PLAY_DETAIL_DEADLINE_MS;
  let timedOut = false;
  const workers = Array.from({ length: PLAY_DETAIL_CONCURRENCY }, async () => {
    while (queue.length) {
      if (Date.now() > deadline) { timedOut = true; break; }
      const appId = queue.shift();
      try {
        const d = await gplay.app({ appId, country, lang: 'en' });
        out.set(appId, {
          storeId: appId,
          title: d.title,
          publisher: d.developer,
          icon: d.icon ?? null,
          url: d.url ?? null,
          genres: d.genre ? [d.genre] : null,
          releasedAt: d.released ? new Date(d.released).toISOString() : null,
          ratingCount: d.ratings ?? null,
          ratingAvg: d.score ?? null,
          // Node kütüphanesinde alan adı maxInstalls: Play'in verdiği kesin kümülatif kurulum.
          realInstalls: d.maxInstalls ?? d.realInstalls ?? null,
          installsBucket: d.installs ?? null,
          iapRange: d.IAPRange ?? (d.offersIAP ? 'IAP var' : null),
          price: d.price ?? 0,
          version: d.version ?? null,
          updatedAt: d.updated ? new Date(d.updated > 1e12 ? d.updated : d.updated * 1000).toISOString() : null,
        });
      } catch {
        // tek uygulama düşerse radar durmaz
      }
      await new Promise((r) => setTimeout(r, PLAY_DETAIL_DELAY_MS));
    }
  });
  await Promise.all(workers);
  if (timedOut) {
    console.log(`  Play detay süre sınırına takıldı: ${out.size}/${appIds.length} alındı, ` +
                `${queue.length} atlandı`);
  }
  return out;
}
