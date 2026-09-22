# Hype Radar

Kısa sürede tutan mobil oyunları yakalamak için market radarı. App Store ve Google Play
chart'larını düzenli tarar, her oyuna bir **hype skoru** verir ve sonucu tek bir panelde gösterir.

**Panel:** https://yildirimalperen.github.io/hype-radar/
**Makine-okunur çıktı:** https://yildirimalperen.github.io/hype-radar/radar.json

> Sayfa herkese açıktır. Veri zaten halka açık mağaza chart'larından geliyor,
> ancak skor formülü ve ağırlıklar da bu repo ile birlikte açıktır.

---

## Soru: "hype" nasıl belirleniyor?

Büyüklük ile ivme farklı şeyler. Candy Crush büyüktür ama hype değildir; 70 günlük bir oyunun
5 ülkede birden hasılat ilk 40'a girmesi hype'tır. Skor bu ayrımı yapmak için 7 bileşenden oluşur:

| Bileşen | Ağırlık | Ne ölçüyor |
|---|---|---|
| Sıra ivmesi | %26 | Pencere içinde chart sırasındaki hareket, **log ölçekte** — 60→10 hareketi 95→85'ten çok daha değerli |
| İndirme hızı | %18 | Pencere içinde günlük indirme (Play) / değerlendirme (iOS) artışı |
| Yaşam boyu hız | %16 | Çıkıştan bu yana günlük ortalama indirme — **tek taramada da çalışır** |
| Ülke yayılımı | %12 | Kaç ülkede, hangi pazar ağırlığıyla chart'ta |
| Yeni giriş | %10 | Chart'a bu turda ilk kez girdiği ülkelerin oranı |
| Para kazanma | %12 | Hasılat sırasının ücretsiz sırasına üstünlüğü |
| Yaş | %6 | Genç oyun çarpanı |

Her bileşen **kohort içi yüzdelik sıraya** çevrilir (aykırı değerlere dayanıklı), ağırlıklı toplanır.
Ölçülemeyen bileşenin ağırlığı kalanlara dağıtılır, ama satır ayrıca **kapsam oranıyla**
cezalandırılır — yoksa az bileşenli bir oyun şişmiş skor alır.

Kademeler: **Patlama** (180 günden genç + hype ≥ 60) · **Yükselen** (hype ≥ 45) ·
**Zirve** (bir ülkede hasılat ilk 20) · **İzlemede**.

### Soğuk başlangıç
İlk taramada geçmiş yoktur, yani "sıra ivmesi" ve "indirme hızı" hesaplanamaz. Radar yine de
anlamlı çalışır: *yaşam boyu hız*, *yayılım*, *para kazanma* ve *yaş* tek taramadan gelir.
İkinci taramadan sonra ivme bileşenleri devreye girer ve skor keskinleşir.

---

## Veri: ölçülen vs. tahmin edilen

Bu ayrım panelde de görünür — tahmini sayılar `≈` ve kesikli altı çizili gösterilir.

**Ölçülen** (ücretsiz, anahtarsız):
- Chart sırası — App Store (ücretsiz/ücretli/hasılat/yeni) + Google Play (ücretsiz/ücretli/hasılat), ülke başına ilk 100
- **Google Play kümülatif kurulum** — gerçek sayı, tahmin değil
- Değerlendirme sayısı ve puanı, her iki mağaza
- **Play IAP fiyat aralığı** (ör. `$0.99 - $149.99 per item`)
- Çıkış ve son güncelleme tarihi

**Tahmin edilen:**
- **iOS indirme** — Apple indirme vermiyor. Sabit katsayı gömülü değil: her taramada
  iOS↔Android eşleşmiş oyunlardan medyan `kurulum / değerlendirme` oranı hesaplanıp
  iOS değerlendirme sayısına uygulanır. (İlk koşu: 387 çiftten 1 değerlendirme ≈ 40,8 indirme.)
- **Günlük net IAP geliri** — hiçbir mağaza ücretsiz vermiyor. Hasılat sırasından güç yasası
  ile modellenir: `gün_geliri ≈ 1.624.000 × sıra^-0,80`, ülke pazar ağırlığı ve platform ARPU
  farkıyla ölçeklenir (`src/estimate.js`). **Bu bir model, ölçüm değil.**

### Gelir modelinin kalibrasyonu

Sabitler kafadan atılmıyor; ölçülen bir hataya bağlı (`src/calibrate-revenue.js`).

2026-08 dönemine ait **15 üçüncü taraf gelir tahmini** çapa olarak kullanıldı
(`data/calibration/revenue-anchors.json`). Sonuç:

| | önce | sonra |
|---|---|---|
| medyan model/bildirilen oranı | 0,50× | **1,01×** |
| 2 kat içinde kalan çapa | 7/15 | **15/15** |
| log-RMSE | 0,734 | **0,192** |

Yani model sistematik olarak **2 kat düşük** tahmin ediyormuş; düzeltilen ölçek (`A`) oldu.
**Eğim (`b`) değiştirilmedi** — çapaların 14'ü ilk 10 sırada olduğu için eğimi neredeyse hiç
kısıtlamıyorlar (hata `b` boyunca düz). Serbest fit eğimi 0,666'ya yatırıyor ama bu bir kanıt
değil, alt sıra verisinin yokluğunun yan etkisi: elimizdeki tek alt-sıra çapasında hatayı
1,40×'ten 1,72×'e **çıkarıyor**.

Bilinen sınırlar:
- **Sağlayıcılar birbirine ~%40 uymuyor.** Royal Match 2026-08: bir kaynakta $108,8M, diğerinde
  $66,5M — ve oran tüm oyunlarda ~0,6 sabit. Şekil konusunda hemfikirler, seviye konusunda değil.
  Mutlak belirsizlik en az ±%40.
- **İlk 20 dışı ekstrapolasyon.** Kamuya açık rakamlar tepede yoğunlaşıyor; alt sıralar için
  tek düşük-güvenli çapamız var.
- **Çapalar da tahmin.** AppMagic/Sensor Tower yayıncı beyanı değil. "Gerçeğe uyum" değil,
  "sektör tahminleriyle tutarlılık" ölçüyoruz.

Çapa eklemek: `data/calibration/revenue-anchors.json`'a satır ekleyip
`node src/calibrate-revenue.js` koşturun — hatanın düştüğünü görün, sonra `--write`.
Ücretli bir sağlayıcıya geçilecekse tek değişiklik noktası yine `src/estimate.js`.

---

## Kurulum ve çalıştırma

```bash
npm install
node src/collect.js      # yeni snapshot topla (~4 dk, 8 ülke)
node src/publish.js      # skorla + paneli derle -> web/dashboard.html
./refresh.sh             # üçünü birden yap + Artifact'i güncelle
```

Kapsam `src/config.js` içinde: ülke listesi, chart derinliği, eşzamanlılık.

### Otomatik tazeleme
GitHub Actions (`.github/workflows/radar.yml`) 2 günde bir çalışır: tarar, skorlar,
`docs/` çıktısını üretir ve commit eder. Pages `main` dalının `docs/` klasöründen
servis edildiği için **commit = yayın**; ayrı bir deploy adımı yoktur.

```bash
gh workflow run "Hype Radar tazeleme"    # elle tetikle
gh run list --workflow radar.yml         # son koşular
```

Geçmiş `data/snapshots/` altında sıkıştırılmış JSON olarak yaşar; runner temiz
başladığı için DB her koşuda bu dosyalardan yeniden kurulur. Bu sayede paneli
yeniden toplamadan da üretebilirsiniz:

```bash
node src/publish.js    # DB yoksa snapshot'lardan kurar
```

Toplama sıklığı ile skor penceresi ayrıdır: cron'u sıklaştırırsanız geçmiş daha
ince granülerlikte birikir, pencereyi `SCORE_WINDOW_DAYS` ile ayarlarsınız.

---

## Mimari

```
src/config.js          kapsam (ülkeler, chart'lar, limitler)
src/db.js              SQLite şeması (node:sqlite, bağımlılıksız)
src/sources/apple.js   iTunes RSS chart + Lookup zenginleştirme
src/sources/play.js    Google Play chart + uygulama detayı
src/link.js            iOS <-> Android eşleştirme
src/collect.js         toplama orkestrasyonu -> snapshot
src/score.js           hype skoru
src/estimate.js        TAHMİN katmanı (gelir modeli, indirme kalibrasyonu)
src/calibrate-revenue.js  gelir eğrisini çapalara fit eder + hata raporu
src/snapshot-io.js     snapshot dışa/içe aktarma (repo'da taşınan geçmiş)
src/report.js          çapraz-platform birleştirme -> data/radar.json
src/publish.js         panel HTML üretimi
web/template.html      panel arayüzü
data/radar.db          yerel SQLite (izlenmiyor, snapshot'lardan kurulur)
data/snapshots/        taşınabilir snapshot geçmişi (izleniyor, 90 dosyada budanır)
docs/                  yayınlanan panel (GitHub Pages kaynağı)
```

Veri `data/radar.db` içinde birikir; her tazeleme yeni bir snapshot ekler, eskisi silinmez.
İvme sinyalleri bu geçmişten gelir, dolayısıyla radar her turda biraz daha isabetli olur.

### Toplama sırasında bilinen tuzaklar
- Apple'ın `newfreeapplications` beslemesi `genre=6014` filtresini **yok sayıyor** — oyun olmayan
  uygulamalar chart'a sızıyor. `collect.js` bunları Lookup'tan gelen tür listesiyle eliyor
  (ilk koşuda 364 iOS kaydının 88'i bu şekilde elendi).
- Google Play chart listesi sayfa HTML'inde değil, lazy-load RPC ile geliyor; bu yüzden
  chart tarafı `google-play-scraper` (Node) üzerinden çekiliyor.
- Play detayında kesin kurulum sayısının alanı `maxInstalls` (Python kütüphanesindeki
  `realInstalls` karşılığı), `updated` ise milisaniye.
- Artifact CSP dış görselleri engelliyor, bu yüzden panelde mağaza ikonu yerine başlıktan
  türetilen renkli karo çiziliyor.
