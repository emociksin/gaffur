# Gaffur — gaffur.net

Fiyatları senin yerine kollar. Trendyol, Hepsiburada, Amazon, N11 ve diğer sitelerdeki
ürünleri takibe alırsın; Gaffur fiyatları düzenli kontrol eder, düşünce Telegram'dan
haber verir, geçmişi grafikle gösterir.

**Altyapı:** Cloudflare Workers + D1 + Cron Trigger — sunucu yok, ücretsiz katman yeterli.

## Özellikler

- **Ürün takibi:** Bağlantı yapıştır → önizleme → takibe al. Site adaptörleri
  (Trendyol/Hepsiburada/Amazon/N11) + genel parser (JSON-LD/meta — çoğu e-ticaret
  sitesi bu sayede desteklenir).
- **Kategori takibi:** Trendyol kategori/arama bağlantısı yapıştır → listedeki ürünler
  toplu takibe girer, listeye eklenen yeni ürünler otomatik keşfedilir (6 saatte bir).
- **Bildirimler:** Fiyat düşüşü, hedef fiyata iniş, stok değişimi, yeni ürün — uygulama
  içi + Telegram. Ürün başına mod ve % eşiği seçilebilir.
- **Geçmiş:** Fiyat grafiği (7g/30g/90g/1y), en düşük/en yüksek/ortalama, CSV dışa aktarım.
- **Kontrol sıklığı:** Ürün başına 15 dk – 24 saat; "Şimdi Kontrol Et" ile anlık tarama.
- **Crawlee fallback:** Bot koruması olan sitelerde yerleşik CheerioCrawler transport'u
  eklenir; önce her zaman ücretsiz doğrudan erişim denenir.
- **Güvenlik:** Tek parola (Cloudflare secret), HMAC imzalı oturum çerezi.

## Lokal Çalıştırma

```bash
npm install
npm run db:local     # yerel D1 şemasını kur (ilk sefer)
npm start            # build + wrangler dev → http://localhost:8787
```

Yerelde parola istemez: proje kökündeki `.dev.vars` dosyasında `ALLOW_OPEN=1` yazdığı için
açık modda çalışır. Bu dosya git'e girmez ve **deploy edilmez**.

## gaffur.net'e Deploy

```bash
npx wrangler login
npx wrangler d1 create gaffur-db
```

Çıktıdaki `database_id`'yi `wrangler.jsonc` içine yaz, sonra:

```bash
npm run db:remote
npx wrangler secret put PASSWORD
npm run deploy
```

> **PASSWORD secret'i zorunludur.** Uygulama fail-closed çalışır: secret tanımlı değilse
> tüm API `503` döner ve arayüz "Kurulum tamamlanmadı" ekranını gösterir — yani secret'ı
> unutarak deploy edersen panel herkese açık kalmaz, kilitli kalır. Açık mod yalnızca
> `.dev.vars` içinde `ALLOW_OPEN=1` varken (yani sadece yerelde) mümkündür; bu değişkeni
> canlıya asla koyma.

Deploy sonrası uygulamanın **Ayarlar** sayfasından:

1. **Telegram:** BotFather'dan bot aç → token'ı yapıştır → botuna `/start` yaz →
   "Sohbeti Bul" → "Kaydet ve Test Et".
2. Bot korumalı siteler için yerleşik Crawlee transport'u otomatik kullanılır; harici anahtar gerekmez.

## Nasıl Çalışır

Cron her 15 dakikada tetiklenir; kontrol sırası gelen ürünler (ürün başına ayarlanan
sıklığa göre) kalıcı kuyruğa alınır. Fiyat çekme sırası: **doğrudan erişim** (site adaptörü → JSON-LD →
meta → gömülü JSON) → başarısızsa **Crawlee**. Değişimler `price_history`'ye yazılır,
alarm kurallarına uyanlar bildirim üretir.

Ücretsiz Workers planında çalıştırma başına 50 alt-istek sınırı vardır; bu yüzden
kontroller 10'arlı partiler halinde yapılır (15 dk'lık tur başına ~10 ürün → saatte ~40
kontrol kapasitesi; onlarca ürün için fazlasıyla yeterli).

## Güvenlik

| Önlem | Nerede |
|---|---|
| **Fail-closed kimlik doğrulama** — `PASSWORD` yoksa tüm API 503, giriş de dahil | `worker/api.ts` |
| Giriş hız sınırı — IP başına 10 deneme/15 dk + toplam 60/15 dk, `429` + `Retry-After` | `worker/api.ts` (D1 `login_attempts`) |
| Oturum imzası paroladan bağımsız rastgele anahtarla (çerez artık parola için kırma oracle'ı değil) | `worker/auth.ts` (`session_secret`) |
| Oturum iptali — "Tüm cihazlarda çıkış" imza anahtarını döndürür | Ayarlar → Güvenlik |
| CSRF — `SameSite=Strict` çerez + veri değiştiren isteklerde Origin doğrulaması | `worker/api.ts` |
| Çerez — `HttpOnly`, https'te `Secure` + `__Host-` öneki, 7 gün | `worker/api.ts` |
| Telegram anahtarı istemciye maskeli gider, geri yazılmaz | `worker/api.ts` |
| Güvenlik başlıkları — CSP, `frame-ancestors 'none'`, nosniff, Referrer-Policy, HSTS | `public/_headers` + `worker/index.ts` |
| CSV formül enjeksiyonu koruması (`=`, `+`, `-`, `@` ile başlayan hücreler) | `worker/api.ts` |
| Telegram mesajlarında bağlantı kaçışı (yalnız http/https, öznitelik kaçışlı) | `worker/telegram.ts` |
| SQL — tüm sorgular `.bind()` parametreli; XSS — React kaçışı, `dangerouslySetInnerHTML` yok | genel |

Sabit `PASSWORD`'ü değiştirmek oturumları düşürmez (imza ayrı anahtarla); tüm oturumları
kapatmak için Ayarlar'daki **Tüm cihazlarda çıkış** düğmesini kullan.

## Geliştirme

```bash
npm run check                     # typecheck (worker + web)
npx tsx scripts/test-parse.ts     # fiyat parser birim testleri
npx tsx scripts/probe.ts <url>    # bir URL'yi canlı çözümle
node scripts/probe-workerd.mjs    # wrangler dev açıkken gerçek site testi
```

Mimari ayrıntıları ve saha notları: [CLAUDE.md](CLAUDE.md).

## Lisans

Şahsi proje. © 2026 gaffur.net
