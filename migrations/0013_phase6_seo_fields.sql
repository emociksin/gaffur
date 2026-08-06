-- Faz 6: public ürün sayfalarında kullanılacak kanonik ürün kimlikleri
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN gtin TEXT;
ALTER TABLE products ADD COLUMN mpn TEXT;
ALTER TABLE products ADD COLUMN sku TEXT;

CREATE INDEX IF NOT EXISTS idx_products_gtin ON products(gtin);
CREATE INDEX IF NOT EXISTS idx_products_mpn ON products(mpn);
