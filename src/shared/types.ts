// Worker ile web arasinda paylasilan tipler

export type AlertMode = 'drop' | 'target' | 'any' | 'off';
export type Engine = 'auto' | 'direct' | 'crawlee';
export type StockStatus = 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown';

export interface Category {
  id: number;
  name: string;
  color: string;
  source_url: string | null;
  site: string | null;
  auto_track: number;
  last_discovered_at: number | null;
  created_at: number;
  product_count?: number;
}

export interface Product {
  id: number;
  url: string;
  site: string;
  title: string;
  image: string | null;
  brand?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  sku?: string | null;
  currency: string;
  category_id: number | null;
  target_price: number | null;
  alert_mode: AlertMode;
  threshold_pct: number;
  interval_min: number;
  engine: Engine;
  active: number;
  current_price: number | null;
  previous_price: number | null;
  list_price: number | null;
  in_stock: number | null;
  stock_status: StockStatus;
  min_price: number | null;
  max_price: number | null;
  fail_count: number;
  last_error: string | null;
  last_engine: string | null;
  last_checked_at: number | null;
  last_change_at: number | null;
  created_at: number;
  spark?: { p: number; t: number }[];
}

export interface PriceBaseline {
  product_id: number;
  median_10d: number | null;
  low_10d: number | null;
  median_30d: number | null;
  median_90d: number | null;
  all_time_low: number | null;
  sample_count_10d: number;
  sample_count_30d: number;
  sample_count_90d: number;
  calculated_at: number;
}

export interface StockTransition {
  id: number;
  product_id: number;
  from_status: StockStatus;
  to_status: StockStatus;
  confirmed_at: number;
  observation_count: number;
}

export interface OfferSummary {
  id: number;
  marketplace: string;
  seller_name: string | null;
  url: string;
  origin_country: string | null;
  origin_region: 'domestic' | 'eu' | 'other';
  price: number | null;
  currency: string | null;
  shipping_cost: number | null;
  max_installments: number | null;
}

export interface LandedCostInput {
  scenario: 'domestic' | 'postal' | 'passenger';
  originRegion: 'domestic' | 'eu' | 'other';
  productKind: 'general' | 'book' | 'health' | 'phone';
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

export interface LandedCostResult {
  status: 'calculated' | 'requires_detailed_declaration' | 'not_eligible' | 'prohibited';
  rule: {
    rule_code: string;
    customs_rate: number | null;
    additional_rate: number;
    source_title: string;
    source_url: string;
    effective_from: number;
    verified_at: number;
  };
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

export interface HistoryPoint {
  price: number;
  list_price: number | null;
  in_stock: number | null;
  checked_at: number;
}

export interface Notification {
  id: number;
  user_id?: number | null;
  watch_id?: number | null;
  product_id: number | null;
  kind: 'drop' | 'rise' | 'target' | 'stock' | 'all_time_low' | 'new_product' | 'error' | 'info';
  title: string;
  body: string | null;
  old_price: number | null;
  new_price: number | null;
  read: number;
  sent_telegram: number;
  created_at: number;
  product_title?: string;
  product_url?: string;
}

export interface NotificationPreferences {
  email_enabled: boolean;
  web_push_enabled: boolean;
  delivery_mode: 'instant' | 'daily';
  unsubscribed: boolean;
}

export interface NotificationChannelConfig {
  email: { configured: boolean };
  web_push: { configured: boolean; publicKey: string | null };
}

export interface Opportunity {
  product_id: number;
  current_price: number;
  reference_price: number;
  reference_kind: 'median_30d';
  drop_pct: number;
  at_all_time_low: number;
  stock_status: StockStatus;
  score: number;
  calculated_at: number;
  title: string;
  image: string | null;
  currency: string;
  site: string;
  category_id: number | null;
}

export interface ComplianceAssessment {
  product_id: number;
  status: 'consistent' | 'suspicious' | 'insufficient_data';
  advertised_reference: number | null;
  observed_price: number | null;
  low_10d_before: number | null;
  sample_count: number;
  evidence_start_at: number | null;
  evidence_end_at: number | null;
  reason: string;
  source_title: string;
  source_url: string;
  rule_effective_at: number;
  calculated_at: number;
  title: string;
  site: string;
  url: string;
  currency: string;
}

export interface CatalogMatchProduct {
  id: number;
  title: string;
  site: string;
  current_price: number | null;
  currency: string;
  normalized_brand: string | null;
  model_key: string | null;
  variant_key: string | null;
  gtin_normalized: string | null;
  gtin_valid: number;
  mpn_normalized: string | null;
  mpn_reliable: number;
  identity_quality: number;
}

export interface CatalogMatchCandidate {
  id: number;
  score: number;
  score_band: 'high' | 'medium' | 'low';
  score_version: string;
  exact_code_kind: 'gtin' | 'mpn' | null;
  title_score: number;
  model_score: number;
  price_score: number;
  reasons: string[];
  status: 'pending' | 'approved' | 'rejected' | 'stale';
  review_note: string | null;
  reviewed_at: number | null;
  updated_at: number;
  product_a: CatalogMatchProduct;
  product_b: CatalogMatchProduct;
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

export interface Watch {
  id: number;
  user_id: number;
  product_id: number;
  target_price: number | null;
  alert_mode: AlertMode;
  threshold_pct: number;
  active: number;
  created_at: number;
  title: string;
  site: string;
  current_price: number | null;
  currency: string;
  in_stock: number | null;
  image: string | null;
}

export interface AppSettings {
  telegram_token: string;
  telegram_chat: string;
  default_interval: string;
  notify_stock: string; // '1' | '0'
  notify_rise: string; // '1' | '0'
}

export interface ScrapeResult {
  ok: boolean;
  url: string;
  site: string;
  title?: string;
  image?: string;
  price?: number;
  listPrice?: number;
  currency?: string;
  inStock?: boolean;
  shippingCost?: number;
  installmentCount?: number;
  engine?: string;
  parserVersion?: string;
  error?: string;
}

export interface DiscoveredItem {
  url: string;
  title: string;
  price: number | null;
  image: string | null;
  inStock?: boolean | null;
  tracked?: boolean;
}

export interface Summary {
  total: number;
  active: number;
  errors: number;
  unread: number;
  drops7d: number;
  lastCheckAt: number | null;
  topDrops: {
    id: number;
    title: string;
    site: string;
    current_price: number;
    from_price: number;
    pct: number;
    currency: string;
  }[];
}
