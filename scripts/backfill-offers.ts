// Mevcut products + price_history → offers + offer_snapshots backfill (idempotent).
// Kullanım: npx tsx scripts/backfill-offers.ts [--pg]
// --pg: DATABASE_URL üzerinden Postgres, yoksa SQLite (data/gaffur.db)
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const usePg = process.argv.includes('--pg');

interface DB {
  run(sql: string, ...args: unknown[]): { lastInsertRowid?: number | bigint };
  all(sql: string, ...args: unknown[]): Record<string, unknown>[];
  get(sql: string, ...args: unknown[]): Record<string, unknown> | undefined;
  exec(sql: string): void;
}

function sqliteDb(): DB {
  const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'gaffur.db');
  const db = new DatabaseSync(DB_PATH);
  return {
    run: (sql, ...args) => db.prepare(sql).run(...args) as any,
    all: (sql, ...args) => db.prepare(sql).all(...args) as any[],
    get: (sql, ...args) => db.prepare(sql).get(...args) as any,
    exec: (sql) => db.exec(sql),
  };
}

async function pgDb(): Promise<DB> {
  const pg = (await import('postgres')).default;
  const sql = pg(process.env.DATABASE_URL!);
  return {
    run: () => { throw new Error('use pgRun'); },
    all: () => { throw new Error('use pgAll'); },
    get: () => { throw new Error('use pgGet'); },
    exec: () => {},
    // @ts-ignore — we'll use async versions below
    _sql: sql,
  };
}

const db = usePg ? null : sqliteDb();

if (!usePg && db) {
  const products = db.all('SELECT id, url, site, current_price, list_price, currency, in_stock, last_engine, last_checked_at, created_at FROM products');
  let offerCount = 0;
  let snapCount = 0;

  for (const p of products) {
    const key = `${p.site}::${p.url}`;
    const existing = db.get('SELECT id FROM offers WHERE canonical_offer_key = ?', key);
    let offerId: number;
    if (existing) {
      offerId = existing.id as number;
    } else {
      const t = (p.created_at as number) || Math.floor(Date.now() / 1000);
      const res = db.run(
        `INSERT INTO offers (product_id, marketplace, url, canonical_offer_key, first_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        p.id, p.site, p.url, key, t, t
      );
      offerId = Number(res.lastInsertRowid);
      offerCount++;
    }

    // price_history → offer_snapshots
    const history = db.all(
      'SELECT price, list_price, in_stock, checked_at FROM price_history WHERE product_id = ? ORDER BY checked_at ASC',
      p.id
    );
    for (const h of history) {
      const existingSnap = db.get(
        'SELECT 1 FROM offer_snapshots WHERE offer_id = ? AND checked_at = ?',
        offerId, h.checked_at
      );
      if (existingSnap) continue;

      const stockMap: Record<number, string> = { 1: 'in_stock', 0: 'out_of_stock' };
      const stockStatus = h.in_stock == null ? 'unknown' : (stockMap[h.in_stock as number] ?? 'unknown');
      db.run(
        `INSERT INTO offer_snapshots (offer_id, price, list_price, currency, stock_status, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        offerId, h.price, h.list_price ?? null, (p.currency as string) || 'TRY', stockStatus, h.checked_at
      );
      snapCount++;
    }
  }

  console.log(`Backfill tamamlandı: ${offerCount} offer, ${snapCount} snapshot oluşturuldu.`);
} else {
  console.log('Postgres backfill için: DATABASE_URL=... npx tsx scripts/backfill-pg.ts sonrası bu scripti --pg ile çalıştır.');
  console.log('(Postgres desteği henüz eklenmedi, SQLite kullan.)');
}
