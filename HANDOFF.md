# Gaffur Handoff — Faz 9 Tamamlandı, Talep Sinyallerinden Ürün Keşfi Sırada

## Proje Nedir

gaffur.net — Fiyat takip → karşılaştırma platformu. Ürün URL'si ekle, sistem 15 dk'da bir tarar, fiyat düşünce Telegram'dan haber verir. Hedef: tek ürün takibinden çok-satıcılı fiyat karşılaştırma platformuna dönüşüm.

## Tech Stack

- **Backend:** TypeScript, Hono (API framework), Node.js + Docker (Coolify deploy)
- **Frontend:** React 19 SPA (Vite), tek CSS dosyası (vintage "esnaf tabelası" teması)
- **DB:** SQLite (varsayılan) veya Postgres (DATABASE_URL varsa). Migration'lar açılışta otomatik
- **Test:** Vitest (106 test — önceki paket + Faz 9 kaynaklı trend kataloğu), GitHub Actions CI
- **Bağımlılık:** hono, react, react-dom, postgres — başka runtime bağımlılık YOK

## Dosya Yapısı

```
src/worker/          Hono API + cron + scrape engine
  index.ts           Hono app export
  seo.ts             Public ürün/kategori SSR, JSON-LD, sitemap ve JSON uçları
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

## Sıradaki İş — Talep Sinyalinden Gerçek Ürün Keşfi

Faz 9 talep kataloğu fiyatı veya satıcı URL'si olmayan keşif sinyalleridir. Sıradaki iş, yönetimdeki
50 sinyalden öncelik seçip erişilebilir satıcılarda gerçek ürün URL'lerini keşfetmek, onları normal
`products/offers` hattına almak ve talep kaydıyla ilişkilendirmektir. Faz 8 üretim doğrulaması da
devam eder: en az 30 insan kararıyla ölçülen precision ≥ %98 kapısından geçirilmelidir.

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

### Faz 4 — Stok Zekâsı + Gerçek Fiyat Referansı ✅
- [x] `price_baselines`: 10/30/90 gün medyanı, 10 gün en düşük, all-time low
- [x] Bildirimlerde 30 günlük medyan referansı ve %2 gürültü filtresi
- [x] `stock_transitions`: 2 ardışık doğrulama, unknown geçiş güvenliği, 3 unknown parser bayrağı
- [x] 6 saat bildirim cooldown'u korunarak yalnız doğrulanmış stok geçişinde alarm
- [x] Stok dışı fiyatları baseline, extrema ve fırsat hesabından çıkarma
- [x] Baseline ve stok parser durumunu ürün detay API/UI'ında gösterme

### Faz 5 — Kargo, Taksit, Landed Cost ✅
- [x] Güncel mevzuat Ticaret Bakanlığı birincil açıklamalarından doğrulandı; planın genel ürüne %30/%60 varsayımı düzeltildi
- [x] `shipping_quotes`, `installment_options`, `tax_rules`, `landed_cost_quotes` çift DB şeması
- [x] JSON-LD/metinden kargo ücreti ve açık taksit sayısı çıkarımı; offer snapshot dual-write
- [x] Yurtiçi, posta ve 430 Avro yolcu senaryolu maliyet motoru; kur ve kullanılan kural görünür
- [x] Genel posta ürününde GTİP yoksa rakam uydurmak yerine detaylı beyan/belirsiz toplam
- [x] Ürün detayında mevcut tasarım diliyle maliyet hesaplayıcı, kargo ve taksit görünümü
- [x] Yönetici lojistik girişi ve mevzuat-kodlu maliyet snapshot API'ı

### Faz 6 — Public SSR + SEO ✅
- [x] `/` ziyaretçi vitrini ile `/yonetim` operasyon panelini ayırma; ürün ekleme/ayarlar/toplu kontrol yalnız yönetimde
- [x] Public ürün kartlarını kanonik SSR ürün sayfalarına, kategori bağlantılarını SSR kategori sayfalarına bağlama
- [x] `/urun/{id}-{slug}` ve `/kategori/{id}-{slug}` sayfalarını mevcut tasarım diliyle sunucudan tam HTML üretme
- [x] Product + AggregateOffer + BreadcrumbList; kategoride ItemList; uydurma Review/Rating ve Merchant listing yok
- [x] Görünür SVG fiyat grafiği + günlük HTML tablo + min/max/ortalama/medyan düz metinleri
- [x] En az 2 teklif veya 30 gün geçmiş indeks eşiği; sorgulu/yetersiz sayfalarda `noindex, follow`
- [x] Canonical 301, tarihli hüküm, görünür `dateModified`, pasif ürün için son fiyatlı arşiv sayfası
- [x] Aktif/arşiv/kategori sitemapleri, AI bot kuralları, `llms.txt`, `/urun/{slug}.json`
- [x] `brand`, `gtin`, `mpn`, `sku` çift DB migration ve kontrollü PATCH desteği

### Faz 7 — Bildirim ve Fırsat Katmanı ✅
- [x] Kullanıcı bazlı, varsayılan kapalı e-posta ve standart Web Push/VAPID kanal modeli
- [x] E-posta doğrulama, tarayıcı aboneliği ve tek tık tüm dış kanallardan çıkma
- [x] Anlık / İstanbul 09.00 günlük özet tercihi; kalıcı teslimat kuyruğu, retry ve mevcut cooldown
- [x] 30 günlük medyan/all-time low kullanan, stok dışını almayan günlük fırsat snapshot'ı
- [x] 10 günlük fiyat kuralı için yalnız yönetimde tutarlı/şüpheli/yetersiz sınıflaması ve kanıt CSV
- [x] 1 Ağustos 2026 yürürlük ve 10 gün kuralı Ticaret Bakanlığı birincil kaynaklarından doğrulandı

Harici kanal operasyon notu: kod ve kuyruk tamamdır; gerçek e-posta/Web Push teslimatı için
Coolify'da `RESEND_API_KEY`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` ve
`VAPID_SUBJECT` tanımlanmalıdır. Anahtar yokken sistem teslimatı “gönderildi” saymaz.

### Faz 8 — Katalog + Ürün Eşleştirme ✅
- [x] GTIN/EAN kontrol basamağı ve MPN marka/biçim güvenilirlik kapısı
- [x] Türkçe başlık normalizasyonu: marka, model, kapasite ve renk varyant eksenleri
- [x] Başlık/model + fiyat aralığı güven skoru; bütün adaylar için insan onay kuyruğu
- [x] İnsan onayıyla kanonik katalog grubu; onaydan önce hiçbir otomatik birleşme yok
- [x] Match rate ve gözden geçirilmiş precision ölçümü; ≥ %98 hedefi için en az 30 karar kapısı
- [x] Scrapy/Python servis sınırı ADR'si ve çalıştırılabilir, fail-closed JSONL sözleşme spike'ı

Faz 8 tablo seti: `product_identities`, `product_match_candidates`, `catalog_products`,
`catalog_memberships`. SQLite migration `0015_phase8_catalog.sql`, Postgres migration
`0012_phase8_catalog.pg.sql`. Günlük cron adayları yeniler; onaylanan/reddedilen kararlar korunur.
Yönetim arayüzünde **Katalog** sekmesi kimlik ayrıntılarını, skor parçalarını, kuyruğu ve ölçümleri
gösterir. Deterministik model/başlık benzerliği ilk yüksek-precision sürümüdür; harici embedding
servisi etiketli veri ve ölçülmüş bir kazanım olmadan üretime eklenmedi.

### Faz 9 — Google Trends Türkiye Teknoloji Talep Kataloğu ✅
- [x] Türkiye / son 12 ay / Bilgisayarlar ve Elektronik Ürünler kapsamı Google Trends'te doğrulandı
- [x] Ürün olmayan mağaza, vergi, video ve uygulama sorguları elendi; 50 ürün/kategori/marka/aksesuar sinyali kaynaklandı
- [x] Her kayıtta kaynak terimi, kaynak içi sıra, göreli 0–100 değer veya yükseliş etiketi ve doğrulama URL'si tutuldu
- [x] SQLite `0016_phase9_trend_catalog.sql` ve Postgres `0013_phase9_trend_catalog.pg.sql`
- [x] Public talep kataloğu; 12 kayıtlık dengeli özet + 50 kaydın tamamını açma
- [x] Yönetimde yayın/gizleme ve yalnız mevcut gerçek takip ürünüyle ilişkilendirme
- [x] Mutlak arama hacmi veya Türkiye geneli 1–50 iddiası yok; metodoloji ve sınır arayüzde görünür

Ayrıntılı kaynak ve 50 kayıt tablosu `docs/phase9-google-trends-methodology.md` içindedir. Google
Trends API alpha genel erişimde olmadığı için çalışma zamanında Google taraması yoktur; 6 Ağustos
2026 snapshot'ı deterministik ve idempotent seed olarak açılışta yüklenir.

### Faz 7-9 Özet
- **Faz 7:** Bildirim kanalları (e-posta, web push), fırsat akışı, uyum iç aracı
- **Faz 8:** İnsan onaylı katalog + ürün eşleştirme; Scrapy/Python için izole sözleşme spike'ı
- **Faz 9:** Google Trends kaynaklı 50 teknoloji talep sinyali; public katalog ve yönetim eşleştirmesi

## Kritik Kararlar (değiştirilmemeli)

| # | Karar |
|---|-------|
| K1 | Halka açık ürün, Postgres + SSR + çok kullanıcılı baştan |
| K3 | Crawlee + Scrapy; Firecrawl söküldü |
| K4 | Erişilebilen sitelerle başla (Vatan, İncehesap, HB) |
| K5 | "Tüm satıcılar" iddiası kullanılmayacak, kapsam açıkça gösterilecek |
| K6 | Uyum rozeti iç araç, public'te sadece veri gösterilir |
| K7 | Workers hattı kapatıldı ✅ |
| K8 | Google Trends değerleri yalnız kaynak içi göreli sinyaldir; mutlak hacim veya global 1–50 iddiası kurulmaz |

## Komutlar

```bash
npm run dev        # Vite dev server (API proxy 8787'ye)
npm start          # build + start:node (tam uygulama)
npm run check      # typecheck
npm test           # vitest (106 test)
npx tsx scripts/probe.ts <url>         # tek URL test
npx tsx scripts/backfill-offers.ts     # mevcut veri → offers tablosu
```

## Bilinen Sorunlar / Dikkat

- **Trendyol directFetch ile erişilemez:** bot koruması 403 veriyor; Crawlee CheerioCrawler canlı spike'ta 200 aldı
- **Genel yurtdışı ürünün vergisi GTİP olmadan hesaplanamaz:** UI bilinmeyen vergi/masrafı kesin toplam gibi göstermez
- **Canonical origin:** Prod'da `PUBLIC_BASE_URL=https://gaffur.net` verilmelidir; verilmezse güvenli varsayılan zaten `https://gaffur.net` olur
- **Faz 7 dış kanal secret'ları opsiyonel ama gerçek teslimat için gerekli:** yoksa uygulama içi bildirim çalışır, e-posta/Web Push kapalı görünür
- **Faz 8 precision henüz canlıda kanıtlanmış değildir:** hedef ≥ %98 ancak en az 30 yönetici kararı sonrasında değerlendirilir; örneklem dolmadan arayüz başarı iddiası göstermez
- **Feed araştırması yapılmadı** (Trendyol/HB gelir ortaklığı programları)
- Mevcut canlı veri: 4 ürün, max 8 fiyat noktası — göç riski neredeyse sıfır

## Detaylı Plan

~800 satırlık tam plan `gaffur-plan-prompt.md` dosyasında. ADR'ler, risk tablosu, doğrulama kriterleri, mevzuat analizi (indirimli satış yönetmeliği, gümrük kararı) dahil.

CLAUDE.md'de güncel mimari bilgiler var — her zaman oraya bak.
