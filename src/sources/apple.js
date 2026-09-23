import { APPLE_FEEDS, APPLE_GAMES_GENRE, CHART_DEPTH, APPLE_LOOKUP_BATCH,
         APPLE_LOOKUP_DEADLINE_MS } from '../config.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function getJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Bir ülke + chart için sıralı oyun listesi.
 * Dönen sıra RSS'in kendi sırası; rank = index + 1.
 */
export async function fetchAppleChart(country, chart, genre = APPLE_GAMES_GENRE) {
  const feed = APPLE_FEEDS[chart];
  if (!feed) throw new Error(`bilinmeyen Apple chart: ${chart}`);
  const url = `https://itunes.apple.com/${country}/rss/${feed}/limit=${CHART_DEPTH}/genre=${genre}/json`;
  const data = await getJson(url);
  const entries = data?.feed?.entry;
  if (!entries) return [];
  const list = Array.isArray(entries) ? entries : [entries];
  return list.map((e, i) => ({
    storeId: e.id?.attributes?.['im:id'],
    title: e['im:name']?.label,
    publisher: e['im:artist']?.label,
    icon: Array.isArray(e['im:image']) ? e['im:image'].at(-1)?.label : null,
    url: e.id?.label ?? null,
    rank: i + 1,
  })).filter((x) => x.storeId);
}

/**
 * iTunes lookup ile zenginleştirme. 100'lük partiler hâlinde.
 * Not: Apple IAP listesini ücretsiz uçtan vermiyor; iap alanı burada hep null,
 * eşleşen Android sürümünden türetiliyor (bkz. link.js).
 */
export async function enrichAppleApps(storeIds, country = 'us', fallbacks = []) {
  const out = new Map();
  const deadline = Date.now() + APPLE_LOOKUP_DEADLINE_MS;
  await lookupInto(out, storeIds, country, deadline);

  // Bir uygulama yalnız kendi vitrininde bulunabiliyor: Japonya veya Kore
  // chart'ındaki oyun ABD mağazasında yoksa lookup boş döner. Kapsam 30 ülkeye
  // çıkınca bu 8.196 iOS oyununun 1.215'ini metriksiz bırakıyordu; eksikleri
  // diğer vitrinlerde arıyoruz.
  for (const alt of fallbacks) {
    const missing = storeIds.filter((id) => !out.has(String(id)));
    if (!missing.length || Date.now() > deadline) break;
    await lookupInto(out, missing, alt, deadline);
  }
  return out;
}

async function lookupInto(out, storeIds, country, deadline = Infinity) {
  for (let i = 0; i < storeIds.length; i += APPLE_LOOKUP_BATCH) {
    if (Date.now() > deadline) break;
    const batch = storeIds.slice(i, i + APPLE_LOOKUP_BATCH);
    const url = `https://itunes.apple.com/lookup?id=${batch.join(',')}&country=${country}&entity=software`;
    let data;
    try {
      data = await getJson(url);
    } catch {
      continue; // parti düşerse diğerleri devam etsin; eksik veri skorda düşük ağırlık alır
    }
    for (const r of data?.results ?? []) {
      out.set(String(r.trackId), {
        storeId: String(r.trackId),
        title: r.trackName,
        publisher: r.artistName ?? r.sellerName,
        icon: r.artworkUrl100 ?? null,
        url: r.trackViewUrl ?? null,
        genres: r.genres ?? null,
        releasedAt: r.releaseDate ?? null,
        ratingCount: r.userRatingCount ?? null,
        ratingAvg: r.averageUserRating ?? null,
        price: r.price ?? null,
        version: r.version ?? null,
        updatedAt: r.currentVersionReleaseDate ?? null,
      });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
