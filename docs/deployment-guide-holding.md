# Deployment Guide — gaffur.net

Bu dokuman yapılacak **manuel adımları** sıralı bir checklist olarak sunar.

> Her adımın yanında *(otomatik)* etiketi yoksa **kullanıcı manuel yapacak**.

---

## 1. Cloudflare Pages — Hosting (~10 dk)

Cloudflare DNS zaten aktif olduğu için en hızlı seçenek.

1. https://dash.cloudflare.com → **Workers & Pages** → **Create application** → **Pages** → **Upload assets**
2. Project name: `gaffur`
3. **Production branch:** `main` (Git ile bağlarsan) veya direkt yükleme
4. `public/` klasörünü drag-drop et VEYA Git repo bağla:
   - GitHub'a push et (aşağıdaki adımdan sonra)
   - Cloudflare → Connect Git → repo seç
   - Build command: (boş bırak)
   - Build output directory: `public`
5. Deploy → `gaffur.pages.dev` URL'sini al
6. **Custom domain ekle:** Pages project → Custom domains → Add → `gaffur.net`
   - Cloudflare otomatik CNAME ekleyecek
7. **www subdomain için** Custom domain → Add → `www.gaffur.net`

→ DNS propagasyon birkaç dakika alır. `https://gaffur.net` 200 OK döner.

---

## 2. Cloudflare DNS Ek Ayarlar (~10 dk)

Dash → gaffur.net → **DNS** sekmesi:

### CAA records (SSL CA tanımı — security best practice)

| Type | Name | Value |
|------|------|-------|
| CAA | gaffur.net | `0 issue "letsencrypt.org"` |
| CAA | gaffur.net | `0 issue "pki.goog"` |
| CAA | gaffur.net | `0 issuewild ";"` |
| CAA | gaffur.net | `0 iodef "mailto:emociksin@gmail.com"` |

### DNSSEC enable

1. Dash → gaffur.net → **DNS** → **DNSSEC** → **Enable DNSSEC**
2. Cloudflare DS record bilgisini gösterir
3. Porkbun → Domains → gaffur.net → **Manage** → **DNSSEC** → DS record'u gir
4. Doğrulama 24 saate kadar sürebilir

### Email DNS (eğer email atılacaksa)

**Cloudflare Email Routing** kullan (free, 5 dk):

1. Dash → gaffur.net → **Email** → **Email Routing** → Enable
2. Cloudflare otomatik MX + SPF + DKIM + DMARC kayıtlarını ekler
3. Custom address: `iletisim@gaffur.net` → forward to → `emociksin@gmail.com`

### Cloudflare SSL/TLS Ayarları

Dash → gaffur.net → **SSL/TLS**:

- **SSL/TLS encryption mode:** Full (Strict) — Pages kullandığından otomatik
- **Edge Certificates** → Always Use HTTPS: **ON**
- **Edge Certificates** → Min TLS Version: **TLS 1.2**
- **Edge Certificates** → Opportunistic Encryption: **ON**
- **Edge Certificates** → TLS 1.3: **ON**
- **Edge Certificates** → Automatic HTTPS Rewrites: **ON**

### Speed Optimizations

Dash → gaffur.net → **Speed** → **Optimization**:

- **Auto Minify** (HTML/CSS/JS): **ON** (üçü de)
- **Brotli:** **ON**
- **Early Hints:** **ON**

Dash → gaffur.net → **Network**:

- **HTTP/3 (QUIC):** **ON**
- **0-RTT Connection Resumption:** **ON**

---

## 3. Google Search Console (~5 dk)

TXT verify zaten yapılmış görünüyor. Doğrulamayı tamamla:

1. https://search.google.com/search-console
2. Property: gaffur.net (zaten eklendi gibi — TXT kaydı var)
3. **Verify** butonuna bas → "Ownership verified" mesajını al
4. **Sitemaps** → Add sitemap → `sitemap.xml` → Submit
5. **URL Inspection** → `https://gaffur.net/` → **Request indexing**
6. **Settings** → **Crawl rate** kontrol
7. **Settings** → **Users and permissions** → kendine "Owner" rolü onayla

---

## 4. Bing Webmaster Tools (~5 dk)

1. https://www.bing.com/webmasters
2. **Add a site** → URL: `https://gaffur.net`
3. **Import from Google Search Console** seçeneği var → Hızlı kurulum
4. Sitemap submit → `https://gaffur.net/sitemap.xml`
5. **URL Submission** → anasayfa URL'sini gönder
6. **IndexNow API key** al → Settings → API access

### IndexNow Setup

1. Bing Webmaster → Settings → IndexNow → API key generate
2. Key dosyası indir (örn: `abc123.txt`)
3. **Bu dosyayı `public/` klasörüne koy** (deploy edildiğinde root'a düşer)
4. İleride yeni içerik ekledikçe `https://api.indexnow.org/indexnow?url=...&key=...` ile ping at

---

## 5. Yandex Webmaster (opsiyonel, ~5 dk)

TR trafiğine az etki ama free.

1. https://webmaster.yandex.com
2. Site ekle → meta tag verify → `index.html` head'ine yapıştır → re-deploy
3. Sitemap submit

---

## 6. Cloudflare Web Analytics (~3 dk)

1. Dash → **Analytics & Logs** → **Web Analytics** → Add a site
2. Hostname: `gaffur.net`
3. Cloudflare snippet kopyala (`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "..."}'></script>`)
4. `public/index.html` body kapanmadan önce yapıştır
5. Re-deploy

→ Privacy-first, cookie'siz, ücretsiz analytics aktif.

---

## 7. cblplus Delist (opsiyonel, email gönderim öncesi)

1. https://cblplus.anti-spam.org.cn → **Delisting** form
2. Domain: gaffur.net
3. Reason: "Domain newly registered, no spam history"
4. Submit → 1-7 gün içinde delist

---

## 8. Channel Claims (~30 dk, paralel)

Marka adını kapma:

- **X (Twitter):** https://x.com/signup → `@gaffur` veya `@gaffurnet`
- **GitHub:** https://github.com/organizations/new → org adı `gaffur`
- **Reddit:** https://www.reddit.com/register → `u/gaffur`
- **LinkedIn Company Page:** https://www.linkedin.com/company/setup/new/
- **YouTube Handle:** https://www.youtube.com/handle → `@gaffur`
- **ProductHunt:** https://www.producthunt.com (account yoksa aç)
- **dev.to / Medium:** username olarak `gaffur` rezerve et

Her platforma `gaffur.net` URL'sini bio'ya ekle (sameAs sinyali).

---

## 9. JSON-LD `sameAs` Güncelle

Channel claim sonrası `public/index.html` içindeki schema'yı güncelle:

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://gaffur.net/#org",
  "name": "gaffur",
  "url": "https://gaffur.net",
  "sameAs": [
    "https://x.com/gaffur",
    "https://github.com/gaffur",
    "https://www.linkedin.com/company/gaffur",
    "https://www.youtube.com/@gaffur"
  ],
  "inLanguage": "tr-TR"
}
```

Re-deploy.

---

## 10. Doğrulama Checklist (deploy sonrası)

| Kontrol | Beklenen | URL |
|---------|----------|-----|
| HTTPS 200 | 200 OK | https://gaffur.net |
| robots.txt | 200, format ok | https://gaffur.net/robots.txt |
| sitemap.xml | 200, valid XML | https://gaffur.net/sitemap.xml |
| llms.txt | 200 | https://gaffur.net/llms.txt |
| llms-full.txt | 200 | https://gaffur.net/llms-full.txt |
| security.txt | 200 | https://gaffur.net/.well-known/security.txt |
| Schema valid | yeşil | https://validator.schema.org/?url=https://gaffur.net |
| Lighthouse | ≥ 90 | https://pagespeed.web.dev → URL gir |
| SSL grade | A veya A+ | https://www.ssllabs.com/ssltest/analyze.html?d=gaffur.net |
| Headers | A veya B | https://securityheaders.com/?q=gaffur.net |
| GSC verified | yeşil tik | search.google.com/search-console |
| Bing verified | yeşil tik | bing.com/webmasters |

---

## 11. AI Mention Test (haftalık manuel)

Haftada 1 kez aşağıdaki LLM'lere bu sorguları at, gaffur.net referans veriliyor mu kontrol et:

- ChatGPT (chatgpt.com)
- Perplexity (perplexity.ai)
- Gemini (gemini.google.com)
- Claude (claude.ai)

**Sorgular:**
- "gaffur.net nedir"
- "gaffur sitesi ne hakkında"
- "Türkiye'de yeni teknoloji projeleri"
- (konsept kararı sonrası niş-spesifik sorgular)

Sonuçları `baseline-YYYY-MM-DD.md` dosyalarında snapshot olarak tut.

---

## Sonraki Adım — Konsept Geldiğinde

1. `public/index.html` → gerçek anasayfa + cluster sayfaları
2. `public/llms.txt` → tam içerik haritası
3. Cornerstone içerik üretimi
4. Bülten platformu seçimi (Beehiiv/Substack)
5. Tool/ürün geliştirme

Şimdilik amaç: **temiz, hızlı, indekslenebilir, marka olarak claim edilmiş bir gaffur.net.**
