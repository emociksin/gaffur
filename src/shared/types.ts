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
  kind: 'drop' | 'rise' | 'target' | 'stock' | 'new_product' | 'error' | 'info';
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
