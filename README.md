# Gaffur — gaffur.net

Fiyatları senin yerine kollar. Trendyol, Hepsiburada, Amazon, N11 ve diğer sitelerdeki
ürünleri takibe alırsın; Gaffur fiyatları düzenli kontrol eder, düşünce Telegram'dan
haber verir, geçmişi grafikle gösterir.

**Altyapı:** Node.js 24 + Hono + React/Vite; SQLite veya `DATABASE_URL` ile Postgres.
Docker/Coolify üzerinde çalışır.

## Özellikler

- **Ürün takibi:** Bağlantı yapıştır → önizleme → takibe al. Site adaptörleri
  (Trendyol/Hepsiburada/Amazon/N11) + genel parser (JSON-LD/meta — çoğu e-ticaret
  sitesi bu sayede desteklenir).
- **Kategori takibi:** Trendyol kategori/arama bağlantısı yapıştır → listedeki ürünler
  toplu takibe girer, listeye eklenen yeni ürünler otomatik keşfedilir (6 saatte bir).
- **Bildirimler:** Fiyat düşüşü, hedef fiyata iniş, stok değişimi, yeni ürün — uygulama
  içi + Telegram. Ürün başına mod ve % eşiği seçilebilir.
- **Geçmiş:** Fiyat grafiği (7g/30g/90g/1y), en düşük/en yüksek/ortalama, CSV dışa aktarım.
- **Fiyat/stok zekâsı:** 30/90 günlük medyan, 10 günlük en düşük, %2 gürültü filtresi;
  stok değişiminde iki ardışık doğrulama ve `unknown` güvenliği.
- **Kapıdaki maliyet:** Kargo/taksit verisi; yurtiçi, posta ve yolcu beraberinde maliyet
  senaryoları. Mevzuat kaynağı ve kullanılan kur görünür, GTİP bilinmiyorsa kesin vergi uydurulmaz.
- **Kontrol sıklığı:** Ürün başına 15 dk – 24 saat; "Şimdi Kontrol Et" ile anlık tarama.
- **Crawlee fallback:** Bot koruması olan sitelerde yerleşik CheerioCrawler transport'u
  eklenir; önce her zaman ücretsiz doğrudan erişim denenir.
- **Güvenlik:** Yönetici parolası, ayrı imza anahtarlı oturum çerezi ve kullanıcı hesapları.

## Lokal Çalıştırma

```bash
npm install
npm start            # migration + build + Node sunucu → http://localhost:8787
```

Yerelde açık yönetim gerekiyorsa ortamda `ALLOW_OPEN=1` kullan. Bu değişkeni canlıya
koyma; canlıda `PASSWORD` zorunludur.

## gaffur.net'e Deploy

Docker image'i Coolify ile çalıştır. En az `PASSWORD`, Postgres kullanılacaksa ayrıca
`DATABASE_URL=postgres://...` tanımla. Değişiklikler `main` dalına push edilince VPS
otomatik deploy hattı tetiklenir.

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

Node zamanlayıcısı kontrol sırası gelen ürünleri kalıcı kuyruğa alır. Fiyat çekme sırası:
**doğrudan erişim** (site adaptörü → JSON-LD →
meta → gömülü JSON) → başarısızsa **Crawlee**. Değişimler `price_history`'ye yazılır,
alarm kurallarına uyanlar bildirim üretir.

Kuyruk atomik claim, tekrar önleme, artan retry gecikmesi ve domain başına adaptif hız
sınırı kullanır.

## Güvenlik

| Önlem | Nerede |
|---|---|
| **Fail-closed yönetim** — `PASSWORD` yoksa yönetim API'ları 503; halka açık vitrin okumaları çalışır | `worker/api.ts` |
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
npm test                          # Vitest regresyon paketi
npx tsx scripts/probe.ts <url>    # bir URL'yi canlı çözümle
```

Mimari ayrıntıları ve saha notları: [CLAUDE.md](CLAUDE.md).

## Lisans

Şahsi proje. © 2026 gaffur.net
