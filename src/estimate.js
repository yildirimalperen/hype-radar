// TAHMİN KATMANI — burada üretilen hiçbir sayı ölçülmüş değildir.
// Gelir verisini ücretsiz veren mağaza yok; grossing sırasından modelleniyor.
// Tüm sabitler burada ve tek yerde ayarlanabilir. Çıktıda source='estimated' etiketi taşır.
//
// Kalibrasyon: data/calibration/revenue-anchors.json + src/calibrate-revenue.js.
// Sabitleri elle oynatmayın; çapa ekleyip fit'i yeniden koşturun ki değişiklik
// ölçülmüş bir hata düşüşüne dayansın.
//
// ARTIK BİLİNEN BELİRSİZLİK: sağlayıcılar aynı oyun ve ay için ~%40 farklı
// rakam veriyor (ör. Royal Match 2026-08: bir kaynakta $108,8M, diğerinde $66,5M;
// oran tüm oyunlarda ~0,6 sabit). Yani eğrinin ŞEKLİ konusunda hemfikirler,
// SEVİYESİ konusunda değil. Model AppMagic seviyesine kalibre; mutlak rakamın
// taban belirsizliği en az ±%40'tır.

// ABD iOS top-grossing oyun geliri için güç yasası: gün_geliri ≈ A * rank^(-b)
//
// NE TAHMİN EDİYOR: net IAP geliri — mağaza komisyonu düşülmüş, reklam geliri ve
// web-shop/D2C harcaması HARİÇ. Bu tanım çapa kaynaklarının tanımıdır.
//
// A (ölçek), 2026-08 dönemine ait 15 üçüncü taraf gelir tahminine fit edildi
// (`node src/calibrate-revenue.js`). Öncesi A=800.000 idi ve sistematik olarak
// 2 kat düşük tahmin ediyordu: medyan oran 0,50×, çapaların 7/15'i 2 kat içinde.
// Sonrası: medyan 1,01×, 15/15 çapa 2 kat içinde, log-RMSE 0,734 -> 0,192.
//
// b (eğim) DEĞİŞTİRİLMEDİ. Çapaların 14'ü ilk 10 sırada olduğu için eğimi
// neredeyse hiç kısıtlamıyorlar — hata b boyunca düz (bkz. eğim taraması).
// Serbest fit b'yi 0,666'ya yatırıyor ama bu bir kanıt değil, alt sıra verisinin
// yokluğunun yan etkisi: tek alt-sıra çapasında hatayı 1,40×'ten 1,72×'e ÇIKARIYOR.
// Eğimi değiştirmek için ilk 20 dışından gerçek veri gerekir.
export const REV_CURVE = { A: 1_624_000, b: 0.8 };

// Ülke pazar çarpanı (ABD = 1.0). Mağaza geliri büyüklüğüne göre kaba ölçek.
export const COUNTRY_REV_WEIGHT = {
  us: 1.00, jp: 0.55, kr: 0.30, gb: 0.12, de: 0.12, fr: 0.08, br: 0.05, tr: 0.02,
};

// Aynı sırada Play geliri iOS'un altında kalır (ARPU farkı).
export const PLATFORM_REV_FACTOR = { ios: 1.0, android: 0.75 };

// 8 ülke global oyun gelirinin tamamını kapsamıyor; kalanı için tek çarpan.
export const GLOBAL_COVERAGE_UPLIFT = 1.6;

/**
 * Günlük gelir tahmini. ranks: [{country, chart:'grossing', rank}]
 * Sadece grossing sıraları kullanılır; grossing'de hiç yoksa null döner
 * (uydurmak yerine "bilinmiyor" demeyi tercih ediyoruz).
 */
export function estimateDailyRevenue(store, ranks) {
  const grossing = ranks.filter((r) => r.chart === 'grossing');
  if (!grossing.length) return null;
  let total = 0;
  for (const r of grossing) {
    const cw = COUNTRY_REV_WEIGHT[r.country] ?? 0.03;
    total += REV_CURVE.A * Math.pow(r.rank, -REV_CURVE.b) * cw;
  }
  return Math.round(total * (PLATFORM_REV_FACTOR[store] ?? 1) * GLOBAL_COVERAGE_UPLIFT);
}

/**
 * iOS indirme tahmini. Apple indirme vermiyor; oran her koşuda
 * iOS↔Android eşleşmiş çiftlerden kendi verimizle kalibre ediliyor
 * (sabit katsayı gömmüyoruz).
 */
export function calibrateInstallsPerRating(linkedPairs) {
  const ratios = linkedPairs
    .filter((p) => p.androidInstalls > 0 && p.androidRatings > 0)
    .map((p) => p.androidInstalls / p.androidRatings)
    .sort((a, b) => a - b);
  if (ratios.length < 5) return 55; // yedek: sektör genelinde ~1 rating / 50-60 indirme
  return ratios[Math.floor(ratios.length / 2)]; // medyan, uçlara dayanıklı
}

export function estimateIosInstalls(ratingCount, installsPerRating) {
  if (!ratingCount) return null;
  return Math.round(ratingCount * installsPerRating);
}
