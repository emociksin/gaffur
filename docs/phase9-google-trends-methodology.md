# Faz 9 — Google Trends Türkiye Teknoloji Talep Kataloğu

## Sonuç ve sınır

Snapshot 6 Ağustos 2026'da Google Trends arayüzünden şu sabit kapsamla alındı:

- Coğrafya: Türkiye (`geo=TR`)
- Dönem: son 12 ay (`date=today 12-m`)
- Kategori: Bilgisayarlar ve Elektronik Ürünler (`cat=5`)
- Arama türü: Web Araması

Bu veri “Türkiye'de mutlak en çok aranan 50 teknolojik ürün” değildir. Google Trends puanları
seçilen zaman ve coğrafyada en yüksek noktaya göre 0–100 arasında normalize eder; mutlak arama
hacmini vermez. “En çok arananlar” kaynak terimle birlikte en sık aranan ilgili sorguları,
“Yükselenler” ise en hızlı büyüyen ilgili sorguları ifade eder. Bu nedenle Gaffur listedeki her
kaydı kaynak terimi ve **kaynak içindeki** sırasıyla sunar; farklı kaynak gruplarını tek bir
1–50 sıralamasıymış gibi göstermez.

Resmî açıklamalar:

- [Google Trends verisi nasıl ayarlanır?](https://support.google.com/trends/answer/4365533?hl=tr)
- [İlgili aramalar: En çok arananlar ve Yükselenler](https://support.google.com/trends/answer/4355000?hl=tr)
- [Google Trends verisini kullanma ve kaynak gösterme](https://support.google.com/trends/answer/4365538?hl=tr)
- [Google Trends API alpha duyurusu](https://developers.google.com/search/blog/2025/07/trends-api)

API alpha erişimi genel kullanıma açık olmadığı için çalışma zamanında Google'ı otomatik tarayan
bir süreç eklenmedi. Snapshot elle doğrulandı, deterministik seed olarak sürümlendi ve her kayda
doğrudan Trends doğrulama bağlantısı kondu.

## Seçim yöntemi

Kategori genelindeki ilk 25 sorgudan ürün odaklı kaynak terimleri `apple`, `bilgisayar`, `tablet`,
`asus` ve `laptop` seçildi. Bu kaynakların ilgili en çok aranan sorgularından mağaza, vergi, video,
hesap ve uygulama aramaları elendi. Teknoloji kategorisinin ve `apple` kaynağının doğrulanan yükselen
ürün/model sorgularından beş kayıt eklendi. `vatan bilgisayar`, `media markt`, `apple store`, `youtube`
ve `vergi dairesi` gibi ürün talebi olmayan sorgular bilerek katalog dışında bırakıldı.

## 50 kayıt

| Kaynak | Sinyal | Sıra | Sorgu | Değer |
|---|---:|---:|---|---:|
| apple | En çok | 1 | apple watch | 100/100 |
| apple | En çok | 2 | apple macbook | 99/100 |
| apple | En çok | 4 | apple 17 | 86/100 |
| apple | En çok | 5 | apple şarj | 82/100 |
| apple | En çok | 6 | apple 16 | 82/100 |
| apple | En çok | 7 | apple ipad | 78/100 |
| apple | En çok | 8 | apple air | 70/100 |
| apple | En çok | 9 | apple 15 | 61/100 |
| apple | En çok | 10 | apple tv | 61/100 |
| apple | Yükselen | 1 | apple watch 11 46mm | Breakout |
| apple | Yükselen | 6 | apple iphone 17 pro max | Breakout |
| bilgisayar | En çok | 3 | bilgisayar fiyatları | 7/100 |
| bilgisayar | En çok | 4 | masaüstü bilgisayar | 7/100 |
| bilgisayar | En çok | 5 | dizüstü bilgisayar | 6/100 |
| bilgisayar | En çok | 7 | laptop bilgisayar | 5/100 |
| bilgisayar | En çok | 8 | asus bilgisayar | 5/100 |
| bilgisayar | En çok | 10 | lenovo bilgisayar | 5/100 |
| tablet | En çok | 1 | tablet samsung | 100/100 |
| tablet | En çok | 2 | tablet fiyatları | 45/100 |
| tablet | En çok | 3 | lenovo tablet | 35/100 |
| tablet | En çok | 4 | tablet apple | 31/100 |
| tablet | En çok | 5 | galaxy tablet | 24/100 |
| tablet | En çok | 6 | ipad tablet | 23/100 |
| tablet | En çok | 7 | huawei | 23/100 |
| tablet | En çok | 8 | huawei tablet | 22/100 |
| tablet | En çok | 9 | tablet kalemi | 21/100 |
| tablet | En çok | 10 | samsung galaxy tablet | 19/100 |
| asus | En çok | 1 | asus rog | 100/100 |
| asus | En çok | 2 | asus tuf | 51/100 |
| asus | En çok | 3 | asus rog strix | 39/100 |
| asus | En çok | 4 | asus tuf gaming | 34/100 |
| asus | En çok | 5 | asus laptop | 31/100 |
| asus | En çok | 6 | asus monitör | 25/100 |
| asus | En çok | 7 | asus vivobook | 19/100 |
| asus | En çok | 8 | asus prime | 19/100 |
| asus | En çok | 9 | asus oled | 16/100 |
| asus | En çok | 10 | asus anakart | 16/100 |
| laptop | En çok | 1 | lenovo laptop | 100/100 |
| laptop | En çok | 2 | laptop asus | 90/100 |
| laptop | En çok | 3 | gaming laptop | 85/100 |
| laptop | En çok | 4 | laptop gaming | 85/100 |
| laptop | En çok | 5 | hp laptop | 82/100 |
| laptop | En çok | 6 | laptop ram | 74/100 |
| laptop | En çok | 7 | laptop fiyatları | 60/100 |
| laptop | En çok | 8 | laptop ssd | 54/100 |
| laptop | En çok | 9 | monster laptop | 49/100 |
| laptop | En çok | 10 | monster | 49/100 |
| Bilgisayarlar ve Elektronik Ürünler | Yükselen | 1 | xiaomi 17 pro | Breakout |
| Bilgisayarlar ve Elektronik Ürünler | Yükselen | 2 | xiaomi 17 pro max | Breakout |
| Bilgisayarlar ve Elektronik Ürünler | Yükselen | 6 | iphone 17 | +2450% |

## Uygulama davranışı

- `trend_catalog_items` fiyat/teklif tablosu değildir; talep keşif kataloğudur.
- Açılıştaki idempotent seed 50 kaynak kaydını tamamlar, yönetici yayın/gizleme ve ürün eşleştirme
  kararlarını değiştirmez.
- Public `GET /api/trends/catalog` yalnız yayındaki sinyalleri ve metodoloji uyarısını döndürür.
- Yönetim kataloğu bir sinyali gerçek `products` kaydıyla ilişkilendirebilir; olmayan ürün kimliği
  kabul edilmez.
- Sonraki snapshot aynı kapsam ve kaynaklar kullanılarak tarihli yeni bir veri sürümü olarak
  değerlendirilmelidir; eski değerlerin sessizce üzerine “canlı hacim” anlamı yüklenmemelidir.
