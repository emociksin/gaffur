# Gaffur — gaffur.net Fiyat Takip Uygulaması

Ürün/kategori fiyatlarını izleyen, düşüşte Telegram + uygulama içi bildirim gönderen,
fiyat geçmişini grafikle sunan kişisel web uygulaması. **Cloudflare Workers + D1 + Cron
Trigger** üzerinde çalışır; sunucu yok, ücretsiz katman yeterli. Türkçe arayüz, koyu tema,
vurgu rengi amber (#FFB020).

## Mimari

```
src/worker/          Cloudflare Worker (Hono API + cron)
  index.ts           fetch (Hono) + scheduled (cron) girişleri
  api.ts             REST rotaları (/api/*)
  auth.ts            Tek parola + HMAC imzalı cookie (PASSWORD secret'i yoksa açık mod)
  cron.ts            15 dk'da bir: sırası gelen ürünler (parti 10) + oto kategori keşfi (6 saatte bir, parti 2)
  db.ts              D1 yardımcıları, settings varsayılanları
  telegram.ts        sendMessage + getUpdates ile chat-id keşfi
  scrape/
    price.ts         parsePrice (TR/EN sayı biçimleri), para birimi tespiti
    parse.ts         Genel katman: JSON-LD → meta/microdata → gömülü JSON → bağlamsal regex; bracedJson (brace-balance)
    sites.ts         Site tespiti, URL kanonlaştırma, Trendyol/HB/Amazon/N11 adaptörleri, discoverTrendyol (liste keşfi)
    engine.ts        scrapeUrl (direct→Firecrawl fallback), checkProduct, applyPriceUpdate (alarm mantığı), refreshListing
src/web/             React SPA (Vite) — dist/client'a derlenir, Worker assets olarak sunar
src/shared/types.ts  Ortak tipler
migrations/          D1 şema (categories, products, price_history, notifications, settings)
scripts/             Canlı test harness'ı (aşağıda)
public/              robots.txt, llms.txt, favicon (SEO dosyaları korunur)
docs/                Mayıs 2026 holding-page dönemi arşivi
```

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
  Kapalı siteler için çözüm ayarlardan **Firecrawl anahtarı** (auto modda önce ücretsiz
  doğrudan denenir, kredi boşa gitmez). Firecrawl yolu canlı test EDİLMEDİ (anahtar yok) —
  REST çağrısı `POST v2/scrape formats:["rawHtml"]`, dönen HTML aynı parser zincirinden geçer.
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
npm start          # build + wrangler dev :8787 (tam uygulama, lokal D1)
npm run check      # iki tsconfig ile typecheck
npm run db:local   # migration'ları lokal D1'e uygula
npm run deploy     # build + wrangler deploy
npx tsx scripts/test-parse.ts      # parsePrice birim testleri (her parser değişikliğinde çalıştır)
npx tsx scripts/probe.ts <url>     # tek URL canlı çözümleme (Node'dan)
npx tsx scripts/probe-sites.ts     # hangi siteler doğrudan erişime açık
node scripts/probe-workerd.mjs     # wrangler dev AYAKTAYKEN: workerd üzerinden gerçek site testi
```

## Deploy (gaffur.net)

1. `npx wrangler login`
2. `npx wrangler d1 create gaffur-db` → çıkan id'yi `wrangler.jsonc` → `database_id`'ye yaz
3. `npm run db:remote`
4. `npx wrangler secret put PASSWORD` (uygulama giriş parolası)
5. `npm run deploy`
6. Cloudflare dash → Workers & Pages → gaffur → Settings → Domains & Routes → **Add custom domain: gaffur.net** (DNS zaten Cloudflare'de, otomatik bağlanır)
7. Uygulama ayarlarından Telegram bot + (istenirse) Firecrawl anahtarı gir

## Kurallar

- Yeni bağımlılık ekleme (hono, react, react-dom dışında runtime bağımlılık yok; grafik SVG el yapımı).
- UI metinleri basit Türkçe; emoji yok (▼▲◎ gibi unicode işaretler serbest).
- Fiyat karşılaştırmaları 0.01 toleransla (`applyPriceUpdate`).
- `local `.wrangler/` state'i ve `dist/` git'e girmez.
- Trendyol adaptörü bozulursa önce gerçek sayfada marker'ları kontrol et
  (bkz. Kritik Bilgiler) — `scripts/probe-listing.ts` hızlı teşhis içindir.
