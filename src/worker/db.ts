import type { Env } from './env';
import type { AppSettings, Product } from '../shared/types';

export const now = () => Math.floor(Date.now() / 1000);

export const SETTINGS_DEFAULTS: AppSettings = {
  telegram_token: '',
  telegram_chat: '',
  firecrawl_key: '',
  default_interval: '60',
  notify_stock: '1',
  notify_rise: '0',
};

export async function getSettings(env: Env): Promise<AppSettings> {
  const rows = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: AppSettings = { ...SETTINGS_DEFAULTS };
  for (const r of rows.results ?? []) {
    if (r.key in out) (out as any)[r.key] = r.value ?? '';
  }
  return out;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
    .bind(key, value)
    .run();
}

export async function getProduct(env: Env, id: number): Promise<Product | null> {
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Product>();
  return row ?? null;
}

export async function dueProducts(env: Env, limit: number, t: number): Promise<Product[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM products
     WHERE active = 1 AND (last_checked_at IS NULL OR last_checked_at + interval_min * 60 <= ?)
     ORDER BY COALESCE(last_checked_at, 0) ASC
     LIMIT ?`
  )
    .bind(t, limit)
    .all<Product>();
  return rows.results ?? [];
}

export interface NotifInput {
  user_id?: number | null;
  watch_id?: number | null;
  product_id?: number | null;
  kind: string;
  title: string;
  body?: string | null;
  old_price?: number | null;
  new_price?: number | null;
  sent_telegram?: boolean;
}

// ---- offers (Faz 2: dual-write — product yazıldığında offer da yazılır) ----

export async function ensureOffer(
  env: Env,
  product: { id: number; url: string; site: string },
  t: number
): Promise<number> {
  const key = `${product.site}::${product.url}`;
  const existing = await env.DB.prepare(
    'SELECT id FROM offers WHERE canonical_offer_key = ?'
  ).bind(key).first<{ id: number }>();
  if (existing) return existing.id;

  const res = await env.DB.prepare(
    `INSERT INTO offers (product_id, marketplace, url, canonical_offer_key, first_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(product.id, product.site, product.url, key, t, t).run();
  return res.meta.last_row_id as number;
}

export async function writeOfferSnapshot(
  env: Env,
  offerId: number,
  data: { price: number; listPrice?: number | null; currency?: string; stockStatus?: string; engine?: string },
  t: number
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO offer_snapshots (offer_id, price, list_price, currency, stock_status, engine, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    offerId,
    data.price,
    data.listPrice ?? null,
    data.currency ?? 'TRY',
    data.stockStatus ?? 'unknown',
    data.engine ?? null,
    t
  ).run();
}

export async function insertNotification(env: Env, n: NotifInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, watch_id, product_id, kind, title, body, old_price, new_price, sent_telegram, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      n.user_id ?? null,
      n.watch_id ?? null,
      n.product_id ?? null,
      n.kind,
      n.title,
      n.body ?? null,
      n.old_price ?? null,
      n.new_price ?? null,
      n.sent_telegram ? 1 : 0,
      now()
    )
    .run();
}
