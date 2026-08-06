import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { app } from '../src/worker/index';
import {
  normalizeGtin,
  normalizeIdentity,
  normalizeMpn,
  variantsConflict,
} from '../src/worker/catalog/normalize';
import {
  getCatalogMetrics,
  refreshCatalogMatches,
  reviewMatchCandidate,
  scoreProductPair,
} from '../src/worker/catalog/matcher';

describe('Faz 8 katalog ve ürün eşleştirme', () => {
  let db: LocalD1;
  let env: any;
  const t = 1_900_000_000;

  beforeEach(() => {
    db = new LocalD1(':memory:');
    const dir = join(process.cwd(), 'migrations');
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql') && !name.endsWith('.pg.sql')).sort()) {
      db.raw().exec(readFileSync(join(dir, file), 'utf8'));
    }
    env = { DB: db, ALLOW_OPEN: '1' };
  });

  const product = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    title: 'Apple iPhone 15 128 GB Siyah',
    site: 'shop-a',
    brand: 'Apple',
    gtin: '4006381333931',
    mpn: 'MTP03TU-A',
    current_price: 40_000,
    currency: 'TRY',
    category_id: 1,
    active: 1,
    ...overrides,
  });

  function insertProduct(values: {
    url: string;
    site: string;
    title: string;
    brand?: string;
    gtin?: string;
    mpn?: string;
    price?: number;
  }) {
    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, brand, gtin, mpn, currency, alert_mode, threshold_pct, interval_min,
        engine, active, current_price, in_stock, stock_status, last_checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'TRY', 'drop', 0, 60, 'auto', 1, ?, 1, 'in_stock', ?, ?)`
    ).run(
      values.url, values.site, values.title, values.brand ?? null, values.gtin ?? null,
      values.mpn ?? null, values.price ?? 40_000, t, t
    );
  }

  it('Türkçe başlığı marka, model ve varyant eksenlerine ayırır', () => {
    const identity = normalizeIdentity({ title: 'APPLE iPhone 15 Pro 128 GB Gece Siyahı', brand: 'Apple' });
    expect(identity.normalizedTitle).toBe('apple iphone 15 pro 128 gb gece siyahi');
    expect(identity.normalizedBrand).toBe('apple');
    expect(identity.modelKey).toBe('iphone 15 pro gece');
    expect(identity.variantKey).toBe('capacity:128gb|color:siyah');
  });

  it('GTIN kontrol basamağını doğrular ve uydurma tekrar kodunu reddeder', () => {
    expect(normalizeGtin('4006381333931')).toEqual({ value: '4006381333931', valid: true });
    expect(normalizeGtin('4006381333932').valid).toBe(false);
    expect(normalizeGtin('11111111').valid).toBe(false);
    expect(normalizeGtin('SKU-4006381333931').valid).toBe(false);
  });

  it('MPN için harf+rakam ve anlamlı uzunluk güven kapısını uygular', () => {
    expect(normalizeMpn('MTP03TU-A')).toEqual({ value: 'MTP03TUA', reliable: true });
    expect(normalizeMpn('MODEL')).toEqual({ value: 'MODEL', reliable: false });
    expect(normalizeMpn('12345').reliable).toBe(false);
  });

  it('geçerli aynı GTIN için yüksek güven üretir ama varyant çakışmasını reddeder', () => {
    const exact = scoreProductPair(product(), product({ id: 2, site: 'shop-b', title: 'Apple iPhone 15 128GB Black' }));
    expect(exact).toEqual(expect.objectContaining({ eligible: true, exactCodeKind: 'gtin', score: 99, band: 'high' }));

    const left = normalizeIdentity(product());
    const right = normalizeIdentity(product({ title: 'Apple iPhone 15 256 GB Siyah' }));
    expect(variantsConflict(left, right)).toBe('capacity');
    const conflict = scoreProductPair(product(), product({ id: 3, title: 'Apple iPhone 15 256 GB Siyah' }));
    expect(conflict.eligible).toBe(false);
    expect(conflict.reasons.join(' ')).toMatch(/kapasite/i);
  });

  it('kimlikleri türetir, yalnız uygun adayı insan kuyruğuna alır', async () => {
    insertProduct({ url: 'https://a.test/iphone', site: 'a', title: 'Apple iPhone 15 128 GB Siyah', brand: 'Apple', gtin: '4006381333931', mpn: 'MTP03TU-A', price: 40_000 });
    insertProduct({ url: 'https://b.test/iphone', site: 'b', title: 'Apple iPhone 15 128GB Black', brand: 'Apple', gtin: '4006381333931', mpn: 'MTP03TU-A', price: 40_500 });
    insertProduct({ url: 'https://c.test/iphone', site: 'c', title: 'Apple iPhone 15 256 GB Siyah', brand: 'Apple', gtin: '4006381333931', mpn: 'MTP03TU-A', price: 47_000 });
    insertProduct({ url: 'https://d.test/tv', site: 'd', title: 'Samsung 55 QLED Televizyon', brand: 'Samsung', price: 42_000 });

    const result = await refreshCatalogMatches(env, t);
    expect(result).toEqual({ products: 4, candidates: 1, calculatedAt: t });
    expect(db.raw().prepare('SELECT normalized_brand, gtin_valid, mpn_reliable FROM product_identities WHERE product_id = 1').get())
      .toEqual({ normalized_brand: 'apple', gtin_valid: 1, mpn_reliable: 1 });
    expect(db.raw().prepare('SELECT product_a_id, product_b_id, status, score FROM product_match_candidates').all())
      .toEqual([{ product_a_id: 1, product_b_id: 2, status: 'pending', score: 99 }]);
  });

  it('onaydan önce birleşme yapmaz, onayla iki ürünü tek kanonik gruba alır', async () => {
    insertProduct({ url: 'https://a.test/iphone', site: 'a', title: 'Apple iPhone 15 128 GB Siyah', brand: 'Apple', gtin: '4006381333931' });
    insertProduct({ url: 'https://b.test/iphone', site: 'b', title: 'Apple iPhone 15 128GB Black', brand: 'Apple', gtin: '4006381333931' });
    await refreshCatalogMatches(env, t);
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM catalog_memberships').get()).toEqual({ n: 0 });

    const reviewed = await reviewMatchCandidate(env, 1, 'approved', {}, t + 1);
    expect(reviewed.catalogProductId).toBeGreaterThan(0);
    expect(db.raw().prepare('SELECT product_id, catalog_product_id FROM catalog_memberships ORDER BY product_id').all())
      .toEqual([
        { product_id: 1, catalog_product_id: reviewed.catalogProductId },
        { product_id: 2, catalog_product_id: reviewed.catalogProductId },
      ]);
    expect(db.raw().prepare('SELECT status FROM product_match_candidates WHERE id = 1').get()).toEqual({ status: 'approved' });
  });

  it('precision hedefini asgari insan inceleme örneği olmadan geçti saymaz', async () => {
    insertProduct({ url: 'https://a.test/iphone', site: 'a', title: 'Apple iPhone 15 128 GB Siyah', brand: 'Apple', gtin: '4006381333931' });
    insertProduct({ url: 'https://b.test/iphone', site: 'b', title: 'Apple iPhone 15 128GB Black', brand: 'Apple', gtin: '4006381333931' });
    await refreshCatalogMatches(env, t);
    await reviewMatchCandidate(env, 1, 'approved', {}, t + 1);
    const metrics = await getCatalogMetrics(env);
    expect(metrics.reviewedPrecision).toBe(100);
    expect(metrics.precisionSampleReady).toBe(false);
    expect(metrics.precisionTargetMet).toBeNull();
    expect(metrics.matchRate).toBe(100);
  });

  it('katalog yönetim API uçlarını public oturuma açmaz', async () => {
    const protectedEnv = { DB: db, PASSWORD: 'admin-secret' };
    const metrics = await app.fetch(new Request('https://gaffur.test/api/catalog/metrics'), protectedEnv as any);
    const refresh = await app.fetch(new Request('https://gaffur.test/api/catalog/matches/refresh', { method: 'POST' }), protectedEnv as any);
    expect(metrics.status).toBe(401);
    expect(refresh.status).toBe(401);
  });

  it('yönetim API kuyruğunu döndürür ve kararı kaydeder', async () => {
    insertProduct({ url: 'https://a.test/iphone', site: 'a', title: 'Apple iPhone 15 128 GB Siyah', brand: 'Apple', gtin: '4006381333931' });
    insertProduct({ url: 'https://b.test/iphone', site: 'b', title: 'Apple iPhone 15 128GB Black', brand: 'Apple', gtin: '4006381333931' });
    await refreshCatalogMatches(env, t);

    const queueResponse = await app.fetch(new Request('https://gaffur.test/api/catalog/matches'), env);
    const queue = await queueResponse.json() as any;
    expect(queueResponse.status).toBe(200);
    expect(queue.matches[0]).toEqual(expect.objectContaining({ score: 99, reasons: expect.any(Array) }));

    const reviewResponse = await app.fetch(new Request('https://gaffur.test/api/catalog/matches/1/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected' }),
    }), env);
    expect(reviewResponse.status).toBe(200);
    expect(db.raw().prepare('SELECT status FROM product_match_candidates WHERE id = 1').get()).toEqual({ status: 'rejected' });
  });
});
