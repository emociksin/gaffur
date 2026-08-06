import type { TrendCatalogItem, TrendCatalogStatus } from '../../shared/types';
import type { Env } from '../env';
import { now } from '../db';
import {
  TREND_CAPTURED_AT,
  TREND_CATALOG_SEEDS,
  TREND_CATEGORY,
  TREND_SCOPE,
  TREND_TIMEFRAME,
} from './trend-seeds';

export const TREND_METHODOLOGY =
  'Ürün odaklı kategori sinyallerinden seçilmiş kaynaklı talep kataloğu; gruplar arasında mutlak sıralama değildir.';
export const TREND_DISCLAIMER =
  '0–100 değerleri yalnız aynı kaynak terimi içindeki göreli ilgidir; mutlak arama hacmi veya satış adedi değildir.';

export async function ensureTrendCatalogSeeds(env: Env): Promise<{ seeded: number; capturedAt: number }> {
  await env.DB.batch(TREND_CATALOG_SEEDS.map((item) => env.DB.prepare(
    `INSERT INTO trend_catalog_items
     (query, normalized_query, catalog_kind, anchor_term, anchor_rank, anchor_interest,
      signal_type, signal_rank, interest_value, growth_label, geo, timeframe,
      category_label, source_url, query_url, status, captured_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TR', ?, ?, ?, ?, 'published', ?, ?)
     ON CONFLICT(anchor_term, query, signal_type) DO UPDATE SET
       normalized_query = excluded.normalized_query,
       catalog_kind = excluded.catalog_kind,
       anchor_rank = excluded.anchor_rank,
       anchor_interest = excluded.anchor_interest,
       signal_rank = excluded.signal_rank,
       interest_value = excluded.interest_value,
       growth_label = excluded.growth_label,
       geo = excluded.geo,
       timeframe = excluded.timeframe,
       category_label = excluded.category_label,
       source_url = excluded.source_url,
       query_url = excluded.query_url,
       captured_at = excluded.captured_at`
  ).bind(
    item.query,
    item.normalizedQuery,
    item.kind,
    item.anchor,
    item.anchorRank,
    item.anchorInterest,
    item.type,
    item.rank,
    item.interest ?? null,
    item.growth ?? null,
    TREND_TIMEFRAME,
    TREND_CATEGORY,
    item.sourceUrl,
    item.queryUrl,
    TREND_CAPTURED_AT,
    TREND_CAPTURED_AT
  )));
  return { seeded: TREND_CATALOG_SEEDS.length, capturedAt: TREND_CAPTURED_AT };
}

export async function listTrendCatalog(env: Env, publishedOnly: boolean): Promise<TrendCatalogItem[]> {
  const where = publishedOnly ? "WHERE t.status = 'published'" : '';
  const rows = await env.DB.prepare(
    `SELECT t.*, p.title AS matched_product_title
     FROM trend_catalog_items t
     LEFT JOIN products p ON p.id = t.matched_product_id
     ${where}
     ORDER BY
       CASE t.anchor_term
         WHEN 'apple' THEN 1 WHEN 'bilgisayar' THEN 2 WHEN 'tablet' THEN 3
         WHEN 'asus' THEN 4 WHEN 'laptop' THEN 5 ELSE 6
       END,
       CASE t.signal_type WHEN 'top' THEN 1 ELSE 2 END,
       t.signal_rank ASC, t.query ASC`
  ).all<TrendCatalogItem>();
  return rows.results ?? [];
}

export async function updateTrendCatalogItem(
  env: Env,
  id: number,
  input: { status?: TrendCatalogStatus; matchedProductId?: number | null },
  t = now()
): Promise<TrendCatalogItem> {
  const current = await env.DB.prepare(
    'SELECT status, matched_product_id FROM trend_catalog_items WHERE id = ?'
  ).bind(id).first<{ status: TrendCatalogStatus; matched_product_id: number | null }>();
  if (!current) throw new Error('Trend katalog kaydı bulunamadı');

  const status = input.status ?? current.status;
  const matchedProductId = input.matchedProductId === undefined
    ? current.matched_product_id
    : input.matchedProductId;
  if (matchedProductId != null) {
    const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?')
      .bind(matchedProductId).first<{ id: number }>();
    if (!product) throw new Error('Eşleştirilecek ürün bulunamadı');
  }

  await env.DB.prepare(
    'UPDATE trend_catalog_items SET status = ?, matched_product_id = ?, updated_at = ? WHERE id = ?'
  ).bind(status, matchedProductId, t, id).run();

  const row = await env.DB.prepare(
    `SELECT t.*, p.title AS matched_product_title
     FROM trend_catalog_items t LEFT JOIN products p ON p.id = t.matched_product_id
     WHERE t.id = ?`
  ).bind(id).first<TrendCatalogItem>();
  if (!row) throw new Error('Trend katalog kaydı bulunamadı');
  return row;
}

export function trendCatalogMeta(total: number) {
  return {
    source: 'Google Trends' as const,
    scope: TREND_SCOPE,
    capturedAt: TREND_CAPTURED_AT,
    total,
    methodology: TREND_METHODOLOGY,
    disclaimer: TREND_DISCLAIMER,
  };
}
