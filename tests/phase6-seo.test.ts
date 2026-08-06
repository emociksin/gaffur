import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { app } from '../src/worker/index';
import { loadPublicProduct, slugify } from '../src/worker/seo';
import { isAdminPathname, publicCategoryPath, publicProductPath } from '../src/shared/routes';

const shell = `<!doctype html><html lang="tr"><head>
  <meta name="description" content="Gaffur" /><title>Gaffur</title>
</head><body><div id="root"></div></body></html>`;

describe('Faz 6 SSR, yapilandirilmis veri ve indeksleme', () => {
  let db: LocalD1;
  let env: any;
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    db = new LocalD1(':memory:');
    const dir = join(process.cwd(), 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.pg.sql')).sort()) {
      db.raw().exec(readFileSync(join(dir, file), 'utf8'));
    }
    env = {
      DB: db,
      PUBLIC_BASE_URL: 'https://gaffur.test',
      ASSETS: { fetch: async () => new Response(shell, { headers: { 'content-type': 'text/html' } }) },
    };

    db.raw().prepare(
      `INSERT INTO categories (name, color, created_at) VALUES ('Cep Telefonlari', '#f90', ?)`
    ).run(now - 40 * 86400);
    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, image, brand, gtin, mpn, sku, currency, category_id,
        alert_mode, threshold_pct, interval_min, engine, active, current_price,
        min_price, max_price, in_stock, stock_status, last_checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TRY', 1, 'drop', 0, 60, 'auto', ?, ?, ?, ?, 1, 'in_stock', ?, ?)`
    ).run('https://shop.test/telefon', 'shop', 'Çok İyi Telefon', 'https://img.test/telefon.jpg',
      'Örnek', '12345678', 'MPN-1', 'SKU-1', 1, 9999, 8999, 11999, now, now - 40 * 86400);
    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, currency, category_id, alert_mode, threshold_pct, interval_min,
        engine, active, current_price, min_price, max_price, in_stock, stock_status, last_checked_at, created_at)
       VALUES ('https://shop.test/yeni', 'shop', 'Yeni Urun', 'TRY', 1, 'drop', 0, 60,
        'auto', 1, 500, 500, 500, 1, 'in_stock', ?, ?)`
    ).run(now, now - 86400);
    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, currency, category_id, alert_mode, threshold_pct, interval_min,
        engine, active, current_price, min_price, max_price, in_stock, stock_status, last_checked_at, created_at)
       VALUES ('https://shop.test/arsiv', 'shop', 'Arsiv Urun', 'TRY', 1, 'drop', 0, 60,
        'auto', 0, 300, 250, 350, 0, 'out_of_stock', ?, ?)`
    ).run(now, now - 40 * 86400);

    const offer = db.raw().prepare(
      `INSERT INTO offers
       (product_id, marketplace, seller_name, url, canonical_offer_key, active, first_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    );
    const snapshot = db.raw().prepare(
      `INSERT INTO offer_snapshots
       (offer_id, price, currency, stock_status, shipping_cost, checked_at)
       VALUES (?, ?, 'TRY', 'in_stock', ?, ?)`
    );
    offer.run(1, 'magaza-a', 'Magaza A', 'https://a.test/p', 'offer-a', now, now);
    offer.run(1, 'magaza-b', 'Magaza B', 'https://b.test/p', 'offer-b', now, now);
    snapshot.run(1, 9999, 0, now);
    snapshot.run(2, 10100, 49.9, now);
    offer.run(2, 'magaza-a', 'Magaza A', 'https://a.test/new', 'offer-new', now, now);
    snapshot.run(3, 500, 0, now);

    const history = db.raw().prepare(
      'INSERT INTO price_history (product_id, price, in_stock, checked_at) VALUES (?, ?, ?, ?)'
    );
    history.run(1, 11000, 1, now - 31 * 86400);
    history.run(1, 9999, 1, now);
    history.run(3, 350, 1, now - 31 * 86400);
    history.run(3, 300, 0, now);
    db.raw().prepare(
      `INSERT INTO price_baselines
       (product_id, median_30d, median_90d, all_time_low, calculated_at)
       VALUES (1, 10500, 11000, 8999, ?)`
    ).run(now);
  });

  it('Turkce basligi kararli ASCII slug yapar', () => {
    expect(slugify('Çok İyi Telefon')).toBe('cok-iyi-telefon');
  });

  it('public ve yonetim yollarini birbirinden kesin ayirir', () => {
    expect(isAdminPathname('/')).toBe(false);
    expect(isAdminPathname('/yonetim-sahte')).toBe(false);
    expect(isAdminPathname('/yonetim')).toBe(true);
    expect(isAdminPathname('/yonetim/ayarlar')).toBe(true);
    expect(publicProductPath({ id: 4, title: 'Çok İyi Telefon' })).toBe('/urun/4-cok-iyi-telefon');
    expect(publicCategoryPath({ id: 2, name: 'Cep Telefonları' })).toBe('/kategori/2-cep-telefonlari');
  });

  it('public API uzerinden urun ekleme veya onizleme yaptirmaz', async () => {
    const protectedEnv = { ...env, PASSWORD: 'admin-secret' };
    const add = await app.fetch(new Request('https://gaffur.test/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://shop.test/yeni-urun' }),
    }), protectedEnv);
    const preview = await app.fetch(new Request('https://gaffur.test/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://shop.test/yeni-urun' }),
    }), protectedEnv);
    expect(add.status).toBe(401);
    expect(preview.status).toBe(401);
  });

  it('iki teklif veya 30 gun gecmis kuraliyla indekslenebilirligi hesaplar', async () => {
    const established = await loadPublicProduct(env, 1);
    const newProduct = await loadPublicProduct(env, 2);
    expect(established).toEqual(expect.objectContaining({ offerCount: 2, historyDays: 31, indexable: true }));
    expect(newProduct).toEqual(expect.objectContaining({ offerCount: 1, historyDays: 0, indexable: false }));
  });

  it('eski slugi 301 ile kanonik urun adresine yonlendirir', async () => {
    const response = await app.fetch(new Request('https://gaffur.test/urun/1-eski-ad'), env);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/urun/1-cok-iyi-telefon');
  });

  it('urun sayfasini gorunur tablo, canonical ve dogru JSON-LD ile SSR uretir', async () => {
    const response = await app.fetch(new Request('https://gaffur.test/urun/1-cok-iyi-telefon'), env);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toContain('index');
    expect(response.headers.get('x-gaffur-csp-nonce')).toBeNull();
    expect(response.headers.get('content-security-policy')).toMatch(/nonce-[a-f0-9]+/);
    expect(html).toContain('data-gaffur-ssr="1"');
    expect(html).toContain('<h1>Çok İyi Telefon</h1>');
    expect(html).toContain('class="seo-price-chart"');
    expect(html).toContain('<table class="seo-table">');
    expect(html).toContain('Günlük ortalama');
    expect(html).toContain('rel="canonical" href="https://gaffur.test/urun/1-cok-iyi-telefon"');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('"@type":"AggregateOffer"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"gtin8":"12345678"');
    expect(html).not.toMatch(/Review|aggregateRating/);
  });

  it('yetersiz kanitli yeni urunu noindex yapar', async () => {
    const response = await app.fetch(new Request('https://gaffur.test/urun/2-yeni-urun'), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(await response.text()).toContain('name="robots" content="noindex, follow"');
  });

  it('sorgu parametreli public sayfalari canonical kalsa da noindex yapar', async () => {
    const product = await app.fetch(new Request('https://gaffur.test/urun/1-cok-iyi-telefon?sort=price'), env);
    const category = await app.fetch(new Request('https://gaffur.test/kategori/1-cep-telefonlari?filter=stock'), env);
    expect(product.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(category.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(await product.text()).toContain('rel="canonical" href="https://gaffur.test/urun/1-cok-iyi-telefon"');
  });

  it('urun JSON ucunu public makine verisi olarak sunar', async () => {
    const response = await app.fetch(new Request('https://gaffur.test/urun/1-cok-iyi-telefon.json'), env);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(body).toEqual(expect.objectContaining({ id: 1, gtin: '12345678', indexable: true }));
    expect(body.coverage).toEqual({ offerCount: 2, historyDays: 31 });
  });

  it('kategori sayfasinda ItemList ve urun baglantilari uretir', async () => {
    const response = await app.fetch(new Request('https://gaffur.test/kategori/1-cep-telefonlari'), env);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('href="/urun/1-cok-iyi-telefon"');
  });

  it('aktif, arsiv ve kategori sitemaplerini gercek durumla ayirir', async () => {
    const index = await (await app.fetch(new Request('https://gaffur.test/sitemap.xml'), env)).text();
    const active = await (await app.fetch(new Request('https://gaffur.test/sitemaps/urunler-aktif.xml'), env)).text();
    const archive = await (await app.fetch(new Request('https://gaffur.test/sitemaps/urunler-arsiv.xml'), env)).text();
    const categories = await (await app.fetch(new Request('https://gaffur.test/sitemaps/kategoriler.xml'), env)).text();
    expect(index).toContain('/sitemaps/urunler-aktif.xml');
    expect(active).toContain('/urun/1-cok-iyi-telefon');
    expect(active).not.toContain('/urun/2-yeni-urun');
    expect(archive).toContain('/urun/3-arsiv-urun');
    expect(categories).toContain('/kategori/1-cep-telefonlari');
  });

  it('satistan kalkan urunu silmeden son fiyat notuyla korur', async () => {
    const response = await app.fetch(new Request('https://gaffur.test/urun/3-arsiv-urun'), env);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('artık aktif olarak izlenmiyor');
    expect(html).toContain('son kayıtlı fiyatı');
  });
});
