# Gaffur — gaffur.net Fiyat Takip → Karşılaştırma Platformu

Ürün fiyatlarını izleyen, düşüşte Telegram + uygulama içi bildirim gönderen,
fiyat geçmişini grafikle sunan web uygulaması. **Node/Docker (Coolify)** üzerinde çalışır;
DATABASE_URL varsa Postgres, yoksa SQLite. Türkçe arayüz, koyu tema,
vurgu rengi amber (#FFB020).

## Mimari

```
src/worker/          Cloudflare Worker (Hono API + cron)
  index.ts           fetch (Hono) + scheduled (cron) girişleri
  api.ts             REST rotaları (/api/*)
  auth.ts            Tek parola + HMAC imzalı cookie (admin) + çok kullanıcılı hesap (users/sessions)
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

Frontend'de yönetici oturumu ile kullanıcı hesabı ayrıdır: gizli `/yonetim` yolu tek
parolalı yönetimi açar; üst çubuktaki **Hesabım** akışı ise `users/sessions` tabanlı
kayıt, giriş ve çıkışı yönetir (`gfr_u` çerezi).

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
npm start          # build + start:node (tam uygulama, lokal SQLite)
npm run check      # iki tsconfig ile typecheck
npm test           # vitest (parsePrice + SSRF testleri)
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

1. Coolify'da ortam değişkeni: `PASSWORD=...`
2. Opsiyonel: `DATABASE_URL=postgres://...` (yoksa SQLite)
3. Build: `npm run build && npm run build:node`
4. Başlat: `node dist/server/index.mjs`
5. Uygulama ayarlarından Telegram bot + (istenirse) Firecrawl anahtarı gir

## Kurallar

- Yeni bağımlılık ekleme (hono, react, react-dom, postgres dışında runtime bağımlılık yok; grafik SVG el yapımı).
- UI metinleri basit Türkçe; emoji yok (▼▲◎ gibi unicode işaretler serbest).
- Fiyat karşılaştırmaları 0.01 toleransla (`applyPriceUpdate`).
- `local `.wrangler/` state'i ve `dist/` git'e girmez.
- Trendyol adaptörü bozulursa önce gerçek sayfada marker'ları kontrol et
  (bkz. Kritik Bilgiler) — `scripts/probe-listing.ts` hızlı teşhis içindir.
