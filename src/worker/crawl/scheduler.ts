import type { Env } from '../env';
import { dueProducts } from '../db';
import { enqueueJob } from './queue';

const PRODUCT_BATCH = 10;
const LISTING_BATCH = 2;
const LISTING_REFRESH_SEC = 6 * 3600;

export interface ScheduleReport {
  products: number;
  listings: number;
}

export async function scheduleDueJobs(env: Env, t: number): Promise<ScheduleReport> {
  const report: ScheduleReport = { products: 0, listings: 0 };
  const cats = await env.DB.prepare(
    `SELECT id, source_url FROM categories
     WHERE auto_track = 1 AND source_url IS NOT NULL
       AND (last_discovered_at IS NULL OR last_discovered_at + ? <= ?)
     ORDER BY COALESCE(last_discovered_at, 0) ASC LIMIT ?`
  ).bind(LISTING_REFRESH_SEC, t, LISTING_BATCH).all<{ id: number; source_url: string }>();

  for (const category of cats.results ?? []) {
    if (await enqueueJob(env, {
      kind: 'listing', entityId: category.id, url: category.source_url, priority: 10, runAfter: t,
    }, t)) report.listings++;
  }

  for (const product of await dueProducts(env, PRODUCT_BATCH, t)) {
    if (await enqueueJob(env, {
      kind: 'product', entityId: product.id, url: product.url, priority: 0, runAfter: t,
    }, t)) report.products++;
  }
  return report;
}
