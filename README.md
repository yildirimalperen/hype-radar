# Hype Radar

Kısa sürede tutan mobil oyunları yakalamak için market radarı. App Store ve Google Play
chart'larını düzenli tarar, her oyuna bir **hype skoru** verir ve sonucu tek bir panelde gösterir.

**Panel:** https://claude.ai/artifact/Gosp4EqcjQ1bPso98dXKig

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
- **Günlük gelir** — hiçbir mağaza ücretsiz vermiyor. Hasılat sırasından güç yasası ile
  modellenir: `gün_geliri ≈ 800.000 × sıra^-0,80`, ülke pazar ağırlığı ve platform ARPU farkıyla
  ölçeklenir (`src/estimate.js`). **Bu bir model, ölçüm değil.** Zirvedeki birkaç oyunda
  gerçeğin altında kalma eğilimindedir; büyüklük mertebesi doğru, kesin rakam değil.
  Ücretsiz oyunlarda gelir pratikte IAP geliridir.

Gerçek gelir rakamı gerekirse tek değişiklik noktası `src/estimate.js` — oraya
Sensor Tower / Appfigures gibi ücretli bir sağlayıcı bağlanabilir, radarın geri kalanı aynı kalır.

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
`launchd` işi 2 günde bir `refresh.sh` çalıştırır:

```bash
launchctl list | grep hyperadar          # durum
tail -f data/refresh.log                 # günlük
launchctl unload ~/Library/LaunchAgents/ai.hyperadar.refresh.plist   # durdur
```

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
src/report.js          çapraz-platform birleştirme -> data/radar.json
src/publish.js         panel HTML üretimi
web/template.html      panel arayüzü
data/radar.db          snapshot geçmişi (her koşu birikir)
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
