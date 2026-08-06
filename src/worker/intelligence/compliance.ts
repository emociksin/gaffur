import type { Env } from '../env';
import { istanbulDayStart } from './opportunities';

const DAY_S = 86_400;

export const COMPLIANCE_RULE = {
  sourceTitle: 'Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliğinde 2026 değişikliği',
  sourceUrl: 'https://www.ticaret.gov.tr/haberler/aldaticici-reklam-ve-haksiz-ticari-uygulamalarla-mucadelede-yeni-donem-basliyor',
  // 1 Agustos 2026 00:00 Europe/Istanbul = 31 Temmuz 2026 21:00 UTC
  effectiveAt: 1_785_531_600,
  lookbackDays: 10,
} as const;

export type ComplianceStatus = 'consistent' | 'suspicious' | 'insufficient_data';

export interface ComplianceRefreshResult {
  refreshed: boolean;
  count: number;
  calculatedAt: number;
}

/**
 * Bu arac yalnizca ic inceleme icindir. Kampanya baslangicini ve saticinin tum satis
 * kanallarini bilemedigimiz icin hicbir sonuc "hukuki ihlal" olarak adlandirilmaz.
 */
export async function refreshComplianceAssessments(env: Env, t: number): Promise<ComplianceRefreshResult> {
  const products = await env.DB.prepare(
    `SELECT id, current_price, list_price, last_change_at, last_checked_at
     FROM products
     WHERE active = 1 AND current_price IS NOT NULL`
  ).all<{
    id: number;
    current_price: number;
    list_price: number | null;
    last_change_at: number | null;
    last_checked_at: number | null;
  }>();

  let count = 0;
  for (const product of products.results ?? []) {
    const evidenceEnd = product.last_change_at ?? product.last_checked_at ?? t;
    const evidenceStart = evidenceEnd - COMPLIANCE_RULE.lookbackDays * DAY_S;
    const evidence = await env.DB.prepare(
      `SELECT price, checked_at
       FROM price_history
       WHERE product_id = ? AND checked_at >= ? AND checked_at < ?
         AND (in_stock IS NULL OR in_stock != 0)
       ORDER BY checked_at ASC`
    ).bind(product.id, evidenceStart, evidenceEnd).all<{ price: number; checked_at: number }>();
    const points = evidence.results ?? [];
    const low = points.length ? Math.min(...points.map((point) => point.price)) : null;
    const span = points.length > 1 ? points[points.length - 1].checked_at - points[0].checked_at : 0;

    let status: ComplianceStatus = 'insufficient_data';
    let reason = 'İndirim başlangıcından önceki dönemi doğrulayacak yeterli fiyat örneği yok.';
    const advertised = product.list_price;
    const looksDiscounted = advertised != null && advertised > product.current_price + 0.01;
    if (!looksDiscounted) {
      reason = 'Üründe doğrulanabilir bir üzeri çizili/liste referans fiyatı görülmedi.';
    } else if (low != null && points.length >= 2 && span >= DAY_S) {
      if (advertised! > low + 0.01) {
        status = 'suspicious';
        reason = 'Gösterilen referans fiyat, gözlenen önceki 10 günlük en düşük fiyattan yüksek.';
      } else {
        status = 'consistent';
        reason = 'Gösterilen referans fiyat, eldeki önceki 10 günlük fiyat kanıtıyla tutarlı.';
      }
    }

    await env.DB.prepare(
      `INSERT INTO compliance_assessments
       (product_id, status, advertised_reference, observed_price, low_10d_before,
        sample_count, evidence_start_at, evidence_end_at, reason, source_title,
        source_url, rule_effective_at, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET
         status = excluded.status,
         advertised_reference = excluded.advertised_reference,
         observed_price = excluded.observed_price,
         low_10d_before = excluded.low_10d_before,
         sample_count = excluded.sample_count,
         evidence_start_at = excluded.evidence_start_at,
         evidence_end_at = excluded.evidence_end_at,
         reason = excluded.reason,
         source_title = excluded.source_title,
         source_url = excluded.source_url,
         rule_effective_at = excluded.rule_effective_at,
         calculated_at = excluded.calculated_at`
    ).bind(
      product.id,
      status,
      advertised ?? null,
      product.current_price,
      low,
      points.length,
      evidenceStart,
      evidenceEnd,
      reason,
      COMPLIANCE_RULE.sourceTitle,
      COMPLIANCE_RULE.sourceUrl,
      COMPLIANCE_RULE.effectiveAt,
      t
    ).run();
    count++;
  }

  await env.DB.prepare('DELETE FROM compliance_assessments WHERE calculated_at != ?').bind(t).run();
  return { refreshed: true, count, calculatedAt: t };
}

export async function refreshComplianceIfDue(env: Env, t: number): Promise<ComplianceRefreshResult> {
  const row = await env.DB.prepare('SELECT MAX(calculated_at) AS last_at, COUNT(*) AS n FROM compliance_assessments')
    .first<{ last_at: number | null; n: number }>();
  if (row?.last_at != null && row.last_at >= istanbulDayStart(t)) {
    return { refreshed: false, count: Number(row.n ?? 0), calculatedAt: row.last_at };
  }
  return refreshComplianceAssessments(env, t);
}
