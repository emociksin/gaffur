# Faz 7 — 10 Günlük Fiyat Kuralı Kaynak Kaydı

Doğrulama tarihi: 6 Ağustos 2026.

## Birincil kaynaklar

- T.C. Ticaret Bakanlığı, “Aldatıcı Reklam ve Haksız Ticari Uygulamalarla Mücadelede Yeni Dönem Başlıyor”, 27 Temmuz 2026: 1 Temmuz 2026 tarihli ve 33297 sayılı Resmî Gazete’de yayımlanan değişikliğin 1 Ağustos 2026’da yürürlüğe girdiğini; indirimli satış reklamlarında indirim başlangıcından önceki son 10 gün içinde uygulanan en düşük fiyatın referans alınacağını açıklar.
  https://www.ticaret.gov.tr/haberler/aldaticici-reklam-ve-haksiz-ticari-uygulamalarla-mucadelede-yeni-donem-basliyor
- T.C. Ticaret Bakanlığı Tüketicinin Korunması ve Piyasa Gözetimi Genel Müdürlüğü, “Fiyat Etiketleri Hakkında Bilgilendirme”: mal satışlarında önceki 10 gün içindeki en düşük fiyatın esas alınacağını ve ispat yükünün satıcı/sağlayıcıda olduğunu belirtir.
  https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/fiyat-etiketleri-hakkinda-bilgilendirme

## Ürün kararı

Gaffur satıcının kampanya başlangıcını, tüm mağaza/kasa fiyatlarını veya ispat dosyasını görmez. Bu nedenle sistem:

- “ihlal” kararı üretmez;
- yalnızca `tutarlı`, `şüpheli` veya `yetersiz kanıt` sınıflaması yapar;
- sonucu public ürün sayfasında rozet olarak yayımlamaz;
- yöneticiye tarihli gözlem serisini CSV olarak verir.

Bu araç hukuki danışmanlık veya resmî tespit yerine geçmez.
