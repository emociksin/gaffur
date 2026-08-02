// API istemcisi
import type {
  AppSettings,
  Category,
  DiscoveredItem,
  HistoryPoint,
  Notification,
  Product,
  ScrapeResult,
  Summary,
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
    if (res.status === 401 && path !== '/login' && path !== '/me') {
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

  summary: () => req<Summary>('/summary'),
  products: () => req<{ products: Product[] }>('/products'),
  product: (id: number, days = 90) =>
    req<{ product: Product; history: HistoryPoint[]; notifications: Notification[] }>(`/products/${id}?days=${days}`),
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
  readAll: () => req<{ ok: boolean }>('/notifications/read-all', { method: 'POST' }),
  readOne: (id: number) => req<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
  clearNotifications: () => req<{ ok: boolean }>('/notifications', { method: 'DELETE' }),

  // Gizli alanlar (telegram_token, firecrawl_key) maskeli doner; `has` bilgisi
  // alanin dolu olup olmadigini soyler. Maskeli deger geri gonderilirse sunucu
  // mevcut degeri korur.
  settings: () =>
    req<{ settings: AppSettings; has: { telegram_token: boolean; firecrawl_key: boolean } }>('/settings'),
  saveSettings: (s: Partial<AppSettings>) =>
    req<{ settings: AppSettings }>('/settings', { method: 'PUT', body: JSON.stringify(s) }),
  telegramDetect: (token: string) =>
    req<{ chatId: string; name: string }>('/telegram/detect', { method: 'POST', body: JSON.stringify({ token }) }),
  telegramTest: () => req<{ ok: boolean }>('/telegram/test', { method: 'POST' }),

  runCron: () => req<{ report: { products: number; changed: number; failed: number; listings: number } }>('/cron/run', {
    method: 'POST',
  }),
};
