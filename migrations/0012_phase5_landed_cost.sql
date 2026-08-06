-- Faz 5: kargo, taksit ve mevzuat-versiyonlu toplam maliyet
ALTER TABLE offers ADD COLUMN origin_country TEXT;
ALTER TABLE offers ADD COLUMN origin_region TEXT NOT NULL DEFAULT 'domestic';

CREATE TABLE IF NOT EXISTS shipping_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  destination_country TEXT NOT NULL DEFAULT 'TR',
  cost REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  free_shipping_threshold REAL,
  min_delivery_days INTEGER,
  max_delivery_days INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_offer ON shipping_quotes(offer_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS installment_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  provider TEXT,
  card_family TEXT,
  installment_count INTEGER NOT NULL,
  monthly_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  interest_rate REAL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_installments_offer ON installment_options(offer_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS tax_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_code TEXT NOT NULL UNIQUE,
  scenario TEXT NOT NULL,
  origin_region TEXT NOT NULL,
  product_kind TEXT NOT NULL,
  customs_rate REAL,
  additional_rate REAL NOT NULL DEFAULT 0,
  exemption_eur REAL NOT NULL DEFAULT 0,
  max_value_eur REAL,
  max_weight_kg REAL,
  requires_detailed_declaration INTEGER NOT NULL DEFAULT 0,
  prohibited INTEGER NOT NULL DEFAULT 0,
  effective_from INTEGER NOT NULL,
  effective_to INTEGER,
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  verified_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tax_rules_lookup
  ON tax_rules(scenario, origin_region, product_kind, effective_from);

CREATE TABLE IF NOT EXISTS landed_cost_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,
  rule_code TEXT REFERENCES tax_rules(rule_code),
  status TEXT NOT NULL,
  currency TEXT NOT NULL,
  fx_rate_try REAL NOT NULL,
  eur_try_rate REAL NOT NULL,
  item_try REAL NOT NULL,
  shipping_try REAL NOT NULL,
  tax_try REAL,
  known_subtotal_try REAL NOT NULL,
  total_try REAL,
  input_json TEXT NOT NULL,
  breakdown_json TEXT NOT NULL,
  calculated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_landed_quotes_offer ON landed_cost_quotes(offer_id, calculated_at DESC);

INSERT OR IGNORE INTO tax_rules
  (rule_code, scenario, origin_region, product_kind, customs_rate, additional_rate,
   exemption_eur, max_value_eur, max_weight_kg, requires_detailed_declaration, prohibited,
   effective_from, source_title, source_url, verified_at)
VALUES
  ('TR_DOMESTIC_V1', 'domestic', 'domestic', 'general', 0, 0, 0, NULL, NULL, 0, 0,
   1770336000, 'Yurtiçi toplam maliyet', 'https://gaffur.net', 1785974400),
  ('TR_POST_GENERAL_10813', 'postal', 'any', 'general', NULL, 0, 0, 1500, 30, 1, 0,
   1770336000, 'Ticaret Bakanlığı - Posta ve Hızlı Kargo Muafiyeti',
   'https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/posta-ve-hizli-kargo-muafiyeti', 1785974400),
  ('TR_POST_BOOK_2026', 'postal', 'any', 'book', 0, 0, 0, 1500, 30, 0, 0,
   1770336000, 'Ticaret Bakanlığı - Posta ve Hızlı Kargo Muafiyeti',
   'https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/posta-ve-hizli-kargo-muafiyeti', 1785974400),
  ('TR_POST_HEALTH_EU_10813', 'postal', 'eu', 'health', 0.30, 0.20, 0, 1500, 30, 0, 0,
   1770336000, '10813 sayılı Karar ve Ticaret Bakanlığı güncel açıklaması',
   'https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/posta-ve-hizli-kargo-muafiyeti', 1785974400),
  ('TR_POST_HEALTH_OTHER_10813', 'postal', 'other', 'health', 0.60, 0.20, 0, 1500, 30, 0, 0,
   1770336000, '10813 sayılı Karar ve Ticaret Bakanlığı güncel açıklaması',
   'https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/posta-ve-hizli-kargo-muafiyeti', 1785974400),
  ('TR_POST_PHONE_PROHIBITED_2026', 'postal', 'any', 'phone', NULL, 0, 0, NULL, NULL, 0, 1,
   1770336000, 'Ticaret Bakanlığı - Posta ve Hızlı Kargo Muafiyeti',
   'https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/posta-ve-hizli-kargo-muafiyeti', 1785974400),
  ('TR_PASSENGER_EU_2026', 'passenger', 'eu', 'general', 0.30, 0.20, 430, 1500, NULL, 0, 0,
   1770336000, 'Ticaret Bakanlığı - Yolcu Muafiyetleri',
   'https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/yolcu-muafiyetleri', 1785974400),
  ('TR_PASSENGER_OTHER_2026', 'passenger', 'other', 'general', 0.60, 0.20, 430, 1500, NULL, 0, 0,
   1770336000, 'Ticaret Bakanlığı - Yolcu Muafiyetleri',
   'https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/yolcu-muafiyetleri', 1785974400);
