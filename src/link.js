// iOS <-> Android eşleştirme.
// Amaç: aynı oyunun iki mağazadaki satırını birleştirip
//   - Apple'da olmayan IAP aralığını Android'den,
//   - Apple'da olmayan gerçek indirmeyi Android realInstalls'tan
// türetebilmek. Emin olmadığımız eşleşmeyi kurmuyoruz (yanlış birleştirme,
// eksik veriden daha pahalı).

const STOPWORDS = /\b(the|game|games|mobile|3d|2d|hd|free|online|app|io)\b/g;

export function normalizeTitle(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[®™©]/g, '')
    .split(/[:：\-–—|(]/)[0]            // altbaşlığı at: "Royal Match: Puzzle" -> "royal match"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(STOPWORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePublisher(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/\b(inc|ltd|llc|co|corp|corporation|limited|gmbh|studios?|games?|entertainment|interactive|technologies|technology|soft|software)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Eşleşme kuralı:
 *   normalize başlık birebir aynı VE (yayıncı da benziyor VEYA başlık yeterince ayırt edici)
 * confidence: 1.0 başlık+yayıncı, 0.7 sadece başlık (tekil eşleşmeyse).
 */
export function linkStores(db) {
  const rows = db.prepare('SELECT id, store, title, publisher FROM apps').all();
  const ios = new Map();
  const android = new Map();
  for (const r of rows) {
    const key = normalizeTitle(r.title);
    if (!key || key.length < 3) continue;
    const bucket = r.store === 'ios' ? ios : android;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(r);
  }

  const insert = db.prepare(
    'INSERT OR REPLACE INTO app_links (ios_app_id, android_app_id, confidence) VALUES (?, ?, ?)'
  );
  let n = 0;
  for (const [key, iosRows] of ios) {
    const androidRows = android.get(key);
    if (!androidRows) continue;
    for (const a of iosRows) {
      for (const b of androidRows) {
        const samePublisher =
          normalizePublisher(a.publisher) &&
          normalizePublisher(a.publisher) === normalizePublisher(b.publisher);
        const unique = iosRows.length === 1 && androidRows.length === 1;
        if (!samePublisher && !unique) continue;   // belirsiz eşleşmeyi atla
        insert.run(a.id, b.id, samePublisher ? 1.0 : 0.7);
        n++;
      }
    }
  }
  return n;
}
