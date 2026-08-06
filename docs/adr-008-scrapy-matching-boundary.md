# ADR-008 — Scrapy/Python yalnız arama keşfi sınırında

- Durum: Kabul edildi (Faz 8 sözleşme spike'ı; üretim servisi henüz açılmadı)
- Tarih: 2026-08-06

## Bağlam

Gaffur'un rutin fiyat/stok yenilemesi bugün Node, kalıcı `crawl_jobs` kuyruğu ve Crawlee ile
çalışıyor. Bu yolun ikinci bir scheduler'a taşınması retry, domain limiti, stale-lock kurtarma,
parser sağlığı ve deploy operasyonunu iki ayrı çalışma zamanına böler.

Ürün adıyla çok sayfalı arama keşfi ise farklıdır: arama sonucu → sayfalama → ürün detayı
takibi gerçek bir crawl'dır. Scrapy'nin resmi mimarisinde Scheduler istekleri saklayıp Engine'e
verir; Spider yeni istek ve item üretir; Item Pipeline temizleme, doğrulama ve tekrar kontrolü
için kullanılır. AutoThrottle da indirme yuvası gecikmesini ölçülen yanıta göre ayarlarken
`DOWNLOAD_DELAY` ve `CONCURRENT_REQUESTS_PER_DOMAIN` sınırlarını korur.

Resmi kaynaklar:

- https://docs.scrapy.org/en/latest/topics/scheduler.html
- https://docs.scrapy.org/en/latest/topics/item-pipeline.html
- https://docs.scrapy.org/en/master/topics/autothrottle.html

## Karar

Scrapy, ancak ürün adıyla arama keşfi kanıtlandığında **ayrı ve durumsuz bir Python servisi**
olarak kullanılacak. Gaffur'un Node uygulaması neyin ne zaman aranacağının, kalıcı iş durumunun,
kanonik katalog kararının ve insan onayının sahibi kalacak.

```text
Node crawl_jobs / scheduler
        │  versioned JSON request
        ▼
Python arama servisi (Scrapy spider + pipeline)
        │  normalize edilmiş adaylar; DB yazmaz
        ▼
Node eşleştirme motoru → insan onay kuyruğu → katalog grubu
```

Sınır kuralları:

1. Python servisi Gaffur veritabanına bağlanmaz ve bildirim göndermez.
2. İstek `contract_version`, sorgu, izinli domain ve üst sonuç sınırı taşır.
3. Yanıt yalnız URL, başlık, görülen fiyat, para birimi, site ve varsa açık kimlik kodlarını taşır.
4. SSRF/domain allowlist, timeout, toplam sayfa ve gövde boyutu Node işi tarafından sınırlandırılır.
5. Rutin tekil URL yenilemesi Crawlee/direct hattında kalır.
6. Python servisi ulaşılamazsa mevcut tarama ve bildirim hattı etkilenmez.

## Spike sonucu

`scripts/catalog-match-service-spike.py`, harici paket kullanmadan JSONL sözleşmesini çalıştırır.
Bu script crawler değildir; servis sınırını, Türkçe metin/kimlik aktarımını ve hatalı girdinin
fail-closed davranışını doğrulayan dar bir prototiptir. Örnek:

```powershell
'{"contract_version":"phase8-spike-v1","query":"iphone 15","items":[{"url":"https://shop.example/p","title":"Apple iPhone 15 128 GB Siyah","price":40000,"currency":"TRY","site":"example"}]}' |
  python scripts/catalog-match-service-spike.py
```

Üretim Scrapy servisine geçiş kapısı: en az iki yeni domain için sayfalama ihtiyacı, mevcut
Crawlee keşfine göre ölçülmüş anlamlı kapsam artışı ve ayrı servis operasyon maliyetinin kabulü.

## Sonuçlar ve geri dönüş

- Bugün yeni Python runtime veya üretim servisi eklenmedi.
- Eşleştirme algoritması TypeScript'te tek kaynak olarak kalır.
- İleride Scrapy yalnız aday keşfeder; nihai puanlama ve onay yine Node'dadır.
- Spike başarısız olursa dosya/sözleşme kaldırılabilir; mevcut veri modeli ve crawl hattı değişmez.
