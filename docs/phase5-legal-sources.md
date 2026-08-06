# Faz 5 Mevzuat Kaynakları — 6 Ağustos 2026 Doğrulaması

Bu dosya hesap motoruna giren Türkiye gümrük kurallarının izini tutar. Oranlar
`tax_rules` tablosunda `effective_from`, `effective_to`, kaynak URL ve doğrulama tarihiyle
versiyonlanır. Eski hesaplar `landed_cost_quotes.rule_code` ile kullandıkları kuralı korur.

## Posta ve hızlı kargo

Birincil güncel kaynak: [T.C. Ticaret Bakanlığı — Posta ve Hızlı Kargo Muafiyeti](https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/posta-ve-hizli-kargo-muafiyeti)

- 10813 sayılı Karar 7 Ocak 2026 tarihli ve 33130 sayılı Resmî Gazete'de yayımlandı;
  yayımından 30 gün sonra, 6 Şubat 2026'da yürürlüğe girdi.
- Genel e-ticaret ürünü için eski 30 Avro muafiyeti yoktur. 0–1500 Avro aralığındaki
  kişisel, ticari olmayan gönderi detaylı beyanla ve ürüne özgü ithalat yükümlülükleriyle
  işlem görür. GTİP olmadan kesin vergi hesaplanamaz.
- %30 (AB'den doğrudan) ve %60 (diğer ülke), uygun rapor/reçeteyle gelen ve 1500
  Avro'yu aşmayan ilaç ile takviye edici gıdaların tek ve maktu oranlarıdır. ÖTV IV
  listesindeyse ilave %20 uygulanır.
- Kişisel kitap/basılı yayında 1500 Avro'ya kadar oran %0'dır.
- Posta kıymetine Türkiye giriş yerine kadarki navlun eklenir; ayrı gösterilmemişse
  3 Avro emsal navlun eklenir.
- Cep telefonu posta/hızlı kargoyla vergili veya vergisiz teslim edilemez.
- 430 Avro yolcu muafiyeti posta siparişine uygulanmaz.

Bu nedenle Gaffur genel posta ürünlerinde toplam rakam üretmez; yalnız bilinen ürün +
navlun alt toplamını ve “detaylı beyan gerekli” durumunu gösterir.

## Yolcu beraberinde

Birincil güncel kaynak: [T.C. Ticaret Bakanlığı — Yolcu Muafiyetleri](https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/yolcu-muafiyetleri)

- Ticari olmayan yolcu eşyasında yetişkin başına 430 Avro, 15 yaş altı için 150 Avro
  muafiyet vardır.
- Kıymet 1500 Avro'yu aşmıyorsa muafiyeti aşan kısma AB'den doğrudan gelişte %30,
  diğer ülkede %60; ÖTV IV listesinde ilave %20 uygulanır.
- Bu senaryo yalnız gerçekten yolcu beraberinde gelen eşya içindir.

## Hesap sınırı

Araç hukuki/mali danışmanlık vermez. Kullanıcı kur, ürün bedeli, kargo, menşe senaryosu,
ağırlık ve ürün sınıfını kendisi girer. Genel ithalatta GTİP, ürün güvenliği denetimi,
anti-damping, ardiye ve müşavirlik gibi tutarlar bilinmeden kapıdaki kesin toplam
hesaplanamaz; arayüz bu belirsizliği saklamaz.
