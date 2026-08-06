import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { app } from '../src/worker/index';
import { ensureTrendCatalogSeeds, listTrendCatalog, updateTrendCatalogItem } from '../src/worker/catalog/trends';
import { TREND_CAPTURED_AT, TREND_CATALOG_SEEDS } from '../src/worker/catalog/trend-seeds';

describe('Faz 9 Google Trends teknoloji talep kataloğu', () => {
  let db: LocalD1;
  let env: any;

  beforeEach(() => {
    db = new LocalD1(':memory:');
    const dir = join(process.cwd(), 'migrations');
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql') && !name.endsWith('.pg.sql')).sort()) {
      db.raw().exec(readFileSync(join(dir, file), 'utf8'));
    }
    env = { DB: db, ALLOW_OPEN: '1' };
  });

  it('kaynaklı snapshot tam 50 benzersiz talep sinyali içerir', async () => {
    expect(TREND_CATALOG_SEEDS).toHaveLength(50);
    expect(new Set(TREND_CATALOG_SEEDS.map((item) => `${item.anchor}|${item.type}|${item.query}`)).size).toBe(50);

    const result = await ensureTrendCatalogSeeds(env);
    expect(result).toEqual({ seeded: 50, capturedAt: TREND_CAPTURED_AT });
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM trend_catalog_items').get()).toEqual({ n: 50 });
  });

  it('doğrulanan kaynak içi sıra ve göreli değerleri kayıpsız saklar', async () => {
    await ensureTrendCatalogSeeds(env);
    expect(db.raw().prepare(
      "SELECT anchor_rank, anchor_interest, signal_rank, interest_value FROM trend_catalog_items WHERE query = 'apple watch'"
    ).get()).toEqual({ anchor_rank: 3, anchor_interest: 88, signal_rank: 1, interest_value: 100 });
    expect(db.raw().prepare(
      "SELECT anchor_rank, anchor_interest, signal_rank, interest_value FROM trend_catalog_items WHERE query = 'lenovo laptop'"
    ).get()).toEqual({ anchor_rank: 21, anchor_interest: 40, signal_rank: 1, interest_value: 100 });
    expect(db.raw().prepare(
      "SELECT signal_type, signal_rank, growth_label FROM trend_catalog_items WHERE query = 'iphone 17'"
    ).get()).toEqual({ signal_type: 'rising', signal_rank: 6, growth_label: '+2450%' });
  });

  it('mağaza ve genel hizmet sorgularını ürün talep kataloğuna almaz', () => {
    const queries = TREND_CATALOG_SEEDS.map((item) => item.query.toLocaleLowerCase('tr-TR'));
    for (const excluded of ['vatan bilgisayar', 'media markt', 'apple store', 'vergi dairesi', 'youtube']) {
      expect(queries).not.toContain(excluded);
    }
  });

  it('public uç 50 kaydı kapsam ve göreli değer uyarısıyla oturumsuz döndürür', async () => {
    await ensureTrendCatalogSeeds(env);
    const protectedEnv = { DB: db, PASSWORD: 'admin-secret' };
    const response = await app.fetch(new Request('https://gaffur.test/api/trends/catalog'), protectedEnv as any);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.catalog).toHaveLength(50);
    expect(body.meta).toEqual(expect.objectContaining({
      source: 'Google Trends',
      total: 50,
      scope: expect.stringContaining('Türkiye'),
      disclaimer: expect.stringMatching(/göreli ilgi.*mutlak arama hacmi/i),
    }));
    expect(body.catalog[0].query_url).toMatch(/^https:\/\/trends\.google\.com\/trends\/explore\?/);
  });

  it('yönetim uçlarını public oturuma açmaz', async () => {
    await ensureTrendCatalogSeeds(env);
    const protectedEnv = { DB: db, PASSWORD: 'admin-secret' };
    const list = await app.fetch(new Request('https://gaffur.test/api/trends/catalog/admin'), protectedEnv as any);
    const patch = await app.fetch(new Request('https://gaffur.test/api/trends/catalog/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'hidden' }),
    }), protectedEnv as any);
    expect(list.status).toBe(401);
    expect(patch.status).toBe(401);
  });

  it('gizlenen kaydı public listeden çıkarır ve seed onarımı yönetici kararını bozmaz', async () => {
    await ensureTrendCatalogSeeds(env);
    const first = (await listTrendCatalog(env, false))[0];
    await updateTrendCatalogItem(env, first.id, { status: 'hidden' }, TREND_CAPTURED_AT + 60);
    expect(await listTrendCatalog(env, true)).toHaveLength(49);

    await ensureTrendCatalogSeeds(env);
    const repaired = await listTrendCatalog(env, false);
    expect(repaired).toHaveLength(50);
    expect(repaired.find((item) => item.id === first.id)?.status).toBe('hidden');
  });

  it('talep sinyalini yalnız mevcut gerçek takip ürününe bağlar', async () => {
    await ensureTrendCatalogSeeds(env);
    const first = (await listTrendCatalog(env, false))[0];
    await expect(updateTrendCatalogItem(env, first.id, { matchedProductId: 999 })).rejects.toThrow(/ürün bulunamadı/i);

    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, currency, alert_mode, threshold_pct, interval_min, engine, active, stock_status, created_at)
       VALUES ('https://shop.test/apple-watch', 'shop', 'Apple Watch', 'TRY', 'drop', 0, 60, 'auto', 1, 'unknown', ?)`
    ).run(TREND_CAPTURED_AT);
    const updated = await updateTrendCatalogItem(env, first.id, { matchedProductId: 1 });
    expect(updated).toEqual(expect.objectContaining({ matched_product_id: 1, matched_product_title: 'Apple Watch' }));
  });
});
