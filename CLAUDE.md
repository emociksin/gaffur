# Gaffur — gaffur.net Fiyat Takip → Karşılaştırma Platformu

Ürün fiyatlarını izleyen, düşüşte uygulama içi + Telegram + isteğe bağlı e-posta/web push bildirimi gönderen,
fiyat geçmişini grafikle sunan web uygulaması. **Node/Docker (Coolify)** üzerinde çalışır;
DATABASE_URL varsa Postgres, yoksa SQLite. Türkçe arayüz, koyu tema,
vurgu rengi amber (#FFB020).

## Mimari

```
src/worker/          Node üzerinde çalışan Hono API + cron uygulama katmanı
  index.ts           Hono uygulaması ve route bağlama girişi
  api.ts             REST rotaları (/api/*)
  seo.ts             Public ürün/kategori SSR, JSON-LD, sitemap ve JSON uçları
  auth.ts            Tek parola + HMAC imzalı cookie (admin) + çok kullanıcılı hesap (users/sessions)
  cron.ts            15 dk'da bir: sırası gelen ürünler (parti 10) + oto kategori keşfi (6 saatte bir, parti 2)
  crawl/
    scheduler.ts     Sırası gelen ürün/kategorileri crawl_jobs kuyruğuna yazar
    queue.ts         Atomik claim, aktif iş dedup, retry/backoff, stale-lock recovery
    domain-rate.ts   Domain bazlı atomik slot + başarısızlıkta adaptif backoff
    worker.ts        Kuyruktaki işleri scrape engine ile çalıştırır
  db.ts              D1 yardımcıları, settings varsayılanları
  telegram.ts        sendMessage + getUpdates ile chat-id keşfi
  notifications/     E-posta, standart Web Push/VAPID, tercih ve teslimat kuyruğu
  intelligence/      Baseline/stok, landed cost, günlük fırsat ve 10 günlük iç uyum hesabı
  catalog/           Türkçe kimlik normalizasyonu, GTIN/MPN kontrolü, eşleştirme puanı ve onaylı katalog grupları
  scrape/
    crawlee.ts       CheerioCrawler transport; disksiz storage + her redirect'te SSRF doğrulama
    registry.ts      Site → kararlı parser sürümü dispatch'i
    parser-health.ts Saatlik başarı/hata sayacı; 10 örnek ve %50 hatada tek alarm
    price.ts         parsePrice (TR/EN sayı biçimleri), para birimi tespiti
    parse.ts         Genel katman: JSON-LD → meta/microdata → gömülü JSON → bağlamsal regex; bracedJson (brace-balance)
    sites.ts         Site tespiti, URL kanonlaştırma, Trendyol/HB/Amazon/N11 adaptörleri, discoverTrendyol (liste keşfi)
    engine.ts        scrapeUrl (direct→Crawlee), checkProduct, applyPriceUpdate (alarm mantığı), refreshListing
src/web/             React SPA (Vite) — dist/client'a derlenir, Worker assets olarak sunar
src/shared/types.ts  Ortak tipler
migrations/          D1 şema (categories, products, price_history, notifications, settings)
scripts/             Canlı test harness'ı (aşağıda)
public/              robots.txt, llms.txt, favicon (SEO dosyaları korunur)
docs/                Mayıs 2026 holding-page dönemi arşivi
```

Cron artık doğrudan tarama yapmaz: `scheduleDueJobs` kalıcı `crawl_jobs` kayıtlarını
üretir, `runQueuedJobs` atomik claim ile işleri çalıştırır. Kuyruk SQLite ve Postgres'te
aynı SQL davranışını kullanır; aktif varlık başına yalnız bir queued/running iş olabilir.

Frontend'de yönetici oturumu ile kullanıcı hesabı ayrıdır: `/` her zaman public fiyat
vitrinidir; yönetici çerezi bulunsa bile operasyon kontrolleri burada gösterilmez. Gizli
`/yonetim` yolu tek parolalı yönetimi açar ve ürün ekleme, toplu kontrol, bildirimler ile
ayarları içerir. Üst çubuktaki **Hesabım** akışı ise `users/sessions` tabanlı kayıt, giriş ve
çıkışı yönetir (`gfr_u` çerezi). Public kart başlıkları kanonik `/urun/{id}-{slug}` sayfasına,
kategori bağlantıları `/kategori/{id}-{slug}` sayfasına gider.

Kullanıcılar ürün kartından kendi `watches` listelerine ürün ekleyip çıkarır. Watch
eşikleri her fiyat güncellemesinde değerlendirilir; kişisel bildirimler
`notifications.user_id/watch_id` ile operasyon bildirimlerinden ayrılır ve Hesabım
ekranında gösterilir. Faz 7 ile doğrulanmış e-posta ve tarayıcı Web Push kanalları,
`instant`/`daily` tercihi, teslimat retry kuyruğu ve tek tık dış kanal iptali eklendi.
Kişisel bildirimler global yönetici Telegram sohbetine gönderilmez.

Faz 4 fiyat/stok zekâsı `src/worker/intelligence/` altındadır. Stok durumu
`in_stock/out_of_stock/preorder/unknown` olarak tutulur; değişim ancak iki ardışık aynı
gözlemde doğrulanır. `unknown` geçiş değildir, üç ardışık unknown `parser_error` bayrağı
açar. Fiyat referansı önceki tek fiyat değil 30 günlük medyandır; %2 altı hareket
bildirim gürültüsü sayılır. Stok dışı fiyatlar baseline, extrema ve fırsat hesabına girmez.

Faz 5 lojistik/maliyet katmanı `src/worker/intelligence/landed-cost.ts` ve
`migrations/0012_phase5_landed_cost.sql` / `0009_phase5_landed_cost.pg.sql` içindedir.
Kargo ve açık taksit sayısı parser çıktısından offer snapshot'a yazılır; ayrıntılı manuel
seçenekler `shipping_quotes` ve `installment_options` tablolarındadır. Vergi kuralları
kaynak/tarih ile versiyonlanır, kaydedilen hesap `rule_code` tutar. Kritik mevzuat
gerçeği: 6 Şubat 2026 sonrası genel posta e-ticaret ürününe %30/%60 doğrudan uygulanmaz;
ürün detaylı beyana tabidir ve GTİP olmadan kesin vergi hesaplanmaz. Bu oranlar uygun
ilaç/takviye ve yolcu senaryolarında geçerlidir. Kaynak kaydı:
`docs/phase5-legal-sources.md`.

Faz 6 public katmanı `src/worker/seo.ts` içindedir. `/urun/{id}-{slug}` ve
`/kategori/{id}-{slug}` mevcut Vite HTML/CSS kabuğunu kullanarak sunucuda tam HTML üretir;
React bu sayfalarda `data-gaffur-ssr` işareti nedeniyle statik içeriği silmez. Ürün sayfası
Product + AggregateOffer + BreadcrumbList JSON-LD, görünür SVG grafik ve günlük HTML fiyat
tablosu içerir. Kategori sayfasında ItemList bulunur. Ürün ancak en az iki aktif teklif veya
en az 30 günlük geçmiş varsa indekslenir; sorgu parametreli ve kanıtı yetersiz sayfalar
`noindex, follow` olur. Aktif/arşiv/kategori sitemapleri ile `/urun/{slug}.json` publictir.
Pasif ürün silinmez; son kayıtlı fiyat açıklamasıyla arşivde kalır. `PUBLIC_BASE_URL` canonical
origin'i belirler (prod değeri: `https://gaffur.net`).

Faz 7 günlük işleri `opportunity_feed` ve `compliance_assessments` snapshot tablolarını
cron içinde günde bir yeniler; public fırsat GET'i istek anında ağır hesap yapmaz. Fırsatlar
30 günlük medyanı ve all-time low'u kullanır, stok dışı ürünleri dışlar. 10 günlük fiyat aracı
yalnız `/yonetim` içindeki **Uyum** sekmesindedir; hukuki “ihlal” kararı üretmez ve CSV kanıtı
verir. Birincil kaynak ve sınırlamalar `docs/phase7-legal-sources.md` içindedir. Dış kanal
sağlayıcıları yoksa teslimat `sent` olmaz; yapılandırma bekleyen kuyruk olarak kalır.

Faz 8 katalog katmanı `src/worker/catalog/` altındadır. Ürün başlığı Türkçe karakterleri ve
yaygın renk/kapasite biçimleriyle normalize edilir; GTIN yalnız GS1 kontrol basamağı geçerliyse,
MPN ise harf+rakam ve marka tutarlılığı kapılarını geçerse kesin kod sinyali sayılır. Marka veya
varyant çatışması eşleşmeyi sert biçimde reddeder. Başlık/model/fiyat puanı eşiği geçen adaylar
`product_match_candidates` insan kuyruğuna düşer; ilk sürümde yüksek puanlı aday bile otomatik
birleşmez. Yönetici **Katalog** sekmesinde onay verdiğinde `catalog_products` ve
`catalog_memberships` kanonik grubu oluşur. Match rate ile insan kararlarından türetilen precision
birlikte gösterilir; %98 hedefi en az 30 incelenmiş aday olmadan geçmiş sayılmaz. Günlük cron
kimlik ve adayları yeniler, onay/ret kararlarını korur. Scrapy/Python sınırı ve çalıştırılabilir
JSONL sözleşme spike'ı `docs/adr-008-scrapy-matching-boundary.md` içindedir; üretime ikinci runtime
eklenmemiştir.

Faz 9 talep keşif katmanı `src/worker/catalog/trend-seeds.ts` ve `trends.ts` içindedir. Google
Trends Türkiye / son 12 ay / Bilgisayarlar ve Elektronik Ürünler kapsamından elle doğrulanmış 50
ürün, kategori, marka ve aksesuar sinyali tutulur. Bunlar fiyatı olan `products` kaydı değildir.
Her sinyal kaynak terimini, kaynak içi sırasını, göreli 0–100 değerini veya yükseliş etiketini,
snapshot tarihini ve Google Trends doğrulama URL'sini taşır. Farklı kaynak grupları arasında mutlak
1–50 sıralaması iddia edilmez. Açılıştaki idempotent seed yönetici `published/hidden` ve gerçek ürün
eşleştirme kararlarını korur. Public uç `/api/trends/catalog`, yönetim uçları
`/api/trends/catalog/admin` ve `PATCH /api/trends/catalog/{id}`. Metodoloji:
`docs/phase9-google-trends-methodology.md`.

## Kritik Bilgiler (2026-08-02 canlı doğrulamadan)

- **Trendyol 2026 mimarisi değişti:** Arama/kategori verisi artık
  `window["__single-search-result__PROPS"].data.products` içinde (eski
  `__SEARCH_APP_INITIAL_STATE__` yedek olarak duruyor). Ürün detayında eski state YOK;
  güvenilir inline kaynak **JSON-LD** (offers.price). Fiyat alanları:
  `price.discountedPrice ?? current ?? sellingPrice`; `image` ImageObject `contentUrl`
  DİZİ olabilir (parse.ts destekler). Gerçek HTML üzerinde doğrulandı: 24 ürün, AirPods 4
  = 8.499 (eski 8.799).
- **Transport gerçeği:** Bot koruması istemci parmak izine göre farklı davranıyor.
  Bu makinede Node(undici) → Hepsiburada 200; workerd (wrangler dev) → aynı URL 403.
  Trendyol/N11/Teknosa/Amazon datacenter'a kapalı. **workerd üzerinden canlı çalışan
  siteler: Vatan, İncehesap** (genel JSON-LD parser ile uçtan uca doğrulandı).
  Bot korumalı sitelerde yerleşik Crawlee transport'u kullanılır; harici servis anahtarı gerekmez.
- **K4c Crawlee spike (2026-08-06):** Aynı Trendyol `sr?q=airpods+4` URL'sinde
  `directFetch` 403/4.899 bayt ve 0 ürün verirken Crawlee `CheerioCrawler`
  200/~562 KB aldı; `discoverTrendyol` 8 ürün çıkardı. İlk ürün detayı da 200/~488 KB,
  AirPods 4 ANC 8.499 TL ve stokta olarak mevcut parser ile çözüldü. Playwright gerekmedi.
  Faz 3 transport varsayılanı CheerioCrawler; Playwright yalnız kanıtlanan JS-zorunlu
  domainler için whitelist.
- **Alarm zinciri doğrulandı:** 89.999→84.999 senaryosunda notification 'drop' (%5.6),
  fırsat şeridi (%7.6/7g), grafik, CSV (BOM+noktalı virgül, Excel-TR) çalışıyor.
- Kategori takibi = Trendyol liste URL'si kaynaklı kategori: `refreshListing` tek fetch'le
  N ürünün fiyatını günceller + yeni ürünleri ekler (interval_min=720 ile eklenir, liste
  güncellemesi last_checked_at'i ilerlettiği için tekil kontrole nadir düşer).
- Subrequest limiti (ücretsiz plan 50/çalıştırma): cron partisi 10 ürün, check-all partisi 8
  (frontend remaining>0 iken döngüyle sürdürür).
- parsePrice 20 birim testinden geçiyor ('8.499'→8499, '1.299,90'→1299.9, '1,299.90'→1299.9,
  '394.32'→394.32 — çok noktalı binlik Mutabakat dersi).

## Komutlar

```bash
npm run dev        # sadece Vite (API proxy 8787'ye)
npm start          # build + start:node (tam uygulama, lokal SQLite)
npm run check      # iki tsconfig ile typecheck
npm test           # vitest (106 test; tüm fazlar + Faz 9 kaynaklı trend kataloğu)
npx tsx scripts/probe.ts <url>     # tek URL canlı çözümleme (Node'dan)
npx tsx scripts/probe-sites.ts     # hangi siteler doğrudan erişime açık
```

## Veritabanı

`DATABASE_URL` ortam değişkeni varsa **Postgres**, yoksa **SQLite** (`data/gaffur.db`).
Migration'lar açılışta otomatik uygulanır (SQLite: `*.sql`, Postgres: `*.pg.sql`).

SQLite → Postgres göçü:
```bash
DATABASE_URL=postgres://... npx tsx scripts/backfill-pg.ts
```

## Deploy (gaffur.net — Coolify/Docker)

1. Coolify'da zorunlu ortam değişkenleri: `PASSWORD=...`, `PUBLIC_BASE_URL=https://gaffur.net`
2. Opsiyonel DB: `DATABASE_URL=postgres://...` (yoksa SQLite)
3. E-posta için: `RESEND_API_KEY`, `EMAIL_FROM` (ör. `Gaffur <bildirim@gaffur.net>`)
4. Web Push için `npm run vapid:generate` çıktısındaki `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` değerlerini Coolify secret olarak ekle
5. Build: `npm run build && npm run build:node`
6. Başlat: `node dist/server/index.mjs`
7. Uygulama ayarlarından Telegram botunu bağla

## Kurallar

- Yeni bağımlılık ekleme (`@crawlee/cheerio`, hono, react, react-dom, postgres dışında runtime bağımlılık yok; grafik SVG el yapımı).
- UI metinleri basit Türkçe; emoji yok (▼▲◎ gibi unicode işaretler serbest).
- Fiyat karşılaştırmaları 0.01 toleransla (`applyPriceUpdate`).
- Google Trends sinyallerini mutlak arama hacmi, satış adedi veya kaynaklar arası kesin sıralama gibi gösterme.
- `local `.wrangler/` state'i ve `dist/` git'e girmez.
- Trendyol adaptörü bozulursa önce gerçek sayfada marker'ları kontrol et
  (bkz. Kritik Bilgiler) — `scripts/probe-listing.ts` hızlı teşhis içindir.
