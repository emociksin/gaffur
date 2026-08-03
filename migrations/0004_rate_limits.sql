-- Ziyaretcilere acik eylemler icin hiz siniri (urun ekleme, onizleme).
-- Anahtar bicimi: "<eylem>:<ip>" veya global tavan icin "<eylem>:__all__".
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
