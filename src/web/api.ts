// API istemcisi
import type {
  AppSettings,
  Category,
  DiscoveredItem,
  HistoryPoint,
  Notification,
  OfferSummary,
  PriceBaseline,
  Product,
  ScrapeResult,
  StockTransition,
  Summary,
  Watch,
  LandedCostInput,
  LandedCostResult,
  NotificationPreferences,
  NotificationChannelConfig,
  Opportunity,
  ComplianceAssessment,
} from '../shared/types';

export class ApiError extends Error {
  status: number;
  canForce: boolean;
  constructor(message: string, status: number, canForce = false) {
    super(message);
    this.status = status;
    this.canForce = canForce;
  }
}

export interface UserAccount {
  id: number;
  email: string;
  role: string;
  email_verified: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* csv vb. */
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/login' && path !== '/me' && !path.startsWith('/auth/') && !path.startsWith('/watches')) {
      window.dispatchEvent(new CustomEvent('gfr-unauthorized'));
    }
    throw new ApiError(data?.error ?? `Hata (${res.status})`, res.status, Boolean(data?.canForce));
  }
  return data as T;
}

export const api = {
  me: () => req<{ open: boolean; authed: boolean; configured: boolean }>('/me'),
  login: (password: string) => req<{ ok: boolean }>('/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: boolean }>('/logout', { method: 'POST' }),
  logoutAll: () => req<{ ok: boolean }>('/logout-all', { method: 'POST' }),

  userMe: () => req<{ authed: boolean; user?: UserAccount }>('/auth/me'),
  userLogin: (email: string, password: string) =>
    req<{ ok: boolean; userId: number; role: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  userRegister: (email: string, password: string, kvkkConsent: boolean) =>
    req<{ ok: boolean; userId: number }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, kvkk_consent: kvkkConsent }),
    }),
  userLogout: () => req<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  userNotifications: () => req<{ notifications: Notification[] }>('/auth/notifications'),
  readUserNotifications: () => req<{ ok: boolean }>('/auth/notifications/read-all', { method: 'POST' }),
  notificationPreferences: () => req<{
    preferences: NotificationPreferences;
    email_verified: boolean;
    channels: NotificationChannelConfig;
  }>('/auth/notification-preferences'),
  saveNotificationPreferences: (body: Partial<NotificationPreferences>) =>
    req<{ ok: boolean }>('/auth/notification-preferences', { method: 'PUT', body: JSON.stringify(body) }),
  requestEmailVerification: () => req<{ ok: boolean; alreadyVerified?: boolean }>('/auth/email/verification', { method: 'POST' }),
  addPushSubscription: (subscription: PushSubscriptionJSON) =>
    req<{ ok: boolean }>('/auth/push-subscriptions', { method: 'POST', body: JSON.stringify(subscription) }),
  deletePushSubscription: (endpoint: string) =>
    req<{ ok: boolean }>('/auth/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  watches: () => req<{ watches: Watch[] }>('/watches'),
  addWatch: (productId: number, targetPrice?: number | null, thresholdPct = 0) =>
    req<{ ok: boolean; watchId: number }>('/watches', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, target_price: targetPrice ?? null, threshold_pct: thresholdPct }),
    }),
  deleteWatch: (id: number) => req<{ ok: boolean }>(`/watches/${id}`, { method: 'DELETE' }),

  summary: () => req<Summary>('/summary'),
  opportunities: () => req<{ opportunities: Opportunity[] }>('/opportunities'),
  products: () => req<{ products: Product[] }>('/products'),
  product: (id: number, days = 90) =>
    req<{
      product: Product;
      history: HistoryPoint[];
      notifications: Notification[];
      baseline: PriceBaseline | null;
      stockState: { unknown_streak: number; parser_error: number } | null;
      stockTransitions: StockTransition[];
      offers: OfferSummary[];
    }>(`/products/${id}?days=${days}`),
  calculateLandedCost: (body: LandedCostInput) =>
    req<{ result: LandedCostResult }>('/landed-cost/calculate', { method: 'POST', body: JSON.stringify(body) }),
  preview: (url: string) =>
    req<{ type: 'product' | 'listing'; result?: ScrapeResult; items?: DiscoveredItem[]; error?: string }>('/preview', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  addProduct: (body: Record<string, unknown>) =>
    req<{ product: Product; scrape: ScrapeResult }>('/products', { method: 'POST', body: JSON.stringify(body) }),
  patchProduct: (id: number, body: Record<string, unknown>) =>
    req<{ product: Product }>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProduct: (id: number) => req<{ ok: boolean }>(`/products/${id}`, { method: 'DELETE' }),
  checkProduct: (id: number) =>
    req<{ outcome: { ok: boolean; changed: boolean; error?: string }; product: Product }>(`/products/${id}/check`, {
      method: 'POST',
    }),
  checkAll: () =>
    req<{ checked: number; changed: number; failed: number; remaining: number }>('/check-all', { method: 'POST' }),

  categories: () => req<{ categories: Category[] }>('/categories'),
  addCategory: (body: Record<string, unknown>) =>
    req<{ category: Category; refresh: { ok: boolean; found: number; added: number; updated: number; error?: string } | null }>(
      '/categories',
      { method: 'POST', body: JSON.stringify(body) }
    ),
  patchCategory: (id: number, body: Record<string, unknown>) =>
    req<{ category: Category }>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategory: (id: number, mode: 'keep' | 'delete_products') =>
    req<{ ok: boolean }>(`/categories/${id}?mode=${mode}`, { method: 'DELETE' }),
  refreshCategory: (id: number) =>
    req<{ refresh: { ok: boolean; found: number; added: number; updated: number; error?: string } }>(
      `/categories/${id}/refresh`,
      { method: 'POST' }
    ),

  notifications: () => req<{ notifications: Notification[] }>('/notifications'),
  compliance: () => req<{ assessments: ComplianceAssessment[] }>('/compliance'),
  refreshCompliance: () => req<{ result: { refreshed: boolean; count: number; calculatedAt: number } }>('/compliance/refresh', { method: 'POST' }),
  refreshOpportunities: () => req<{ result: { refreshed: boolean; count: number; calculatedAt: number } }>('/opportunities/refresh', { method: 'POST' }),
  readAll: () => req<{ ok: boolean }>('/notifications/read-all', { method: 'POST' }),
  readOne: (id: number) => req<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
  clearNotifications: () => req<{ ok: boolean }>('/notifications', { method: 'DELETE' }),

  // Gizli alanlar (telegram_token) maskeli doner; `has` bilgisi
  // alanin dolu olup olmadigini soyler. Maskeli deger geri gonderilirse sunucu
  // mevcut degeri korur.
  settings: () =>
    req<{ settings: AppSettings; has: { telegram_token: boolean } }>('/settings'),
  saveSettings: (s: Partial<AppSettings>) =>
    req<{ settings: AppSettings }>('/settings', { method: 'PUT', body: JSON.stringify(s) }),
  telegramDetect: (token: string) =>
    req<{ chatId: string; name: string }>('/telegram/detect', { method: 'POST', body: JSON.stringify({ token }) }),
  telegramTest: () => req<{ ok: boolean }>('/telegram/test', { method: 'POST' }),

  runCron: () => req<{ report: { products: number; changed: number; failed: number; listings: number } }>('/cron/run', {
    method: 'POST',
  }),
};
