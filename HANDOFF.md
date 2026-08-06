# Gaffur Handoff — Faz 3 Tamamlandı, Faz 4 Sırada

## Proje Nedir

gaffur.net — Fiyat takip → karşılaştırma platformu. Ürün URL'si ekle, sistem 15 dk'da bir tarar, fiyat düşünce Telegram'dan haber verir. Hedef: tek ürün takibinden çok-satıcılı fiyat karşılaştırma platformuna dönüşüm.

## Tech Stack

- **Backend:** TypeScript, Hono (API framework), Node.js + Docker (Coolify deploy)
- **Frontend:** React 19 SPA (Vite), tek CSS dosyası (vintage "esnaf tabelası" teması)
- **DB:** SQLite (varsayılan) veya Postgres (DATABASE_URL varsa). Migration'lar açılışta otomatik
- **Test:** Vitest (60 test — parsePrice + SSRF + Crawlee + kullanıcı + queue/rate + parser health), GitHub Actions CI
- **Bağımlılık:** hono, react, react-dom, postgres — başka runtime bağımlılık YOK

## Dosya Yapısı

```
src/worker/          Hono API + cron + scrape engine
  index.ts           Hono app export
  api.ts             REST rotaları (/api/*) — admin auth + kullanıcı auth + watches
  auth.ts            Tek parola (admin) + çok kullanıcılı hesap (users/sessions)
  cron.ts            15 dk zamanlayıcı
  db.ts              DB helpers, ensureOffer, writeOfferSnapshot
  telegram.ts        Telegram bildirimleri
  env.ts             Env interface
  scrape/
    engine.ts        scrapeUrl, checkProduct, applyPriceUpdate (dual-write offer), refreshListing
    parse.ts         Genel parser zinciri: JSON-LD → meta → gömülü JSON → regex
    sites.ts         Site tespiti, URL kanonlaştırma, Trendyol/HB/Amazon/N11 adaptörleri
    price.ts         parsePrice (TR/EN sayı biçimleri)
    ssrf.ts          SSRF koruması
src/web/             React SPA
src/server/          Node.js sunucu girişi
  index.ts           Express-benzeri serve (SQLite veya Postgres seçimi)
  d1.ts              SQLite D1 wrapper
  pg.ts              Postgres D1-uyumlu wrapper
src/shared/types.ts  Ortak tipler
migrations/          SQLite (*.sql) + Postgres (*.pg.sql) migration'ları
scripts/             Canlı test harness'ları, backfill script'leri
```

## Tamamlanan Fazlar

### SSRF Hotfix ✅
- `safeFetch`: DNS çözümü sonrası özel/loopback IP reddi, redirect zincirinde yeniden kontrol
- 34 SSRF test vakası

### Faz 0 — Acil Yamalar ✅
- `refreshListing` stok bug'ı düzeltildi (inStock artık geçiriliyor)
- Bildirim dedup: aynı product+kind 6 saat cooldown
- Liste URL'sinin ürün olarak eklenmesi engellendi
- robots.txt / llms.txt güncellendi

### Faz 1 — Zemin Temizliği ✅
1. **Workers hattı kaldırıldı (K7):** wrangler.jsonc, @cloudflare/workers-types silindi. Tek hedef Node/Docker
2. **Vitest + CI:** 47 test, GitHub Actions (typecheck + test)
3. **Postgres desteği:** PgD1 wrapper (`?` → `$1,$2...`, auto `RETURNING id`), dual DB (SQLite/Postgres)

### Faz 2 — Veri Modeli + Hesap Sistemi ✅
1. **Yeni tablolar:** offers, offer_snapshots, users, sessions, watches (SQLite + Postgres)
2. **Dual-write:** Her fiyat güncellemesinde offer + snapshot da yazılır (try/catch ile geriye uyumlu — tablo yoksa atlanır)
3. **Backfill:** `scripts/backfill-offers.ts` — mevcut price_history → offer_snapshots
4. **Kullanıcı hesap sistemi:**
   - `POST /api/auth/register` (email + parola + KVKK onayı)
   - `POST /api/auth/login` (rate limited)
   - `POST /api/auth/logout`
   - `GET /api/auth/me`
   - Parola: salt + SHA-256 hash, ayrı çerez (gfr_u), sessions tablosu
5. **Watches API:**
   - `GET /api/watches` (kullanıcının takip listesi)
   - `POST /api/watches` (ürün takibe al)
   - `DELETE /api/watches/:id`

## Sıradaki İş — Faz 4

### Faz 2 Kapanış ✅
- [x] Frontend: kullanıcı kayıt/giriş UI'ı + takip listesi (Hesabım modalı, ürün kartından takibe al/çıkar)
- [x] Watches'ı bildirim zincirine bağlama (kullanıcı bazlı uygulama içi hedef/düşüş/stok bildirimleri)
- [x] **K4c Spike:** Crawlee `CheerioCrawler` Trendyol bot korumasını aştı; Playwright gerekmedi

K4c canlı ölçümü (2026-08-06): aynı `airpods 4` arama URL'si mevcut `directFetch`
ile HTTP 403 / 4.899 bayt / 0 ürün verdi. Crawlee `CheerioCrawler` ile HTTP 200 /
~562 KB alındı ve mevcut `discoverTrendyol` parser'ı 8/8 ürün çıkardı. İlk ürün detayında
HTTP 200 / ~488 KB; AirPods 4 ANC = 8.499 TL ve stokta olarak çözüldü. Sonuç: Faz 3'te
varsayılan transport `CheerioCrawler` olabilir; Playwright yalnızca sonradan kanıtlanan
JS zorunlu domainler için whitelist edilmelidir.

### Faz 3 — Crawlee Tarama Altyapısı
- [x] `crawl_jobs` SQLite/Postgres kalıcı kuyruğu: atomik claim, dedup, retry/backoff, stale-lock recovery
- [x] Scheduler/queue/worker ayrımı (`crawl/scheduler.ts`, `crawl/queue.ts`, `crawl/worker.ts`)
- [x] Crawlee entegrasyonu (`@crawlee/cheerio`; direct → Crawlee)
- [x] Domain başına dağıtık rate limit + hata halinde adaptif backoff
- [x] Versiyonlu parser registry + saatlik hata oranı alarmı
- [x] Firecrawl kodu/ayarı/UI'sı söküldü; eski DB motorları migration ile `auto`ya taşındı
- [x] Kapsam canlı doğrulama: Vatan 8.499 TL/direct, İncehesap 999 TL/Crawlee,
  Hepsiburada 1.999,90 TL/direct, Apple TR 8.999 TL/direct (2026-08-06)

Kuyruk notu: scheduler yalnızca sırası gelen ürün/kategorileri kuyruğa yazar. Worker işleri
atomik `UPDATE … RETURNING` ile alır; aktif `(kind, entity_id)` partial unique index aynı
işin yinelenmesini engeller. Hatalar 1/2/4 dakika artan gecikmeyle en fazla 3 kez denenir;
30 dakikadan eski worker kilitleri otomatik kurtarılır.

Domain limiter notu: `crawl_domain_state` atomik slot dağıtır. Taban aralık Trendyol 3 sn,
Hepsiburada 2 sn, diğer domainler 1 sn. Ardışık hatalarda bekleme ikiye katlanır (üst sınır
15 dk), başarıda taban aralığa döner. Slot bekleyen job deneme hakkı tüketmeden ertelenir.

### Faz 4 — Stok Zekâsı + Gerçek Fiyat Referansı **← sıradaki**
- [ ] `price_baselines`: 10/30/90 gün medyanı, all-time low, gürültü filtresi
- [ ] `stock_transitions`: 2 ardışık doğrulama, unknown güvenliği, cooldown
- [ ] Stokta olmayan teklifleri en düşük fiyat hesabından çıkar
- [ ] Baseline ve stok geçişlerini API/UI'da mevcut tasarım diliyle göster

### Faz 5-8 Özet
- **Faz 5:** Kargo, taksit, landed cost (gümrük PDF teyidi ön koşul)
- **Faz 6:** Public SSR + SEO (ürün sayfaları, JSON-LD, sitemap)
- **Faz 7:** Bildirim kanalları (e-posta, web push), fırsat akışı, uyum iç aracı
- **Faz 8:** Katalog + ürün eşleştirme (Python servisi, Scrapy, embedding)

## Kritik Kararlar (değiştirilmemeli)

| # | Karar |
|---|-------|
| K1 | Halka açık ürün, Postgres + SSR + çok kullanıcılı baştan |
| K3 | Crawlee + Scrapy (Firecrawl sökülecek) |
| K4 | Erişilebilen sitelerle başla (Vatan, İncehesap, HB) |
| K5 | "Tüm satıcılar" iddiası kullanılmayacak, kapsam açıkça gösterilecek |
| K6 | Uyum rozeti iç araç, public'te sadece veri gösterilir |
| K7 | Workers hattı kapatıldı ✅ |

## Komutlar

```bash
npm run dev        # Vite dev server (API proxy 8787'ye)
npm start          # build + start:node (tam uygulama)
npm run check      # typecheck
npm test           # vitest (60 test)
npx tsx scripts/probe.ts <url>         # tek URL test
npx tsx scripts/backfill-offers.ts     # mevcut veri → offers tablosu
```

## Bilinen Sorunlar / Dikkat

- **Trendyol directFetch ile erişilemez:** bot koruması 403 veriyor; Crawlee CheerioCrawler canlı spike'ta 200 aldı
- **Gümrük oranları teyit edilmedi** (Karar 10813 PDF'i okunmadı)
- **Feed araştırması yapılmadı** (Trendyol/HB gelir ortaklığı programları)
- Mevcut canlı veri: 4 ürün, max 8 fiyat noktası — göç riski neredeyse sıfır

## Detaylı Plan

~800 satırlık tam plan `gaffur-plan-prompt.md` dosyasında. ADR'ler, risk tablosu, doğrulama kriterleri, mevzuat analizi (indirimli satış yönetmeliği, gümrük kararı) dahil.

CLAUDE.md'de güncel mimari bilgiler var — her zaman oraya bak.
