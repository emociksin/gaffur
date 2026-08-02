-- Vintage palete gecis: eski kehribar varsayilani (#FFB020) yerine
-- tabela turuncusu (#E4611C). Sadece hic elle degistirilmemis, yani
-- eski varsayilanla kalmis kategoriler guncellenir.
UPDATE categories SET color = '#E4611C' WHERE color = '#FFB020';
