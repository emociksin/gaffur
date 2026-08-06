import type { Env } from '../env';
import { now, setSetting } from '../db';
import {
  diceSimilarity,
  normalizeGtin,
  normalizeIdentity,
  normalizeMpn,
  variantsConflict,
  type NormalizedIdentity,
} from './normalize';

export const MATCH_SCORE_VERSION = 'phase8-v1';
export const MIN_REVIEW_SAMPLE = 30;

interface MatchProduct {
  id: number;
  title: string;
  site: string;
  brand: string | null;
  gtin: string | null;
  mpn: string | null;
  current_price: number | null;
  currency: string;
  category_id: number | null;
  active: number;
}

export interface ScoredPair {
  eligible: boolean;
  score: number;
  band: 'high' | 'medium' | 'low';
  exactCodeKind: 'gtin' | 'mpn' | null;
  titleScore: number;
  modelScore: number;
  priceScore: number;
  reasons: string[];
  aIdentity: NormalizedIdentity;
  bIdentity: NormalizedIdentity;
}

function priceSimilarity(a: number | null, b: number | null, aCurrency: string, bCurrency: string): number {
  if (a == null || b == null || a <= 0 || b <= 0 || aCurrency !== bCurrency) return 0.45;
  const ratio = Math.max(a, b) / Math.min(a, b);
  if (ratio <= 1.15) return 1;
  if (ratio <= 1.35) return 0.75;
  if (ratio <= 1.75) return 0.35;
  return 0;
}

function bandFor(score: number): ScoredPair['band'] {
  if (score >= 92) return 'high';
  if (score >= 80) return 'medium';
  return 'low';
}

export function scoreProductPair(a: MatchProduct, b: MatchProduct): ScoredPair {
  const aIdentity = normalizeIdentity(a);
  const bIdentity = normalizeIdentity(b);
  const aGtin = normalizeGtin(a.gtin);
  const bGtin = normalizeGtin(b.gtin);
  const aMpn = normalizeMpn(a.mpn);
  const bMpn = normalizeMpn(b.mpn);
  const reasons: string[] = [];
  const titleScore = diceSimilarity(aIdentity.tokens, bIdentity.tokens);
  const modelScore = diceSimilarity(aIdentity.modelTokens, bIdentity.modelTokens);
  const priceScore = priceSimilarity(a.current_price, b.current_price, a.currency, b.currency);
  const brandConflict = Boolean(
    aIdentity.normalizedBrand && bIdentity.normalizedBrand &&
    aIdentity.normalizedBrand !== bIdentity.normalizedBrand
  );
  const variantConflict = variantsConflict(aIdentity, bIdentity);

  if (brandConflict) reasons.push('Markalar farklı');
  if (variantConflict) reasons.push(`Varyant çakışması: ${variantConflict === 'capacity' ? 'kapasite' : 'renk'}`);
  if (brandConflict || variantConflict) {
    return { eligible: false, score: 0, band: 'low', exactCodeKind: null, titleScore, modelScore, priceScore, reasons, aIdentity, bIdentity };
  }

  let score = 0;
  let exactCodeKind: ScoredPair['exactCodeKind'] = null;
  if (aGtin.valid && bGtin.valid && aGtin.value === bGtin.value) {
    score = 99;
    exactCodeKind = 'gtin';
    reasons.push('GS1 kontrol basamağı geçerli GTIN eşleşmesi');
  } else if (
    aMpn.reliable && bMpn.reliable && aMpn.value === bMpn.value &&
    aIdentity.normalizedBrand && aIdentity.normalizedBrand === bIdentity.normalizedBrand
  ) {
    score = 96;
    exactCodeKind = 'mpn';
    reasons.push('Aynı marka içinde güvenilir MPN eşleşmesi');
  } else {
    const brandScore = aIdentity.normalizedBrand && bIdentity.normalizedBrand ? 20 : 8;
    score = brandScore + modelScore * 45 + titleScore * 20 + priceScore * 10;
    if (a.category_id != null && a.category_id === b.category_id) score += 5;
    reasons.push(`Başlık benzerliği %${Math.round(titleScore * 100)}`);
    reasons.push(`Model benzerliği %${Math.round(modelScore * 100)}`);
    reasons.push(`Fiyat tutarlılığı %${Math.round(priceScore * 100)}`);
  }

  score = Math.round(Math.min(100, score) * 10) / 10;
  const eligible = exactCodeKind != null || (score >= 65 && modelScore >= 0.55 && titleScore >= 0.5);
  if (!eligible) reasons.push('İnsan kuyruğu eşiğinin altında');
  return { eligible, score, band: bandFor(score), exactCodeKind, titleScore, modelScore, priceScore, reasons, aIdentity, bIdentity };
}

function identityQuality(product: MatchProduct, identity: NormalizedIdentity): number {
  const gtin = normalizeGtin(product.gtin);
  const mpn = normalizeMpn(product.mpn);
  return Math.min(100,
    (gtin.valid ? 45 : 0) +
    (mpn.reliable ? 25 : 0) +
    (identity.normalizedBrand ? 15 : 0) +
    (identity.modelTokens.length ? 15 : 0)
  );
}

async function saveIdentity(env: Env, product: MatchProduct, t: number): Promise<void> {
  const identity = normalizeIdentity(product);
  const gtin = normalizeGtin(product.gtin);
  const mpn = normalizeMpn(product.mpn);
  await env.DB.prepare(
    `INSERT INTO product_identities
     (product_id, normalized_title, normalized_brand, model_key, variant_key, gtin_normalized,
      gtin_valid, mpn_normalized, mpn_reliable, identity_quality, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       normalized_title = excluded.normalized_title,
       normalized_brand = excluded.normalized_brand,
       model_key = excluded.model_key,
       variant_key = excluded.variant_key,
       gtin_normalized = excluded.gtin_normalized,
       gtin_valid = excluded.gtin_valid,
       mpn_normalized = excluded.mpn_normalized,
       mpn_reliable = excluded.mpn_reliable,
       identity_quality = excluded.identity_quality,
       updated_at = excluded.updated_at`
  ).bind(
    product.id, identity.normalizedTitle, identity.normalizedBrand, identity.modelKey,
    identity.variantKey, gtin.value, gtin.valid ? 1 : 0, mpn.value,
    mpn.reliable ? 1 : 0, identityQuality(product, identity), t
  ).run();
}

export async function refreshCatalogMatches(env: Env, t = now()): Promise<{ products: number; candidates: number; calculatedAt: number }> {
  const rows = await env.DB.prepare(
    `SELECT id, title, site, brand, gtin, mpn, current_price, currency, category_id, active
     FROM products WHERE active = 1 ORDER BY id ASC`
  ).all<MatchProduct>();
  const products = rows.results ?? [];
  for (const product of products) await saveIdentity(env, product, t);

  await env.DB.prepare(
    `UPDATE product_match_candidates SET status = 'stale', updated_at = ? WHERE status = 'pending'`
  ).bind(t).run();

  let candidates = 0;
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const scored = scoreProductPair(products[i], products[j]);
      if (!scored.eligible) continue;
      candidates++;
      await env.DB.prepare(
        `INSERT INTO product_match_candidates
         (product_a_id, product_b_id, score, score_band, score_version, exact_code_kind,
          title_score, model_score, price_score, reasons_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(product_a_id, product_b_id) DO UPDATE SET
           score = excluded.score,
           score_band = excluded.score_band,
           score_version = excluded.score_version,
           exact_code_kind = excluded.exact_code_kind,
           title_score = excluded.title_score,
           model_score = excluded.model_score,
           price_score = excluded.price_score,
           reasons_json = excluded.reasons_json,
           status = CASE WHEN product_match_candidates.status IN ('pending', 'stale') THEN 'pending' ELSE product_match_candidates.status END,
           updated_at = excluded.updated_at`
      ).bind(
        products[i].id, products[j].id, scored.score, scored.band, MATCH_SCORE_VERSION,
        scored.exactCodeKind, scored.titleScore, scored.modelScore, scored.priceScore,
        JSON.stringify(scored.reasons), t, t
      ).run();
    }
  }
  await setSetting(env, 'catalog_match_refresh_at', String(t));
  return { products: products.length, candidates, calculatedAt: t };
}

export async function refreshCatalogMatchesIfDue(env: Env, t = now()): Promise<{ products: number; candidates: number; calculatedAt: number }> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'catalog_match_refresh_at'").first<{ value: string }>();
  const last = Number(row?.value ?? 0);
  if (last > 0 && t - last < 24 * 3600) return { products: 0, candidates: 0, calculatedAt: last };
  return refreshCatalogMatches(env, t);
}

export interface CatalogMetrics {
  totalProducts: number;
  eligibleProducts: number;
  matchedProducts: number;
  matchRate: number;
  pendingCandidates: number;
  reviewedCandidates: number;
  approvedCandidates: number;
  rejectedCandidates: number;
  reviewedPrecision: number | null;
  precisionSampleReady: boolean;
  precisionTargetMet: boolean | null;
  precisionTarget: number;
  minimumReviewSample: number;
}

export async function getCatalogMetrics(env: Env): Promise<CatalogMetrics> {
  const [products, matched, candidates] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN identity_quality >= 30 THEN 1 ELSE 0 END) AS eligible
       FROM product_identities`
    ).first<{ total: number; eligible: number | null }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM catalog_memberships').first<{ n: number }>(),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM product_match_candidates`
    ).first<{ pending: number | null; approved: number | null; rejected: number | null }>(),
  ]);
  const total = Number(products?.total ?? 0);
  const eligible = Number(products?.eligible ?? 0);
  const matchedCount = Number(matched?.n ?? 0);
  const approved = Number(candidates?.approved ?? 0);
  const rejected = Number(candidates?.rejected ?? 0);
  const reviewed = approved + rejected;
  const precision = reviewed ? Math.round((approved / reviewed) * 1000) / 10 : null;
  const sampleReady = reviewed >= MIN_REVIEW_SAMPLE;
  return {
    totalProducts: total,
    eligibleProducts: eligible,
    matchedProducts: matchedCount,
    matchRate: eligible ? Math.round((matchedCount / eligible) * 1000) / 10 : 0,
    pendingCandidates: Number(candidates?.pending ?? 0),
    reviewedCandidates: reviewed,
    approvedCandidates: approved,
    rejectedCandidates: rejected,
    reviewedPrecision: precision,
    precisionSampleReady: sampleReady,
    precisionTargetMet: sampleReady && precision != null ? precision >= 98 : null,
    precisionTarget: 98,
    minimumReviewSample: MIN_REVIEW_SAMPLE,
  };
}

interface CandidateForReview {
  id: number;
  product_a_id: number;
  product_b_id: number;
  score: number;
  status: string;
}

async function membership(env: Env, productId: number): Promise<{ catalog_product_id: number } | null> {
  return env.DB.prepare('SELECT catalog_product_id FROM catalog_memberships WHERE product_id = ?')
    .bind(productId).first<{ catalog_product_id: number }>();
}

async function createCatalogProduct(env: Env, representativeId: number, candidateId: number, confidence: number, t: number): Promise<number> {
  const product = await env.DB.prepare(
    `SELECT p.title, p.brand, p.gtin, p.mpn, i.variant_key
     FROM products p LEFT JOIN product_identities i ON i.product_id = p.id WHERE p.id = ?`
  ).bind(representativeId).first<{ title: string; brand: string | null; gtin: string | null; mpn: string | null; variant_key: string | null }>();
  if (!product) throw new Error('Temsilci ürün bulunamadı');
  const result = await env.DB.prepare(
    `INSERT INTO catalog_products
     (representative_product_id, display_title, brand, gtin, mpn, variant_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(representativeId, product.title, product.brand, product.gtin, product.mpn, product.variant_key, t, t).run();
  const catalogId = Number(result.meta.last_row_id);
  await env.DB.prepare(
    `INSERT INTO catalog_memberships
     (product_id, catalog_product_id, match_candidate_id, confidence, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(representativeId, catalogId, candidateId, confidence, t).run();
  return catalogId;
}

async function addMembership(env: Env, productId: number, catalogId: number, candidateId: number, confidence: number, t: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_memberships
     (product_id, catalog_product_id, match_candidate_id, confidence, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       catalog_product_id = excluded.catalog_product_id,
       match_candidate_id = excluded.match_candidate_id,
       confidence = excluded.confidence`
  ).bind(productId, catalogId, candidateId, confidence, t).run();
}

async function syncCatalogRepresentative(env: Env, catalogId: number, representativeId: number, t: number): Promise<void> {
  const product = await env.DB.prepare(
    `SELECT p.title, p.brand, p.gtin, p.mpn, i.variant_key
     FROM products p LEFT JOIN product_identities i ON i.product_id = p.id WHERE p.id = ?`
  ).bind(representativeId).first<{ title: string; brand: string | null; gtin: string | null; mpn: string | null; variant_key: string | null }>();
  if (!product) throw new Error('Temsilci ürün bulunamadı');
  await env.DB.prepare(
    `UPDATE catalog_products
     SET representative_product_id = ?, display_title = ?, brand = ?, gtin = ?, mpn = ?, variant_key = ?, updated_at = ?
     WHERE id = ?`
  ).bind(representativeId, product.title, product.brand, product.gtin, product.mpn, product.variant_key, t, catalogId).run();
}

export async function reviewMatchCandidate(
  env: Env,
  candidateId: number,
  decision: 'approved' | 'rejected',
  options: { representativeProductId?: number | null; note?: string | null } = {},
  t = now()
): Promise<{ ok: true; catalogProductId: number | null }> {
  const candidate = await env.DB.prepare(
    `SELECT id, product_a_id, product_b_id, score, status FROM product_match_candidates WHERE id = ?`
  ).bind(candidateId).first<CandidateForReview>();
  if (!candidate) throw new Error('Eşleştirme adayı bulunamadı');
  if (candidate.status === 'approved' && decision === 'approved') {
    const existing = await membership(env, candidate.product_a_id);
    return { ok: true, catalogProductId: existing?.catalog_product_id ?? null };
  }
  if (!['pending', 'stale'].includes(candidate.status)) throw new Error('Bu aday daha önce incelendi');

  const note = String(options.note ?? '').trim().slice(0, 500) || null;
  if (decision === 'rejected') {
    await env.DB.prepare(
      `UPDATE product_match_candidates SET status = 'rejected', review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
    ).bind(note, t, t, candidate.id).run();
    return { ok: true, catalogProductId: null };
  }

  const allowedRepresentatives = [candidate.product_a_id, candidate.product_b_id];
  let representative = Number(options.representativeProductId ?? 0);
  if (!allowedRepresentatives.includes(representative)) {
    const qualities = await env.DB.prepare(
      `SELECT product_id, identity_quality FROM product_identities WHERE product_id IN (?, ?)
       ORDER BY identity_quality DESC, product_id ASC`
    ).bind(candidate.product_a_id, candidate.product_b_id).all<{ product_id: number; identity_quality: number }>();
    representative = qualities.results?.[0]?.product_id ?? candidate.product_a_id;
  }

  const [aMembership, bMembership] = await Promise.all([
    membership(env, candidate.product_a_id), membership(env, candidate.product_b_id),
  ]);
  let catalogId: number;
  if (!aMembership && !bMembership) {
    catalogId = await createCatalogProduct(env, representative, candidate.id, candidate.score, t);
  } else if (aMembership && bMembership && aMembership.catalog_product_id !== bMembership.catalog_product_id) {
    const representativeMembership = representative === candidate.product_a_id ? aMembership : bMembership;
    catalogId = representativeMembership.catalog_product_id;
    const losingId = catalogId === aMembership.catalog_product_id ? bMembership.catalog_product_id : aMembership.catalog_product_id;
    await env.DB.prepare('UPDATE catalog_memberships SET catalog_product_id = ? WHERE catalog_product_id = ?')
      .bind(catalogId, losingId).run();
    await env.DB.prepare('DELETE FROM catalog_products WHERE id = ?').bind(losingId).run();
  } else {
    catalogId = aMembership?.catalog_product_id ?? bMembership!.catalog_product_id;
  }

  await addMembership(env, candidate.product_a_id, catalogId, candidate.id, candidate.score, t);
  await addMembership(env, candidate.product_b_id, catalogId, candidate.id, candidate.score, t);
  await syncCatalogRepresentative(env, catalogId, representative, t);
  await env.DB.prepare(
    `UPDATE product_match_candidates SET status = 'approved', review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
  ).bind(note, t, t, candidate.id).run();
  return { ok: true, catalogProductId: catalogId };
}
