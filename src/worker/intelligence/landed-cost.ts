import type { Env } from '../env';

export type LandedScenario = 'domestic' | 'postal' | 'passenger';
export type OriginRegion = 'domestic' | 'eu' | 'other';
export type ProductKind = 'general' | 'book' | 'health' | 'phone';

export interface LandedCostInput {
  scenario: LandedScenario;
  originRegion: OriginRegion;
  productKind: ProductKind;
  itemPrice: number;
  shippingCost?: number;
  currency: string;
  fxRateTry: number;
  eurTryRate: number;
  weightKg?: number | null;
  freightDocumented?: boolean;
  nonCommercial?: boolean;
  hasPrescription?: boolean;
  isOtvList4?: boolean;
  passengerAge?: number;
}

export interface TaxRule {
  rule_code: string;
  customs_rate: number | null;
  additional_rate: number;
  exemption_eur: number;
  max_value_eur: number | null;
  max_weight_kg: number | null;
  requires_detailed_declaration: number;
  prohibited: number;
  source_title: string;
  source_url: string;
  effective_from: number;
  verified_at: number;
}

export interface LandedCostResult {
  status: 'calculated' | 'requires_detailed_declaration' | 'not_eligible' | 'prohibited';
  rule: TaxRule;
  itemTry: number;
  shippingTry: number;
  assumedFreightTry: number;
  taxableTry: number;
  taxTry: number | null;
  knownSubtotalTry: number;
  totalTry: number | null;
  effectiveRate: number | null;
  warnings: string[];
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function normalizeKind(input: LandedCostInput): ProductKind {
  if (input.scenario !== 'postal') return 'general';
  return input.productKind;
}

export async function findTaxRule(env: Env, input: LandedCostInput, t: number): Promise<TaxRule> {
  const productKind = normalizeKind(input);
  const row = await env.DB.prepare(
    `SELECT rule_code, customs_rate, additional_rate, exemption_eur, max_value_eur, max_weight_kg,
            requires_detailed_declaration, prohibited, source_title, source_url, effective_from, verified_at
     FROM tax_rules
     WHERE scenario = ?
       AND product_kind = ?
       AND origin_region IN (?, 'any')
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to > ?)
     ORDER BY CASE WHEN origin_region = ? THEN 0 ELSE 1 END, effective_from DESC
     LIMIT 1`
  ).bind(input.scenario, productKind, input.originRegion, t, t, input.originRegion).first<TaxRule>();
  if (!row) throw new Error('Bu senaryo için yürürlükte ve doğrulanmış vergi kuralı bulunamadı');
  return row;
}

export function validateLandedCostInput(input: LandedCostInput): void {
  if (!['domestic', 'postal', 'passenger'].includes(input.scenario)) throw new Error('Geçersiz teslim senaryosu');
  if (!['domestic', 'eu', 'other'].includes(input.originRegion)) throw new Error('Geçersiz çıkış bölgesi');
  if (!['general', 'book', 'health', 'phone'].includes(input.productKind)) throw new Error('Geçersiz ürün türü');
  for (const [name, value] of [
    ['ürün fiyatı', input.itemPrice],
    ['kargo', input.shippingCost ?? 0],
    ['kur', input.fxRateTry],
    ['Avro kuru', input.eurTryRate],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || (name.includes('kur') && value <= 0)) throw new Error(`Geçersiz ${name}`);
  }
  if (input.weightKg != null && (!Number.isFinite(input.weightKg) || input.weightKg < 0)) throw new Error('Geçersiz ağırlık');
}

export async function calculateLandedCost(
  env: Env,
  input: LandedCostInput,
  t: number
): Promise<LandedCostResult> {
  validateLandedCostInput(input);
  const rule = await findTaxRule(env, input, t);
  const itemTry = roundMoney(input.itemPrice * input.fxRateTry);
  const shippingTry = roundMoney((input.shippingCost ?? 0) * input.fxRateTry);
  const assumedFreightTry = input.scenario === 'postal' && input.freightDocumented === false
    ? roundMoney(3 * input.eurTryRate)
    : 0;
  const taxableTry = input.scenario === 'passenger'
    ? itemTry
    : input.scenario === 'postal' && input.freightDocumented === false
      ? roundMoney(itemTry + assumedFreightTry)
      : roundMoney(itemTry + shippingTry);
  const valueEur = taxableTry / input.eurTryRate;
  const knownSubtotalTry = roundMoney(itemTry + shippingTry);
  const warnings: string[] = [];

  if (assumedFreightTry > 0) warnings.push('Navlun belgede ayrı gösterilmediği için mevzuattaki 3 Avro emsal navlun eklendi.');
  if (rule.prohibited) {
    return { status: 'prohibited', rule, itemTry, shippingTry, assumedFreightTry, taxableTry, taxTry: null, knownSubtotalTry, totalTry: null, effectiveRate: null, warnings: ['Bu ürün posta veya hızlı kargo yoluyla teslim edilemez.'] };
  }
  if (input.nonCommercial === false) {
    return { status: 'not_eligible', rule, itemTry, shippingTry, assumedFreightTry, taxableTry, taxTry: null, knownSubtotalTry, totalTry: null, effectiveRate: null, warnings: ['Tek ve maktu vergi yalnız ticari miktar ve mahiyet taşımayan gönderiler içindir.'] };
  }
  if (rule.max_value_eur != null && valueEur > rule.max_value_eur) {
    return { status: 'not_eligible', rule, itemTry, shippingTry, assumedFreightTry, taxableTry, taxTry: null, knownSubtotalTry, totalTry: null, effectiveRate: null, warnings: [`Toplam gümrük kıymeti ${rule.max_value_eur} Avro sınırını aşıyor.`] };
  }
  if (rule.max_weight_kg != null && input.weightKg != null && input.weightKg > rule.max_weight_kg) {
    return { status: 'not_eligible', rule, itemTry, shippingTry, assumedFreightTry, taxableTry, taxTry: null, knownSubtotalTry, totalTry: null, effectiveRate: null, warnings: [`Brüt ağırlık ${rule.max_weight_kg} kg sınırını aşıyor.`] };
  }
  if (input.productKind === 'health' && input.scenario === 'postal' && input.hasPrescription !== true) {
    return { status: 'not_eligible', rule, itemTry, shippingTry, assumedFreightTry, taxableTry, taxTry: null, knownSubtotalTry, totalTry: null, effectiveRate: null, warnings: ['İlaç/takviye senaryosu sağlık kuruluşu raporu veya doktor reçetesi gerektirir.'] };
  }
  if (rule.requires_detailed_declaration) {
    warnings.push('Genel posta/hızlı kargo ürünlerinde vergi GTİP ve diğer ithalat yükümlülüklerine göre belirlenir; kesin toplam hesaplanamaz.');
    return { status: 'requires_detailed_declaration', rule, itemTry, shippingTry, assumedFreightTry, taxableTry, taxTry: null, knownSubtotalTry, totalTry: null, effectiveRate: null, warnings };
  }

  let exemptionTry = rule.exemption_eur * input.eurTryRate;
  if (input.scenario === 'passenger' && (input.passengerAge ?? 18) < 15) exemptionTry = 150 * input.eurTryRate;
  const taxableAfterExemption = Math.max(0, taxableTry - exemptionTry);
  const effectiveRate = (rule.customs_rate ?? 0) + (input.isOtvList4 ? rule.additional_rate : 0);
  const taxTry = roundMoney(taxableAfterExemption * effectiveRate);
  const totalTry = roundMoney(knownSubtotalTry + taxTry);
  if (input.isOtvList4 && rule.additional_rate > 0) warnings.push(`ÖTV (IV) listesi seçildiği için ilave %${rule.additional_rate * 100} oran uygulandı.`);
  if (input.scenario === 'passenger') warnings.push('Yolcu muafiyeti posta siparişine uygulanmaz; eşyanın yolcu beraberinde gelmesi gerekir.');
  return { status: 'calculated', rule, itemTry, shippingTry, assumedFreightTry, taxableTry, taxTry, knownSubtotalTry, totalTry, effectiveRate, warnings };
}
