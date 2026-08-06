import type { PriceBaseline } from '../../shared/types';
import type { Env } from '../env';

const DAY = 24 * 3600;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface CalculatedBaseline extends PriceBaseline {
  sample_count_all: number;
}

export async function calculatePriceBaseline(env: Env, productId: number, t: number): Promise<CalculatedBaseline> {
  const rows = await env.DB.prepare(
    `SELECT price, checked_at FROM price_history
     WHERE product_id = ? AND in_stock != 0
     ORDER BY checked_at ASC`
  ).bind(productId).all<{ price: number; checked_at: number }>();
  const all = rows.results ?? [];
  const valuesSince = (days: number) => all.filter((r) => r.checked_at >= t - days * DAY).map((r) => r.price);
  const d10 = valuesSince(10);
  const d30 = valuesSince(30);
  const d90 = valuesSince(90);
  const allValues = all.map((r) => r.price);
  return {
    product_id: productId,
    median_10d: median(d10),
    low_10d: d10.length ? Math.min(...d10) : null,
    median_30d: median(d30),
    median_90d: median(d90),
    all_time_low: allValues.length ? Math.min(...allValues) : null,
    sample_count_10d: d10.length,
    sample_count_30d: d30.length,
    sample_count_90d: d90.length,
    sample_count_all: allValues.length,
    calculated_at: t,
  };
}

export async function savePriceBaseline(env: Env, baseline: CalculatedBaseline): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO price_baselines
     (product_id, median_10d, low_10d, median_30d, median_90d, all_time_low,
      sample_count_10d, sample_count_30d, sample_count_90d, sample_count_all, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       median_10d = excluded.median_10d,
       low_10d = excluded.low_10d,
       median_30d = excluded.median_30d,
       median_90d = excluded.median_90d,
       all_time_low = excluded.all_time_low,
       sample_count_10d = excluded.sample_count_10d,
       sample_count_30d = excluded.sample_count_30d,
       sample_count_90d = excluded.sample_count_90d,
       sample_count_all = excluded.sample_count_all,
       calculated_at = excluded.calculated_at`
  ).bind(
    baseline.product_id,
    baseline.median_10d,
    baseline.low_10d,
    baseline.median_30d,
    baseline.median_90d,
    baseline.all_time_low,
    baseline.sample_count_10d,
    baseline.sample_count_30d,
    baseline.sample_count_90d,
    baseline.sample_count_all,
    baseline.calculated_at
  ).run();
}
