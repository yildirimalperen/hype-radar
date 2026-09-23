// Radar kapsamı.
//
// İki katmanlı tarama. Sebebi ölçüm: ülke başına genel top-100'e bakmak, bir
// oyunu ancak PATLAMA OLDUKTAN SONRA görmemiz demek. Alt tür chart'ları aynı
// ülkede 11 kat oyun gösteriyor (ABD'de 100 -> 1.120) ve bunların çoğu genel
// listede hiç yok — hype tam orada başlıyor.
//
//   deep  : tüm alt türler + ana chart'lar. Pazar ağırlığı yüksek ülkeler.
//   broad : yalnız ana chart'lar. Yayılım sinyali için ucuz kapsama.

export const COUNTRIES = [
  // --- derin tarama: gelirin ve erken sinyalin yoğunlaştığı pazarlar
  { code: 'us', label: 'ABD',              weight: 1.00, deep: true },
  { code: 'jp', label: 'Japonya',          weight: 0.55, deep: true },
  { code: 'kr', label: 'Güney Kore',       weight: 0.30, deep: true },
  { code: 'gb', label: 'Birleşik Krallık', weight: 0.12, deep: true },
  { code: 'de', label: 'Almanya',          weight: 0.12, deep: true },
  { code: 'fr', label: 'Fransa',           weight: 0.08, deep: true },
  { code: 'br', label: 'Brezilya',         weight: 0.05, deep: true },
  { code: 'tr', label: 'Türkiye',          weight: 0.02, deep: true },

  // --- geniş tarama: yalnız ana chart'lar
  { code: 'ca', label: 'Kanada',       weight: 0.070 },
  { code: 'au', label: 'Avustralya',   weight: 0.060 },
  { code: 'tw', label: 'Tayvan',       weight: 0.050 },
  { code: 'ru', label: 'Rusya',        weight: 0.040 },
  { code: 'it', label: 'İtalya',       weight: 0.040 },
  { code: 'es', label: 'İspanya',      weight: 0.030 },
  { code: 'mx', label: 'Meksika',      weight: 0.030 },
  { code: 'nl', label: 'Hollanda',     weight: 0.025 },
  { code: 'in', label: 'Hindistan',    weight: 0.020 },
  { code: 'id', label: 'Endonezya',    weight: 0.020 },
  { code: 'th', label: 'Tayland',      weight: 0.020 },
  { code: 'sa', label: 'S. Arabistan', weight: 0.020 },
  { code: 'ae', label: 'BAE',          weight: 0.015 },
  { code: 'se', label: 'İsveç',        weight: 0.015 },
  { code: 'ch', label: 'İsviçre',      weight: 0.015 },
  { code: 'pl', label: 'Polonya',      weight: 0.012 },
  { code: 'vn', label: 'Vietnam',      weight: 0.012 },
  { code: 'hk', label: 'Hong Kong',    weight: 0.012 },
  { code: 'sg', label: 'Singapur',     weight: 0.012 },
  { code: 'ph', label: 'Filipinler',   weight: 0.010 },
  { code: 'my', label: 'Malezya',      weight: 0.010 },
  { code: 'no', label: 'Norveç',       weight: 0.010 },
];

export const DEEP_COUNTRIES = COUNTRIES.filter((c) => c.deep);

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

// Apple Games alt türleri. Hepsi ayrı 100'lük liste veriyor (doğrulandı).
export const APPLE_SUBGENRES = {
  7001: 'Aksiyon', 7002: 'Macera',  7003: 'Casual',    7004: 'Board',
  7005: 'Kart',    7006: 'Casino',  7009: 'Aile',      7011: 'Bulmaca',
  7012: 'Yarış',   7013: 'RPG',     7014: 'Simülasyon', 7015: 'Spor',
  7016: 'Strateji', 7017: 'Trivia', 7018: 'Kelime',
};

export const PLAY_SUBCATEGORIES = [
  'GAME_ACTION', 'GAME_ADVENTURE', 'GAME_ARCADE', 'GAME_BOARD', 'GAME_CARD',
  'GAME_CASINO', 'GAME_CASUAL', 'GAME_PUZZLE', 'GAME_RACING', 'GAME_ROLE_PLAYING',
  'GAME_SIMULATION', 'GAME_SPORTS', 'GAME_STRATEGY', 'GAME_TRIVIA', 'GAME_WORD',
];

// Alt türlerde yalnız bu chart'lara bakılıyor: "ücretli" ve "yeni" beslemeleri
// alt türde sinyal taşımıyor, istek sayısını iki katına çıkarıyorlardı.
export const SUBGENRE_CHARTS = ['free', 'grossing'];

export const CHART_DEPTH = 100;

// --- bütçeler ---
// Play detayı uygulama BAŞINA bir istek; kapsam büyüyünce en pahalı adım bu.
// Bütçeyi aşan uygulamalar sırasız kalmıyor: sıra tabanlı bileşenler (ivme,
// yayılım, monetizasyon) yine hesaplanıyor, yalnız indirme/rating bileşenleri
// boş kalıyor ve skor kapsam oranıyla cezalanıyor.
export const PLAY_DETAIL_BUDGET = 2500;
export const PLAY_DETAIL_CONCURRENCY = 10;
export const PLAY_DETAIL_DELAY_MS = 60;

// SÜRE sınırı, istek sayısı sınırından daha önemli çıktı. Ölçüm: aynı 6.000
// detay isteği bir koşuda 7 dakika sürdü, 12 dakika sonraki koşuda 3 SAAT —
// Play throttle'a girdi. Üretimde koşular 2 gün arayla ama buna güvenilmez;
// süre aşılınca elde ne varsa onunla devam ediyoruz. Detayı alınamayan oyun
// radardan düşmüyor, sıra tabanlı bileşenlerle skorlanıyor.
export const PLAY_DETAIL_DEADLINE_MS = 10 * 60 * 1000;
export const APPLE_LOOKUP_DEADLINE_MS = 8 * 60 * 1000;

export const APPLE_LOOKUP_BATCH = 100;  // iTunes lookup tek istekte 100 id kabul ediyor
export const APPLE_FEED_CONCURRENCY = 6;

// Skor penceresi: ivme "bugün vs N gün önce" olarak hesaplanır.
// Toplama sıklığından BAĞIMSIZ tutuluyor — daha sık toplamaya geçilirse
// pencereyi değiştirmek tek satır, geçmiş veri zaten birikmiş olur.
export const SCORE_WINDOW_DAYS = 2;

// Bir snapshot ivme kıyası için "yeterince eski" sayılmadan önceki alt sınır.
// Sabit 0,5 gün yetmedi: 13 saatlik bir pencere sınırı geçip kademeleri
// şişirdi (patlama 3 -> 30). 1 günden kısa her pencere günün bir dilimini
// yarıda kesiyor; ABD akşamını sabahıyla kıyaslamak ivme değil saat farkı.
export const MIN_WINDOW_DAYS = Math.max(1, SCORE_WINDOW_DAYS * 0.5);
