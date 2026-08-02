// Zamanlanmis kontrol dongusu — her 15 dakikada tetiklenir.
// Urun bazinda interval_min'e gore sirasi gelenler kontrol edilir.
// Subrequest limitine takilmamak icin parti boyutu kucuk tutulur (ucretsiz plan: 50 istek/calisma).
import type { Env } from './env';
import { dueProducts, getSettings, now } from './db';
import { checkProduct, refreshListing } from './scrape/engine';

const PRODUCT_BATCH = 10;
const LISTING_BATCH = 2;
const LISTING_REFRESH_SEC = 6 * 3600;

export interface CronReport {
  products: number;
  changed: number;
  failed: number;
  listings: number;
}

export async function runScheduled(env: Env): Promise<CronReport> {
  const t = now();
  const settings = await getSettings(env);
  const report: CronReport = { products: 0, changed: 0, failed: 0, listings: 0 };

  // 1) Otomatik kategori kesifleri (6 saatte bir)
  const cats = await env.DB.prepare(
    `SELECT id, name, source_url FROM categories
     WHERE auto_track = 1 AND source_url IS NOT NULL
       AND (last_discovered_at IS NULL OR last_discovered_at + ? <= ?)
     ORDER BY COALESCE(last_discovered_at, 0) ASC LIMIT ?`
  )
    .bind(LISTING_REFRESH_SEC, t, LISTING_BATCH)
    .all<{ id: number; name: string; source_url: string }>();

  for (const c of cats.results ?? []) {
    try {
      await refreshListing(env, c, settings);
      report.listings++;
    } catch {
      /* liste hatasi tekil urun kontrolunu engellemesin */
    }
  }

  // 2) Sirasi gelen urunler
  const due = await dueProducts(env, PRODUCT_BATCH, t);
  for (let i = 0; i < due.length; i++) {
    try {
      const r = await checkProduct(env, due[i], settings);
      report.products++;
      if (r.ok && r.changed) report.changed++;
      if (!r.ok) report.failed++;
    } catch {
      report.failed++;
    }
    if (i < due.length - 1) await new Promise((r) => setTimeout(r, 400)); // nazik aralik
  }

  return report;
}
