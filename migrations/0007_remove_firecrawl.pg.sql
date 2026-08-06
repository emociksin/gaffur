UPDATE products SET engine = 'auto' WHERE engine = 'firecrawl';
DELETE FROM settings WHERE key = 'firecrawl_key';
