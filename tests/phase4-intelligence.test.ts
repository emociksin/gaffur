import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { calculatePriceBaseline } from '../src/worker/intelligence/price-baseline';
import { applyStockObservation } from '../src/worker/intelligence/stock';
import { applyPriceUpdate } from '../src/worker/scrape/engine';
import type { Product } from '../src/shared/types';

describe('Faz 4 fiyat ve stok zekası', () => {
  let db: LocalD1;
  let env: any;
  const t = 1_800_000_000;

  beforeEach(() => {
    db = new LocalD1(':memory:');
    const dir = join(process.cwd(), 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.pg.sql')).sort()) {
      db.raw().exec(readFileSync(join(dir, file), 'utf8'));
    }
    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, currency, alert_mode, threshold_pct, interval_min, engine, active,
        current_price, min_price, max_price, in_stock, stock_status, created_at)
       VALUES (?, 'test', 'Test ürün', 'TRY', 'any', 0, 60, 'auto', 1, 100, 100, 100, 1, 'in_stock', ?)`
    ).run('https://example.com/product', t - 1000);
    env = { DB: db };
  });

  it('stok değişimini ancak iki ardışık gözlemden sonra doğrular', async () => {
    const first = await applyStockObservation(env, 1, 'in_stock', 'out_of_stock', t);
    expect(first.transitioned).toBe(false);
    const second = await applyStockObservation(env, 1, 'in_stock', 'out_of_stock', t + 60);
    expect(second).toEqual(expect.objectContaining({ transitioned: true, fromStatus: 'in_stock', toStatus: 'out_of_stock' }));
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM stock_transitions').get()).toEqual({ n: 1 });
  });

  it('unknown durumunu geçiş saymaz ve üçüncü gözlemde parser bayrağı açar', async () => {
    await applyStockObservation(env, 1, 'in_stock', 'unknown', t);
    await applyStockObservation(env, 1, 'in_stock', 'unknown', t + 60);
    const third = await applyStockObservation(env, 1, 'in_stock', 'unknown', t + 120);
    expect(third).toEqual(expect.objectContaining({ transitioned: false, unknownStreak: 3, parserError: true }));
    expect(db.raw().prepare('SELECT confirmed_status, parser_error FROM product_stock_state WHERE product_id = 1').get())
      .toEqual({ confirmed_status: 'in_stock', parser_error: 1 });
  });

  it('baz çizgisinde stok dışı fiyatları kullanmaz', async () => {
    const insert = db.raw().prepare('INSERT INTO price_history (product_id, price, in_stock, checked_at) VALUES (1, ?, ?, ?)');
    insert.run(90, 1, t - 9 * 86400);
    insert.run(100, 1, t - 5 * 86400);
    insert.run(110, 1, t - 86400);
    insert.run(10, 0, t - 3600);
    const baseline = await calculatePriceBaseline(env, 1, t);
    expect(baseline).toEqual(expect.objectContaining({ median_10d: 100, low_10d: 90, all_time_low: 90, sample_count_10d: 3 }));
  });

  it('%2 altındaki fiyat hareketini bildirime dönüştürmez', async () => {
    db.raw().prepare('INSERT INTO price_history (product_id, price, in_stock, checked_at) VALUES (1, 100, 1, ?)').run(t - 3600);
    const product = await db.prepare('SELECT * FROM products WHERE id = 1').first<Product>();
    const outcome = await applyPriceUpdate(
      env,
      { telegram_token: '', telegram_chat: '', default_interval: '60', notify_stock: '1', notify_rise: '1' },
      product!,
      { price: 99, inStock: true, engine: 'direct', parserVersion: 'test@1' },
      t
    );
    expect(outcome).toEqual(expect.objectContaining({ changed: true, notified: false }));
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 0 });
  });
});
