// Radar kapsamı. Ülke ekleyip çıkarmak burada yapılır.
// Maliyet: her ülke ~4 Apple RSS + 3 Play RPC isteği; detay çekimi global olarak tekilleşir.

export const COUNTRIES = [
  { code: 'us', label: 'ABD', weight: 1.0 },
  { code: 'tr', label: 'Türkiye', weight: 0.6 },
  { code: 'gb', label: 'Birleşik Krallık', weight: 0.8 },
  { code: 'de', label: 'Almanya', weight: 0.8 },
  { code: 'fr', label: 'Fransa', weight: 0.7 },
  { code: 'br', label: 'Brezilya', weight: 0.7 },
  { code: 'jp', label: 'Japonya', weight: 0.9 },
  { code: 'kr', label: 'Güney Kore', weight: 0.8 },
];

// Apple legacy RSS besleme adları -> bizim kanonik chart adımız.
export const APPLE_FEEDS = {
  free: 'topfreeapplications',
  paid: 'toppaidapplications',
  grossing: 'topgrossingapplications',
  new: 'newfreeapplications',
};

// Play koleksiyonları -> kanonik chart adı.
export const PLAY_COLLECTIONS = {
  free: 'TOP_FREE',
  paid: 'TOP_PAID',
  grossing: 'GROSSING',
};

export const APPLE_GAMES_GENRE = 6014;
export const CHART_DEPTH = 100;

// Play detay çekiminde eşzamanlılık. Çok yükseltmek 429 getiriyor.
export const PLAY_DETAIL_CONCURRENCY = 6;
export const APPLE_LOOKUP_BATCH = 100; // iTunes lookup tek istekte 100 id kabul ediyor

// Skor penceresi: ivme "bugün vs N gün önce" olarak hesaplanır.
// Toplama sıklığından BAĞIMSIZ tutuluyor — daha sık toplamaya geçilirse
// pencereyi değiştirmek tek satır, geçmiş veri zaten birikmiş olur.
export const SCORE_WINDOW_DAYS = 2;
