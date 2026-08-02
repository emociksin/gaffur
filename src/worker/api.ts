// REST API — Hono
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from './env';
import type { AppSettings, Product } from '../shared/types';
import { getProduct, getSettings, insertNotification, now, setSetting, SETTINGS_DEFAULTS } from './db';
import { checkSession, makeSession, rotateSessionSecret, safeEqual, SESSION_MAX_AGE_S } from './auth';
import { checkProduct, directFetch, firecrawlScrape, refreshListing, scrapeUrl } from './scrape/engine';
import { canonicalUrl, detectSite, discoverTrendyol, isListingUrl } from './scrape/sites';
import { detectChatId, sendTelegram } from './telegram';

const api = new Hono<{ Bindings: Env }>();

// https'te __Host- onekli cerez kullanilir: tarayici bunu yalnizca Secure,
// Path=/ ve Domain'siz kabul eder; alt alan adindan cerez sabitleme yapilamaz.
// http (yerel gelistirme) __Host-'u kabul etmedigi icin orada duz ad kullanilir.
const COOKIE = 'gfr_s';
const COOKIE_HOST = '__Host-gfr_s';

const isHttps = (c: { req: { url: string } }) => new URL(c.req.url).protocol === 'https:';
const cookieName = (c: { req: { url: string } }) => (isHttps(c) ? COOKIE_HOST : COOKIE);
const readSessionCookie = (c: Parameters<typeof getCookie>[0]) =>
  getCookie(c, COOKIE_HOST) ?? getCookie(c, COOKIE);

/** Parolasiz acik mod yalnizca yerelde ve acikca istendiginde (.dev.vars -> ALLOW_OPEN=1). */
const openModeAllowed = (env: Env) => env.ALLOW_OPEN === '1';

// ---- giris hiz siniri (D1) ----
const RL_WINDOW_S = 15 * 60;
const RL_MAX_IP = 10;
const RL_MAX_GLOBAL = 60;

async function bump(env: Env, key: string, max: number, t: number): Promise<number> {
  const row = await env.DB.prepare('SELECT n, reset_at FROM login_attempts WHERE ip = ?')
    .bind(key)
    .first<{ n: number; reset_at: number }>();
  if (!row || row.reset_at <= t) {
    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, n, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(ip) DO UPDATE SET n = 1, reset_at = excluded.reset_at`
    )
      .bind(key, t + RL_WINDOW_S)
      .run();
    return 0;
  }
  const n = row.n + 1;
  await env.DB.prepare('UPDATE login_attempts SET n = ? WHERE ip = ?').bind(n, key).run();
  return n > max ? row.reset_at - t : 0;
}

/** Sinir asildiysa kac saniye beklenecegini, asilmadiysa 0 doner. */
async function hitRateLimit(env: Env, ip: string): Promise<number> {
  const t = now();
  await env.DB.prepare('DELETE FROM login_attempts WHERE reset_at < ?').bind(t - RL_WINDOW_S).run();
  const perIp = await bump(env, ip, RL_MAX_IP, t);
  const global = await bump(env, '__global__', RL_MAX_GLOBAL, t);
  return Math.max(perIp, global);
}

async function clearRateLimit(env: Env, ip: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}

/** Durum bildirebilmek icin oturumsuz erisilebilen yollar. Hicbiri veri degistirmez. */
const isPublicPath = (path: string) =>
  path === '/api/login' || path === '/api/me' || path === '/api/health';

// ---- CSRF: veri degistiren isteklerde Origin ayni site olmali ----
// Cerez zaten SameSite=Strict ama Hono govdeyi text/plain ve form
// content-type'lariyla da JSON olarak ayristirdigi icin ikinci kemer.
api.use('*', async (c, next) => {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const origin = c.req.header('origin');
  if (origin) {
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === new URL(c.req.url).host;
    } catch {
      sameSite = false;
    }
    if (!sameSite) return c.json({ error: 'Farklı kaynaktan gelen istek reddedildi' }, 403);
  }
  return next();
});

// ---- auth middleware ----
// FAIL-CLOSED: PASSWORD tanimli degilse uygulama acilmaz, kilitlenir.
// (Eskiden parola yoksa TUM API herkese aciktu; secret'siz bir deploy
//  paneli internete acik birakiyordu.)
api.use('*', async (c, next) => {
  const pw = c.env.PASSWORD;
  const path = c.req.path;

  if (!pw) {
    if (openModeAllowed(c.env)) return next();
    if (isPublicPath(path)) return next();
    return c.json(
      { error: 'Sunucu yapılandırılmamış: PASSWORD secret tanımlı değil.', configured: false },
      503
    );
  }

  if (isPublicPath(path)) return next();
  const ok = await checkSession(c.env, readSessionCookie(c));
  if (!ok) return c.json({ error: 'Oturum gerekli' }, 401);
  return next();
});

api.get('/health', (c) => c.json({ ok: true, t: now() }));

api.get('/me', async (c) => {
  const pw = c.env.PASSWORD;
  if (!pw) {
    // configured=false: arayuz "parola girin" yerine kurulum uyarisi gosterir
    const open = openModeAllowed(c.env);
    return c.json({ open, authed: open, configured: false });
  }
  const authed = await checkSession(c.env, readSessionCookie(c));
  return c.json({ open: false, authed, configured: true });
});

api.post('/login', async (c) => {
  const pw = c.env.PASSWORD;
  // Parola tanimli degilken giris "basarili" sayilamaz - bu da bir fail-open yoluydu.
  if (!pw) {
    if (openModeAllowed(c.env)) return c.json({ ok: true });
    return c.json({ error: 'Sunucu yapılandırılmamış: PASSWORD secret tanımlı değil.' }, 503);
  }
  // Kaba kuvvet: sabit gecikme TEK BASINA yetmez (saldirgan paralel istek atar),
  // bu yuzden D1'de sayac tutulur. IP kaynagi CF-Connecting-IP: Cloudflare
  // kenarinda yazilir, istemci uyduramaz. '__global__' satiri dagitik denemeler
  // icin toplam tavandir.
  const ip = c.req.header('cf-connecting-ip') || 'bilinmiyor';
  const limited = await hitRateLimit(c.env, ip);
  if (limited) {
    return c.json({ error: `Çok fazla deneme. ${limited} saniye sonra tekrar dene.` }, 429, {
      'retry-after': String(limited),
    });
  }

  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as any);
  const given = String(body.password ?? '');
  await new Promise((r) => setTimeout(r, 350));
  if (!(await safeEqual(given, pw))) return c.json({ error: 'Parola yanlış' }, 401);

  await clearRateLimit(c.env, ip);
  setCookie(c, cookieName(c), await makeSession(c.env), {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return c.json({ ok: true });
});

api.post('/logout', (c) => {
  deleteCookie(c, COOKIE_HOST, { path: '/' });
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** Tum cihazlardaki oturumlari kapatir (imza anahtarini dondurur). */
api.post('/logout-all', async (c) => {
  await rotateSessionSecret(c.env);
  deleteCookie(c, COOKIE_HOST, { path: '/' });
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// ---- ozet ----
api.get('/summary', async (c) => {
  const t = now();
  const week = t - 7 * 24 * 3600;
  const [counts, unread, drops, lastCheck, tops] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(active) AS active,
              SUM(CASE WHEN fail_count >= 3 THEN 1 ELSE 0 END) AS errors
       FROM products`
    ).first<{ total: number; active: number; errors: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE kind IN ('drop','target') AND created_at >= ?`
    )
      .bind(week)
      .first<{ n: number }>(),
    c.env.DB.prepare('SELECT MAX(last_checked_at) AS t FROM products').first<{ t: number | null }>(),
    c.env.DB.prepare(
      `SELECT p.id, p.title, p.site, p.currency, p.current_price,
              (SELECT ph.price FROM price_history ph
                WHERE ph.product_id = p.id AND ph.checked_at <= ?
                ORDER BY ph.checked_at DESC LIMIT 1) AS base_old,
              (SELECT ph.price FROM price_history ph
                WHERE ph.product_id = p.id AND ph.checked_at > ?
                ORDER BY ph.checked_at ASC LIMIT 1) AS win_first
       FROM products p
       WHERE p.active = 1 AND p.current_price IS NOT NULL`
    )
      .bind(week, week)
      .all<any>(),
  ]);

  const topDrops = (tops.results ?? [])
    .map((r: any) => {
      const from = r.base_old ?? r.win_first;
      if (from == null || r.current_price == null || from <= 0) return null;
      const pct = ((from - r.current_price) / from) * 100;
      return pct >= 0.5
        ? {
            id: r.id,
            title: r.title,
            site: r.site,
            currency: r.currency,
            current_price: r.current_price,
            from_price: from,
            pct,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.pct - a.pct)
    .slice(0, 5);

  return c.json({
    total: counts?.total ?? 0,
    active: counts?.active ?? 0,
    errors: counts?.errors ?? 0,
    unread: unread?.n ?? 0,
    drops7d: drops?.n ?? 0,
    lastCheckAt: lastCheck?.t ?? null,
    topDrops,
  });
});

// ---- urunler ----
api.get('/products', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC').all<Product>();
  const products = rows.results ?? [];
  // sparkline: urun basina son 40 nokta (tek sorgu, window function)
  const spark = await c.env.DB.prepare(
    `SELECT product_id, price AS p, checked_at AS t FROM (
       SELECT product_id, price, checked_at,
              ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY checked_at DESC) AS rn
       FROM price_history
     ) WHERE rn <= 40 ORDER BY product_id, checked_at ASC`
  ).all<{ product_id: number; p: number; t: number }>();
  const byId = new Map<number, { p: number; t: number }[]>();
  for (const s of spark.results ?? []) {
    let arr = byId.get(s.product_id);
    if (!arr) byId.set(s.product_id, (arr = []));
    arr.push({ p: s.p, t: s.t });
  }
  for (const p of products) (p as any).spark = byId.get(p.id) ?? [];
  return c.json({ products });
});

api.get('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const p = await getProduct(c.env, id);
  if (!p) return c.json({ error: 'Ürün bulunamadı' }, 404);
  const days = Math.min(Number(c.req.query('days') ?? 90), 365);
  const since = now() - days * 24 * 3600;
  const history = await c.env.DB.prepare(
    'SELECT price, list_price, in_stock, checked_at FROM price_history WHERE product_id = ? AND checked_at >= ? ORDER BY checked_at ASC'
  )
    .bind(id, since)
    .all();
  const notifs = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE product_id = ? ORDER BY created_at DESC LIMIT 10'
  )
    .bind(id)
    .all();
  return c.json({ product: p, history: history.results ?? [], notifications: notifs.results ?? [] });
});

// URL onizleme (kaydetmeden once ne bulundugunu goster)
api.post('/preview', async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => ({}) as any);
  const url = String(body.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return c.json({ error: 'Geçerli bir bağlantı yapıştır (https:// ile başlamalı)' }, 400);
  const settings = await getSettings(c.env);

  if (isListingUrl(url)) {
    try {
      let html = '';
      const res = await directFetch(url);
      html = res.html;
      let items = discoverTrendyol(html, 24);
      if (!items.length && settings.firecrawl_key) {
        html = await firecrawlScrape(settings.firecrawl_key, url);
        items = discoverTrendyol(html, 24);
      }
      if (!items.length)
        return c.json({ error: 'Bu liste sayfasından ürün çıkarılamadı. Tek ürün bağlantısı deneyebilirsin.' }, 422);
      const urls = items.map((i) => canonicalUrl(i.url));
      const existing = await c.env.DB.prepare(
        `SELECT url FROM products WHERE url IN (${urls.map(() => '?').join(',')})`
      )
        .bind(...urls)
        .all<{ url: string }>();
      const known = new Set((existing.results ?? []).map((r) => r.url));
      for (const i of items) i.tracked = known.has(canonicalUrl(i.url));
      return c.json({ type: 'listing', items });
    } catch (e: any) {
      return c.json({ error: `Liste sayfası okunamadı: ${String(e?.message ?? e).slice(0, 140)}` }, 422);
    }
  }

  const r = await scrapeUrl(url, 'auto', settings.firecrawl_key || undefined);
  if (!r.ok) return c.json({ type: 'product', result: r, error: r.error }, 422);
  return c.json({ type: 'product', result: r });
});

api.post('/products', async (c) => {
  const body = await c.req
    .json<{
      url?: string;
      category_id?: number | null;
      target_price?: number | null;
      alert_mode?: string;
      threshold_pct?: number;
      interval_min?: number;
      engine?: string;
      force?: boolean;
    }>()
    .catch(() => ({}) as any);
  const rawUrl = String(body.url ?? '').trim();
  if (!/^https?:\/\//i.test(rawUrl)) return c.json({ error: 'Geçerli bir bağlantı gerekli' }, 400);
  const url = canonicalUrl(rawUrl);
  const site = detectSite(url);
  const dup = await c.env.DB.prepare('SELECT id FROM products WHERE url = ?').bind(url).first();
  if (dup) return c.json({ error: 'Bu ürün zaten takipte' }, 409);

  const settings = await getSettings(c.env);
  const t = now();
  const alertMode = ['drop', 'target', 'any', 'off'].includes(String(body.alert_mode)) ? String(body.alert_mode) : 'drop';
  const engine = ['auto', 'direct', 'firecrawl'].includes(String(body.engine)) ? String(body.engine) : 'auto';
  const interval = Math.max(5, Math.min(1440, Number(body.interval_min) || Number(settings.default_interval) || 60));
  const target = body.target_price != null && Number(body.target_price) > 0 ? Number(body.target_price) : null;
  const threshold = Math.max(0, Math.min(90, Number(body.threshold_pct) || 0));

  const r = await scrapeUrl(url, engine as any, settings.firecrawl_key || undefined);

  if (!r.ok && !body.force) {
    return c.json({ error: r.error ?? 'Ürün okunamadı', canForce: true }, 422);
  }

  const res = await c.env.DB.prepare(
    `INSERT INTO products (url, site, title, image, currency, category_id, target_price, alert_mode, threshold_pct,
       interval_min, engine, active, current_price, list_price, in_stock, min_price, max_price,
       fail_count, last_error, last_engine, last_checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      url,
      site,
      r.title ?? url,
      r.image ?? null,
      r.currency ?? 'TRY',
      body.category_id ?? null,
      target,
      alertMode,
      threshold,
      interval,
      engine,
      r.ok ? (r.price ?? null) : null,
      r.ok ? (r.listPrice ?? null) : null,
      r.ok ? (r.inStock == null ? null : r.inStock ? 1 : 0) : null,
      r.ok ? (r.price ?? null) : null,
      r.ok ? (r.price ?? null) : null,
      r.ok ? 0 : 1,
      r.ok ? null : (r.error ?? 'okunamadı'),
      r.ok ? (r.engine ?? null) : null,
      t,
      t
    )
    .run();
  const id = res.meta.last_row_id as number;
  if (r.ok && r.price != null) {
    await c.env.DB.prepare('INSERT INTO price_history (product_id, price, list_price, in_stock, checked_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, r.price, r.listPrice ?? null, r.inStock == null ? null : r.inStock ? 1 : 0, t)
      .run();
  }
  const p = await getProduct(c.env, id);
  return c.json({ product: p, scrape: r });
});

const PATCHABLE = new Set([
  'title',
  'category_id',
  'target_price',
  'alert_mode',
  'threshold_pct',
  'interval_min',
  'engine',
  'active',
]);

api.patch('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const p = await getProduct(c.env, id);
  if (!p) return c.json({ error: 'Ürün bulunamadı' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    sets.push(`${k} = ?`);
    if (k === 'interval_min') vals.push(Math.max(5, Math.min(1440, Number(v) || 60)));
    else if (k === 'threshold_pct') vals.push(Math.max(0, Math.min(90, Number(v) || 0)));
    else if (k === 'target_price') vals.push(v == null || v === '' || Number(v) <= 0 ? null : Number(v));
    else if (k === 'category_id') vals.push(v == null || v === '' ? null : Number(v));
    else if (k === 'active') vals.push(v ? 1 : 0);
    else vals.push(v);
  }
  if (!sets.length) return c.json({ error: 'Değişiklik yok' }, 400);
  vals.push(id);
  await c.env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ product: await getProduct(c.env, id) });
});

api.delete('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM price_history WHERE product_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM notifications WHERE product_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

api.post('/products/:id/check', async (c) => {
  const id = Number(c.req.param('id'));
  const p = await getProduct(c.env, id);
  if (!p) return c.json({ error: 'Ürün bulunamadı' }, 404);
  const outcome = await checkProduct(c.env, p);
  return c.json({ outcome, product: await getProduct(c.env, id) });
});

// "Tumunu simdi kontrol et" — parti parti calisir, kalan sayiyi doner (frontend dongusu surdurur)
api.post('/check-all', async (c) => {
  const t = now();
  const settings = await getSettings(c.env);
  const candidates = await c.env.DB.prepare(
    `SELECT * FROM products WHERE active = 1 AND (last_checked_at IS NULL OR last_checked_at <= ?)
     ORDER BY COALESCE(last_checked_at, 0) ASC`
  )
    .bind(t - 60)
    .all<Product>();
  const all = candidates.results ?? [];
  const batch = all.slice(0, 8);
  let changed = 0;
  let failed = 0;
  for (const p of batch) {
    try {
      const r = await checkProduct(c.env, p, settings);
      if (r.ok && r.changed) changed++;
      if (!r.ok) failed++;
    } catch {
      failed++;
    }
  }
  return c.json({ checked: batch.length, changed, failed, remaining: Math.max(0, all.length - batch.length) });
});

// ---- kategoriler ----
api.get('/categories', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
     FROM categories c ORDER BY c.created_at ASC`
  ).all();
  return c.json({ categories: rows.results ?? [] });
});

api.post('/categories', async (c) => {
  const body = await c.req
    .json<{ name?: string; color?: string; source_url?: string; auto_track?: boolean }>()
    .catch(() => ({}) as any);
  const name = String(body.name ?? '').trim();
  if (!name) return c.json({ error: 'Kategori adı gerekli' }, 400);
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color)) ? String(body.color) : '#E4611C';
  const sourceUrl = String(body.source_url ?? '').trim() || null;
  if (sourceUrl && !isListingUrl(sourceUrl)) {
    return c.json(
      { error: 'Kaynak URL bir Trendyol kategori/arama sayfası olmalı (şimdilik liste keşfi Trendyol için destekleniyor)' },
      400
    );
  }
  const t = now();
  const res = await c.env.DB.prepare(
    'INSERT INTO categories (name, color, source_url, site, auto_track, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(name, color, sourceUrl, sourceUrl ? 'trendyol' : null, sourceUrl && body.auto_track !== false ? 1 : 0, t)
    .run();
  const id = res.meta.last_row_id as number;
  let refresh = null;
  if (sourceUrl) {
    const settings = await getSettings(c.env);
    refresh = await refreshListing(c.env, { id, name, source_url: sourceUrl }, settings);
  }
  const cat = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
  return c.json({ category: cat, refresh });
});

api.patch('/categories/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?');
    vals.push(body.name.trim());
  }
  if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) {
    sets.push('color = ?');
    vals.push(body.color);
  }
  if ('auto_track' in body) {
    sets.push('auto_track = ?');
    vals.push(body.auto_track ? 1 : 0);
  }
  if (!sets.length) return c.json({ error: 'Değişiklik yok' }, 400);
  vals.push(id);
  await c.env.DB.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const cat = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
  return c.json({ category: cat });
});

api.delete('/categories/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const mode = c.req.query('mode') ?? 'keep';
  if (mode === 'delete_products') {
    const prods = await c.env.DB.prepare('SELECT id FROM products WHERE category_id = ?').bind(id).all<{ id: number }>();
    for (const p of prods.results ?? []) {
      await c.env.DB.prepare('DELETE FROM price_history WHERE product_id = ?').bind(p.id).run();
      await c.env.DB.prepare('DELETE FROM notifications WHERE product_id = ?').bind(p.id).run();
    }
    await c.env.DB.prepare('DELETE FROM products WHERE category_id = ?').bind(id).run();
  } else {
    await c.env.DB.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').bind(id).run();
  }
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

api.post('/categories/:id/refresh', async (c) => {
  const id = Number(c.req.param('id'));
  const cat = await c.env.DB.prepare('SELECT id, name, source_url FROM categories WHERE id = ?')
    .bind(id)
    .first<{ id: number; name: string; source_url: string | null }>();
  if (!cat) return c.json({ error: 'Kategori bulunamadı' }, 404);
  if (!cat.source_url) return c.json({ error: 'Bu kategorinin kaynak URL\'si yok' }, 400);
  const settings = await getSettings(c.env);
  const refresh = await refreshListing(c.env, cat, settings);
  return c.json({ refresh });
});

// ---- bildirimler ----
api.get('/notifications', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 300);
  const rows = await c.env.DB.prepare(
    `SELECT n.*, p.title AS product_title, p.url AS product_url
     FROM notifications n LEFT JOIN products p ON p.id = n.product_id
     ORDER BY n.created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return c.json({ notifications: rows.results ?? [] });
});

api.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  return c.json({ ok: true });
});

api.post('/notifications/:id/read', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

api.delete('/notifications', async (c) => {
  await c.env.DB.prepare('DELETE FROM notifications').run();
  return c.json({ ok: true });
});

// ---- ayarlar ----
// Gizli alanlar istemciye ACIK METIN gitmez; sadece "tanimli mi" bilgisi ve
// tanimak icin maskeli bir onizleme doner. Kaydetmede maskeli deger gelirse
// (kullanici alana dokunmamissa) mevcut deger korunur.
const SECRET_SETTINGS = ['telegram_token', 'firecrawl_key'] as const;
// Maske ASCII: unicode bir isaret (•) kullanildiginda kodlama bozulmasi
// maskeyi taninmaz hale getirip GERCEK ANAHTARIN uzerine yazilmasina yol aciyordu.
const MASK = '****';

function maskSecret(v: string): string {
  if (!v) return '';
  if (v.length <= 8) return MASK;
  return `${v.slice(0, 4)}${MASK}${v.slice(-4)}`;
}

/** Yildiz dizisi iceren hicbir deger gercek anahtar olamaz. */
const looksMasked = (v: string) => v.includes(MASK) || v.includes('•');

function publicSettings(s: AppSettings): AppSettings & Record<string, string> {
  const out: any = { ...s };
  for (const k of SECRET_SETTINGS) out[k] = maskSecret(s[k] ?? '');
  return out;
}

api.get('/settings', async (c) => {
  const s = await getSettings(c.env);
  return c.json({
    settings: publicSettings(s),
    has: { telegram_token: Boolean(s.telegram_token), firecrawl_key: Boolean(s.firecrawl_key) },
  });
});

api.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const current = await getSettings(c.env);
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    if (!(key in body)) continue;
    const value = String(body[key] ?? '');
    if ((SECRET_SETTINGS as readonly string[]).includes(key)) {
      const stored = (current as any)[key] ?? '';
      // Maskeli deger geldiyse kullanici alana dokunmamistir; mevcut anahtar korunur.
      // Iki kontrol: (a) maske isareti tasiyor mu, (b) mevcut degerin maskesine esit mi.
      if (value && (looksMasked(value) || value === maskSecret(stored))) continue;
    }
    await setSetting(c.env, key, value);
  }
  return c.json({ settings: publicSettings(await getSettings(c.env)) });
});

api.post('/telegram/detect', async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => ({}) as any);
  const settings = await getSettings(c.env);
  // istemci maskeli degeri geri gonderebilir; o durumda kayitli token kullanilir
  const sent = String(body.token ?? '').trim();
  const token = !sent || looksMasked(sent) ? String(settings.telegram_token ?? '').trim() : sent;
  if (!token) return c.json({ error: 'Önce bot token gir' }, 400);
  const r = await detectChatId(token);
  if (!r.ok) return c.json({ error: r.error }, 422);
  await setSetting(c.env, 'telegram_token', token);
  await setSetting(c.env, 'telegram_chat', r.chatId!);
  return c.json({ chatId: r.chatId, name: r.name });
});

api.post('/telegram/test', async (c) => {
  const settings = await getSettings(c.env);
  if (!settings.telegram_token || !settings.telegram_chat)
    return c.json({ error: 'Telegram ayarları eksik' }, 400);
  const ok = await sendTelegram(
    settings.telegram_token,
    settings.telegram_chat,
    '▼ <b>Gaffur test</b>\nBildirimler çalışıyor. Fiyat düşünce buradan haber vereceğim.'
  );
  if (!ok) return c.json({ error: 'Gönderilemedi — token/chat id kontrol et' }, 422);
  await insertNotification(c.env, { kind: 'info', title: 'Telegram testi gönderildi', sent_telegram: true });
  return c.json({ ok: true });
});

// ---- cron'u elle tetikleme (test icin) ----
api.post('/cron/run', async (c) => {
  const { runScheduled } = await import('./cron');
  const report = await runScheduled(c.env);
  return c.json({ report });
});

// ---- CSV disa aktarim (Excel-TR uyumlu: BOM + noktali virgul) ----
function csvEsc(v: unknown): string {
  let s = v == null ? '' : String(v);
  // Formul enjeksiyonu: Excel/Sheets '=', '+', '-', '@', TAB ile baslayan hucreyi
  // formul sayar. Urun basliklari kazinmis ucuncu taraf metni oldugundan
  // zararsizlastirilir (tirnak, hucreyi metin yapar).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

api.get('/export/products.csv', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.created_at ASC`
  ).all<any>();
  const head = 'id;urun;site;kategori;guncel_fiyat;onceki_fiyat;en_dusuk;en_yuksek;hedef;para_birimi;stok;url;son_kontrol';
  const lines = (rows.results ?? []).map((p: any) =>
    [
      p.id,
      csvEsc(p.title),
      csvEsc(p.site),
      csvEsc(p.category_name ?? ''),
      p.current_price ?? '',
      p.previous_price ?? '',
      p.min_price ?? '',
      p.max_price ?? '',
      p.target_price ?? '',
      p.currency,
      p.in_stock == null ? '' : p.in_stock ? 'var' : 'yok',
      csvEsc(p.url),
      p.last_checked_at ? new Date(p.last_checked_at * 1000).toISOString() : '',
    ].join(';')
  );
  return new Response('﻿' + [head, ...lines].join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="gaffur-urunler.csv"',
    },
  });
});

api.get('/export/history.csv', async (c) => {
  const pid = Number(c.req.query('product_id'));
  if (!pid) return c.json({ error: 'product_id gerekli' }, 400);
  const p = await getProduct(c.env, pid);
  if (!p) return c.json({ error: 'Ürün bulunamadı' }, 404);
  const rows = await c.env.DB.prepare(
    'SELECT price, list_price, in_stock, checked_at FROM price_history WHERE product_id = ? ORDER BY checked_at ASC'
  )
    .bind(pid)
    .all<any>();
  const head = 'tarih;fiyat;liste_fiyati;stok';
  const lines = (rows.results ?? []).map((h: any) =>
    [
      new Date(h.checked_at * 1000).toISOString(),
      h.price,
      h.list_price ?? '',
      h.in_stock == null ? '' : h.in_stock ? 'var' : 'yok',
    ].join(';')
  );
  return new Response('﻿' + [head, ...lines].join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="gaffur-gecmis-${pid}.csv"`,
    },
  });
});

export default api;
