-- Giris denemesi sayaci (kaba kuvvet korumasi).
-- Anahtar: Cloudflare'in ekledigi CF-Connecting-IP; '__global__' satiri ise
-- IP'den bagimsiz toplam tavan (dagitik denemeleri de sinirlar).
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
