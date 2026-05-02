# gaffur.net

12 yıl sonra geri kazanılmış domain için **hafif başlangıç** projesi (concept-agnostic).

## Amaç

Domain 2026-05-02'de yeniden kayıt edildi. İçerik konsepti henüz netleşmedi. Bu repo:

- Domaini "claim" eder (placeholder holding page)
- Teknik SEO + GEO temelini kurar (robots.txt, sitemap.xml, llms.txt, schema)
- Indekslenme tetikleyicilerini hazırlar
- Konsept geldiğinde hızla genişleyebilecek bir iskelet sağlar

## Yapı

```
gaffur/
├── README.md                    Bu dosya
├── baseline-2026-05-02.md       Discovery findings (DNS, RDAP, metrikler)
├── deployment-guide.md          Manuel kurulum adımları (CF, Search Console, vb.)
├── .gitignore
└── public/                      Deploy edilecek statik dosyalar
    ├── index.html               Holding page (logo + "Yeniden.")
    ├── robots.txt               AI bot'ları dahil tüm crawler'lara açık
    ├── sitemap.xml              Tek URL (anasayfa)
    ├── llms.txt                 LLM crawl rehberi (minimal)
    ├── llms-full.txt            Genişletilmiş LLM içerik
    ├── favicon.svg              SVG favicon (modern browser)
    ├── og.svg                   Open Graph image (1200x630)
    └── .well-known/
        └── security.txt         Güvenlik iletişim bilgisi
```

## Lokal Test

```bash
cd public
python -m http.server 8000
# veya
npx serve public
# tarayıcıda: http://localhost:8000
```

## Deploy

**Önerilen: Cloudflare Pages** (free, hızlı, CF DNS zaten ayarlı).

Detaylı manuel kurulum: bkz. `deployment-guide.md`.

## Sonraki Adım

1. Deploy + DNS A/CNAME bağla → site live
2. Search Console + Bing Webmaster verify + sitemap submit
3. Lighthouse + securityheaders skor doğrulama
4. Konsept kararı → içerik üretimi başlat

## Lisans

Bu repo şahsi proje. İçerik © 2026 gaffur.net.
