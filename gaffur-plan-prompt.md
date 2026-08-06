# Claude Code — Gaffur.net Planlama Promptu

> Bu dosyanın tamamını Claude Code'a yapıştır. İstersen repo köküne `docs/PLAN_PROMPT.md` olarak da kaydedebilirsin.

---

## ROL

Sen kıdemli bir ürün mimarı ve veri mühendisisin. Görevin **kod yazmak değil, uygulanabilir bir teknik plan üretmek.**

## KURALLAR (ihlal etme)

1. **Kod yazma.** Ne uygulama kodu, ne migration dosyası, ne config. Şema tanımlarını sözel/tablo olarak anlat.
2. **Tasarım yapma ve mevcut tasarıma dokunma.** Sitenin görsel tasarımı beğeniliyor ve **korunacak.** UI, renk, layout, tipografi, component önerisi yok; mevcut stil dosyalarını, template'leri veya görsel yapıyı değiştirmeyi önerme. Yeni veri alanları (stok durumu, kargo, taksit, yurtdışı fiyatı) mevcut tasarım diline **eklenecek**, tasarım bunlar için yeniden düzenlenmeyecek. Bir alanın mevcut düzene sığmadığını düşünüyorsan bunu "açık soru" olarak sor, kendiliğinden yeniden tasarlama.
3. **Varsayma, doğrula.** Repoda ne olduğunu görmeden mevcut mimari hakkında hüküm kurma. Bilmediğin bir şeyi "muhtemelen şöyledir" diye yazma; açık soru olarak listele.
4. **Emin olmadığın mevzuat/rakam için "doğrulanmalı" etiketi koy.** Uydurma sayı üretme.
5. Çıktı dili **Türkçe**, teknik terimler İngilizce kalabilir.

## İLK ADIM — mevcut durumu oku

Plan yazmadan önce repoyu incele ve şunları raporla:

- Dil / framework / runtime, SSR var mı yoksa client-side render mı
- Veritabanı ve mevcut şema (özellikle takip edilen ürün ve fiyat kayıtları nasıl tutuluyor)
- Scraping/tarama katmanı nasıl çalışıyor: cron mu, kuyruk mu, hangi sitelere parser var
- Bildirim altyapısı var mı
- Kimlik doğrulama, kullanıcı modeli
- Deploy hedefi (VPS/Docker/Coolify vb.), CI var mı
- Test kapsamı

Bu raporu planın başına koy. Planın geri kalanını **bu gerçek duruma göre** yaz — mevcut kodu yok sayan bir "sıfırdan mimari" yazma.

---

## PROJE BAĞLAMI

**Gaffur.net** — çalışır durumda bir fiyat takip sitesi. Bugünkü hali: kullanıcı bir **ürün linki** ekliyor, sistem o linki takip ediyor. Başka bir şey yapmıyor.

### Hedeflenen ürün

Kullanıcı bir ürün sayfasına girdiğinde şunları görmeli:

1. **Fiyat listesi** — o ürünü satan tüm satıcılar, fiyatlarıyla
2. **Gerçek stok verisi** — stokta var/yok, "kaç gündür yok", "stok geldi" bildirimi
3. **Kargo fiyatı** — listelenen fiyat değil, kapıya gelen toplam
4. **Taksit seçenekleri**
5. **Yurtdışı fiyatı** — satıldığı yerlerle birlikte, **kapıdaki maliyet** olarak
6. **Fiyat geçmişi** ve indirimin gerçek olup olmadığı hükmü

Ayrıca:
- Fiyatı düşen ürünlerin otomatik listelendiği bir fırsat akışı
- Kullanıcının **link yerine ürün adı yazarak** takip başlatabilmesi; sistem ürünün satıldığı tüm pazaryerlerini bulup takibe alsın

### Stratejik konum

Türkiye'de Akakçe/Cimri gibi oyuncular zaten fiyat alarmı ve fiyat geçmişi sunuyor. Rekabet edilecek yer **katalog genişliği değil, veri doğruluğu.** Kullanıcı şikayetlerinin yoğunlaştığı üç nokta:
- Stokta olmayan ürünlerin listelenmeye devam etmesi
- Karşılaştırma sitesindeki fiyatın hedef sitede farklı çıkması
- Taksit/kargo/stok bilgisinin yanıltıcı olması

Ürünün tek savunulabilir varlığı **biriktirilen fiyat/stok zaman serisi.** Plandaki her karar bunu korumalı.

---

## PLANLANACAK ALANLAR

### 1. Veri modeli

Mevcut "1 link = 1 takip" yapısı üçe ayrılmalı:

- **product** — kanonik ürün: marka, MPN, GTIN, kategori, varyant eksenleri
- **offer** — o ürünün belirli bir satıcıdaki listesi: URL, satıcı, site_urun_id, kargo, taksit
- **snapshot** — her tarama sonucu: fiyat, stok_durumu, satıcı, timestamp

`stok_durumu` enum: `in_stock` / `out_of_stock` / `preorder` / `unknown`. `unknown` şart — parser bozulduğunda yanlış bildirim gitmesin.

Kullanıcı takibi `product` seviyesine bağlanmalı.

**Türkiye'ye özgü varyant eksenleri** — bunları ayrı ürün saymak zorunlu, yoksa "en düşük fiyat" hep gri ürün olur:
- Garanti tipi (Türkiye distribütör garantili / ithalatçı / yurtdışı garantili)
- Fatura tipi (bireysel / kurumsal)
- İlgili kategorilerde ÖTV durumu

Planla: mevcut veriden bu modele geçiş yolu (geriye dönük fiyat geçmişini kaybetmeden), aşamalı migration sırası, geri alma stratejisi.

### 2. Stok takibi

- Mevcut durumu değil, **durum geçişini** yakala: `in_stock → out_of_stock` = "tükendi", `out_of_stock → in_stock` = "stok geldi"
- Geçişi bildirmeden önce **2 ardışık taramada doğrula**, ürün başına 6–12 saat cooldown
- `unknown` asla geçiş sayılmasın; üst üste 3 `unknown` → parser'a hata bayrağı
- **Stokta olmayan teklif asla "en düşük fiyat" olarak gösterilmesin**

### 3. Fiyat düşüşü ve indirim doğruluğu

- Referans "bir önceki fiyat" **olmasın** — son 30/90 günün medyanı ve all-time low kullan
- %2 altı hareketler gürültü sayılıp elensin
- Fırsat akışı günlük job + materialized view olarak hesaplansın, her istekte değil

**Mevzuat katmanı (yüksek öncelikli farklılaştırıcı):**
Fiyat Etiketi Yönetmeliği ve 1 Ağustos 2026'da yürürlüğe giren Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği değişikliği uyarınca, indirimli satış reklamlarında "indirimden önceki fiyat" olarak indirim başlangıcından önceki **son 10 gün içindeki en düşük fiyat** esas alınmak zorunda; ispat külfeti satıcıda.

Planla:
- Ürün bazında "10 gün kuralı" uyum rozeti (uyumlu / şüpheli / ihlal)
- Satıcı bazında uyum karnesi
- Kullanıcı için şikâyet dosyası export'u (tarihli fiyat serisi + kanıt)

⚠️ Bu düzenlemenin güncel metnini ve yürürlük tarihini **Resmî Gazete'den birincil kaynak olarak doğrula.** Hesap motoruna gömülecek, ikincil kaynağa güvenme.

### 4. Ürün adıyla takip ve eşleştirme

İki katman:
- **Arama** — kullanıcının yazdığı ada göre ilgili pazaryerlerinin kendi arama sonuçlarından ilk 10–20 sonucu çek
- **Eşleştirme** — farklı sitelerdeki listeleri tek `product`'a bağla

Eşleştirme hattı:
1. GTIN/EAN/MPN kesin eşleşme
2. Başlık normalizasyonu → marka + model + varyant (kapasite, renk) çıkarımı
3. Embedding benzerliği + fiyat aralığı tutarlılık kontrolü
4. Güven skoru eşiği (~%85–95) altındakiler **insan onayı kuyruğuna** düşsün

Not: Türk pazaryerlerinde barkod alanı çoğu zaman boş veya satıcının uydurduğu bir değer. Tek başına kod eşleşmesine güvenilemez; marka + model kodu çıkarımı zorunlu ikinci katman.

Kalite metriği **iki sayı birlikte**: match rate ve match precision. Precision hedefi ≥ %98. İlk sürümde eşleşme kullanıcı onayıyla, veri biriktikçe otomatikleştirilecek.

### 5. Katalog stratejisi (hangi ürünler listelenecek)

Özellik seti kataloğu belirliyor: taksit yüksek biletli üründe, kargo orta bantta, stok gerçekten tükenen üründe, yurtdışı karşılaştırması ise **sadece GTIN/MPN'i olan global kimlikli üründe** anlamlı. Kesişim: **markalı, barkodlu, orta-yüksek biletli dayanıklı tüketim ürünleri.**

**Sert kapılar** (biri yoksa kataloğa alma):
- GTIN/MPN mevcut veya çıkarılabilir
- En az 2 farklı satıcı
- Varyant ekseni ≤ 2

**Puanlama (0–100):** arama hacmi, fiyat oynaklığı (son 90 gün std sapma / ortalama — en önemli metrik), tükenme sıklığı, bilet büyüklüğü, yurtdışı karşılığının bulunabilirliği, satıcı sayısı. Eşiği geçmeyen "aday havuzu"nda beklesin.

**Kapsam dışı:** giyim/moda (barkod yok, varyant patlaması), market/gıda, private label, ucuz aksesuar.

**Faz sırası:** (1) telefon/tablet/akıllı saat → (2) PC bileşen + laptop → (3) küçük ev aleti + beyaz eşya → (4) oyun/konsol, ses, foto.

Çekirdek hedefi: 1.500–3.000 SKU. Milyon ürünle başlanmayacak.

Planla: katalog doldurma kaynakları, puanlama job'ının çalışma sıklığı, aday havuzundan terfi mekanizması.

### 6. Yurtdışı fiyat = kapıdaki maliyet

Ham yurtdışı fiyatını göstermek yanıltıcıdır. 7 Ocak 2026 tarihli karar sonrası 30 Euro'luk gümrük muafiyeti kaldırıldı; posta/hızlı kargo ile gelen ürünlerde vergi oranı AB'den doğrudan gelirse %30, diğer ülkelerden %60, ÖTV listesindeki eşyada ilave %20. Basitleştirilmiş beyan uygulaması da değişti.

⚠️ **Yürürlük tarihi ve prosedür detayında kaynaklar çelişiyor — Resmî Gazete metninden doğrula.**

Planla:
- Landed cost motoru: ürün fiyatı + kargo + gümrük vergisi + KDV (+ÖTV) + kur. Kullanılan kur ve oran kullanıcıya görünsün.
- Konumlandırma: "yurtdışından ucuza al" değil, **"Türkiye fiyatı adil mi?"** kıyas ölçütü
- Ayrı segment: yolcu beraberinde 430 Euro muafiyeti hâlâ geçerli → "yurt dışına gidiyorum, orada alsam mantıklı mı?" senaryosu
- Vergi oranlarının versiyonlanmış tablo olarak tutulması (mevzuat değişince geçmiş hesaplar bozulmasın)

### 7. Toplama altyapısı

- Kuyruk tabanlı worker; tek monolitik cron değil
- Domain başına rate limit + proxy rotasyonu, siteye özel eş zamanlılık limiti
- Adaptif frekans: hedef fiyata yakın / stokta olmayan ürünler 15–30 dk, pasifler günde 1–2
- Versiyonlu parser registry; başarısızlık oranı %20'yi geçerse otomatik alarm
- Headless browser (Playwright) sadece zorunlu sitelerde
- Mümkün olan yerde **affiliate XML/JSON feed** tercih edilsin (yasal, yapısal, stok bilgisi genelde dahil, aynı zamanda gelir modeli). Hangi pazaryerinin feed verdiğini araştır ve raporla.

#### Değerlendirilecek: Scrapy (github.com/scrapy/scrapy)

Bunu bir **karar maddesi (ADR)** olarak ele al ve mevcut stack'i gördükten sonra gerekçeli olarak öner veya reddet. Kararı benim yerime verme, ama net bir tavsiye ile bitir.

Aday konumlandırma — Scrapy **fetch + parse katmanı** olsun, **durum ve zamanlama sahibi olmasın**:

```
Kuyruk / scheduler   →  ne, ne zaman taranacak (bizim kodumuz)
        ↓
Scrapy (spider + middleware)  →  indir, ayrıştır
        ↓
Item pipeline        →  normalize et, snapshot olarak DB'ye yaz
        ↓
Uygulama             →  stok geçişi tespiti, bildirim, eşleştirme
```

Lehine olan noktalar (plandaki gereksinimlerle birebir örtüşüyor):
- Domain başına eş zamanlılık ve gecikme: `CONCURRENT_REQUESTS_PER_DOMAIN`, `DOWNLOAD_DELAY`, AutoThrottle
- Proxy rotasyonu / retry / UA yönetimi: downloader middleware katmanı
- Domain başına spider = versiyonlu parser registry'nin doğal karşılığı
- Spidermon ile parser başarısızlık oranı izleme ve alarm
- `scrapy-playwright` ile headless'ı yalnızca gereken sitelerde açma
- Faz 3'teki **ürün adıyla arama** katmanı gerçek bir crawl (arama sonucu → sayfalama → ürün sayfası takibi); Scrapy'nin en güçlü olduğu senaryo bu

Aleyhine olan noktalar:
- Rutin fiyat/stok yenilemesi bir crawl değil, zamanlanmış tekil fetch. Scrapy iş zamanlayıcı değil; adaptif frekans ve öncelik kuyruğu yine bizim tarafta yazılacak (scrapyd / scrapy-redis / kendi scheduler)
- Link takibi, derinlik, dupefilter gibi ağırlığın büyük kısmı bu yükte kullanılmıyor
- Proje Python değilse ikinci runtime ve servis sınırı maliyeti doğuyor. **Node ise Crawlee'yi alternatif olarak karşılaştır.**
- Twisted tabanlı async model; mevcut asyncio/Node dünyasına gömmek yerine ayrı servis olarak izole edilmeli

ADR'de şunları netleştir: mevcut stack ile uyum maliyeti, ayrı servis mi kütüphane mi, mevcut parser'ların migrasyon yolu, geri dönüş maliyeti, ve "sadece Faz 3 arama katmanında kullan, rutin yenilemede kullanma" hibrit seçeneğinin değerlendirmesi.

### 8. Bildirim

Kanallar: e-posta, Telegram bot, web push. Kural tipleri: hedef fiyat altı, %X üzeri indirim, stok geldi, tarihi en düşük. Dedup + cooldown zorunlu. "Anlık" ve "günlük özet" seçenekleri.

### 9. SEO / GEO

- **SSR/SSG zorunlu** — structured data sunucudan dönen HTML'de olmalı, JS ile üretilemez
- Şema: `Product` + **`AggregateOffer`** (lowPrice, highPrice, offerCount, availability). **Merchant listing markup'ı kullanılmayacak** — ürün doğrudan satılmıyor, bu Product snippet senaryosu. Uydurma `Review`/`AggregateRating` yok.
- `Product.category`, `gtin`/`mpn`/`sku` alanları doldurulsun; liste sayfalarında `ItemList`, her yerde `BreadcrumbList`
- **Kademeli indexleme:** ürün sayfası ancak ≥2 teklif veya ≥30 günlük geçmiş varsa index'e girsin. Kullanıcı takip listeleri `noindex` + auth. Filtre/sıralama URL'leri `noindex,follow`.
- Fiyat geçmişi **hem grafik hem HTML tablo** olarak; min/max/ortalama düz metin de yazılsın (canvas'ı crawler ve LLM okuyamaz)
- Sayfa başında tek cümlelik tarihli hüküm: "şu an almak için iyi zaman değil / en düşük seviyede" formatında
- `dateModified` + görünür son güncelleme zamanı
- `robots.txt`'te AI crawler'lara (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended) izin; kök dizinde `llms.txt`; ürün başına `/urun/{slug}.json`
- Sitemap segmentasyonu (aktif / arşiv / kategori), dürüst `lastmod`
- Satıştan kalkan ürün silinmesin: "artık satılmıyor, son fiyatı X'ti" olarak kalsın

### 10. Hukuki ve operasyonel

Pazaryeri ToS'ları scraping'i kısıtlıyor, IP bloklama agresif. Affiliate feed'i olan yerde feed, olmayanda düşük hızlı tarama. KVKK aydınlatma metni ve tek tık bildirim iptali gerekli. Fiyat geçmişini HTML olarak açmak rakip kazımasına da açar — detay seviyesi (günlük mü haftalık mı) buna göre seçilmeli, bunu bir karar maddesi olarak ele al.

---

## ÇIKTI FORMATI

Aşağıdaki sırayla, tek bir markdown planı üret:

1. **Mevcut durum raporu** — repodan çıkardıkların
2. **Hedef mimari** — bileşen bileşen, mevcut yapıdan farkı belirtilerek
3. **Veri modeli** — tablo/alan seviyesinde, sözel olarak; migration sırası ve geri alma
4. **Fazlandırılmış yol haritası** — her faz için: kapsam, ön koşul, tahmini efor (S/M/L), "bitti" tanımı, ölçülecek metrik
5. **Karar kayıtları (ADR)** — kritik teknik seçimler, her biri için: seçenekler, seçilen, gerekçe, geri dönüş maliyeti
6. **Risk listesi** — olasılık × etki, azaltma yöntemiyle
7. **Doğrulanması gereken varsayımlar** — özellikle mevzuat, affiliate feed erişimi, pazaryeri arama sayfası yapısı
8. **Bana sorman gereken açık sorular** — cevaplanmadan ilerlenemeyecek olanlar

Fazlandırma ilkesi: **mevcut altyapının üstüne oturan ve tek başına değer üreten işler önce.** Veri modeli ayrıştırması ve stok geçiş takibi ilk fazda; ürün adıyla çoklu pazaryeri eşleştirmesi asıl mühendislik maliyeti, sonraya.

SSR'a geçiş gerekiyorsa bunu **görsel tasarımı değiştirmeden** nasıl yapacağını anlat (aynı markup, farklı render stratejisi) — mevcut tasarımı bozacak bir yaklaşım önerirsen bunu açıkça uyarı olarak belirt ve alternatifini sun.

Planı bitirdiğinde **hiçbir kod yazma, uygulamaya başlama.** Onay bekle.
