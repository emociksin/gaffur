import type { Env } from '../env';

const DAY_S = 86_400;
const ISTANBUL_OFFSET_S = 3 * 3600;

export interface OpportunityRefreshResult {
  refreshed: boolean;
  count: number;
  calculatedAt: number;
}

export function istanbulDayStart(t: number): number {
  return Math.floor((t + ISTANBUL_OFFSET_S) / DAY_S) * DAY_S - ISTANBUL_OFFSET_S;
}

/**
 * Firsat akisi istek aninda hesaplanmaz. Bu tablo gunde bir kez cron tarafindan yenilenir.
 * Referans, Faz 4'te uretilen 30 gunluk medyandir; tum zamanlarin en dusuk fiyatina esitlik
 * ayri bir kanit olarak skora eklenir. Stok disi urunler kesinlikle akisa alinmaz.
 */
export async function refreshOpportunityFeed(env: Env, t: number): Promise<OpportunityRefreshResult> {
  const rows = await env.DB.prepare(
    `SELECT p.id AS product_id, p.current_price, p.stock_status,
            b.median_30d, b.all_time_low
     FROM products p
     JOIN price_baselines b ON b.product_id = p.id
     WHERE p.active = 1
       AND p.current_price IS NOT NULL
       AND p.stock_status != 'out_of_stock'
       AND b.median_30d IS NOT NULL
       AND b.median_30d > 0`
  ).all<{
    product_id: number;
    current_price: number;
    stock_status: string;
    median_30d: number;
    all_time_low: number | null;
  }>();

  let count = 0;
  for (const row of rows.results ?? []) {
    const dropPct = ((row.median_30d - row.current_price) / row.median_30d) * 100;
    const atAllTimeLow = row.all_time_low != null && row.current_price <= row.all_time_low + 0.01;
    if (dropPct < 2 && !atAllTimeLow) continue;
    const score = Math.max(0, dropPct) + (atAllTimeLow ? 12 : 0);
    await env.DB.prepare(
      `INSERT INTO opportunity_feed
       (product_id, current_price, reference_price, reference_kind, drop_pct,
        at_all_time_low, stock_status, score, calculated_at)
       VALUES (?, ?, ?, 'median_30d', ?, ?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET
         current_price = excluded.current_price,
         reference_price = excluded.reference_price,
         reference_kind = excluded.reference_kind,
         drop_pct = excluded.drop_pct,
         at_all_time_low = excluded.at_all_time_low,
         stock_status = excluded.stock_status,
         score = excluded.score,
         calculated_at = excluded.calculated_at`
    ).bind(
      row.product_id,
      row.current_price,
      row.median_30d,
      Number(dropPct.toFixed(4)),
      atAllTimeLow ? 1 : 0,
      row.stock_status,
      Number(score.toFixed(4)),
      t
    ).run();
    count++;
  }

  // Once yeni snapshot yazilir; boylece yenileme sirasinda feed bos kalmaz.
  await env.DB.prepare('DELETE FROM opportunity_feed WHERE calculated_at != ?').bind(t).run();
  return { refreshed: true, count, calculatedAt: t };
}

export async function refreshOpportunityFeedIfDue(env: Env, t: number): Promise<OpportunityRefreshResult> {
  const row = await env.DB.prepare('SELECT MAX(calculated_at) AS last_at, COUNT(*) AS n FROM opportunity_feed')
    .first<{ last_at: number | null; n: number }>();
  if (row?.last_at != null && row.last_at >= istanbulDayStart(t)) {
    return { refreshed: false, count: Number(row.n ?? 0), calculatedAt: row.last_at };
  }
  return refreshOpportunityFeed(env, t);
}
