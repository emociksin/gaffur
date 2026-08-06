// REST API — Hono
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from './env';
import type { AppSettings, Product } from '../shared/types';
import { ensureOffer, getProduct, getSettings, insertNotification, now, setSetting, SETTINGS_DEFAULTS, writeOfferSnapshot } from './db';
import { checkSession, generateSessionId, hashPassword, makeSession, rotateSessionSecret, safeEqual, SESSION_MAX_AGE_S, verifyPassword } from './auth';
import { checkProduct, crawleeScrape, directFetch, refreshListing, scrapeUrl } from './scrape/engine';
import { canonicalUrl, detectSite, discoverTrendyol, isListingUrl } from './scrape/sites';
import { detectChatId, sendTelegram } from './telegram';
import { calculateLandedCost, type LandedCostInput } from './intelligence/landed-cost';

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
  path === '/api/login' ||
  path === '/api/me' ||
  path === '/api/health' ||
  path.startsWith('/api/auth/') ||
  path === '/api/watches' ||
  /^\/api\/watches\/\d+$/.test(path);

/**
 * ZIYARETCIYE ACIK OKUMA UCLARI.
 * Site herkese acik bir fiyat takip vitrini: urunler, fiyatlar, gecmis ve
 * kategoriler oturumsuz okunabilir. Listeye SADECE veri degistirmeyen ve
 * gizli bilgi tasimayan GET'ler girer.
 *
 * Bilerek DISARIDA birakilanlar:
 *   /settings        -> Telegram token'i ve Firecrawl anahtari
 *   /notifications   -> operasyon gurultusu
 *   /export/*.csv    -> toplu veri disari aktarimi
 *   /preview, /check-all, /cron/run -> dis istek + kredi harcatir
 */
const PUBLIC_READS: RegExp[] = [
  /^\/api\/summary$/,
  /^\/api\/products$/,
  /^\/api\/products\/\d+$/,
  /^\/api\/categories$/,
  /^\/api\/offers\/\d+\/logistics$/,
  /^\/api\/tax-rules$/,
];
const isPublicRead = (method: string, path: string) =>
  method === 'GET' && PUBLIC_READS.some((r) => r.test(path));

/**
 * ZIYARETCININ YAPABILDIGI YAZMA ISLEMLERI.
 * Site herkesin kullandigi bir arac: gelen kisi urun linkini yapistirip takibe
 * alabilir. Ikisi de disariya istek attigi (ve Firecrawl kredisi harcayabildigi)
 * icin IP basina ve toplamda hiz siniriyla korunur.
 * Silme, duzenleme, ayarlar ve bildirimler ziyaretciye KAPALI kalir.
 */
const isPublicWrite = (method: string, path: string) =>
  method === 'POST' && (path === '/api/products' || path === '/api/preview' || path === '/api/landed-cost/calculate');

// ---- ziyaretci hiz siniri ----
const ADD_PER_IP = 10; // saatte, IP basina eklenebilecek urun
const ADD_PER_HOUR_ALL = 60; // saatte, tum site
const PREVIEW_PER_IP = 30; // saatte, IP basina onizleme
const MAX_ACTIVE_PRODUCTS = 300; // cron maliyetini sinirlar

/** Sinir asildiysa kac saniye beklenecegini, asilmadiysa 0 doner. */
async function limitHit(env: Env, key: string, max: number, windowS: number): Promise<number> {
  const t = now();
  const row = await env.DB.prepare('SELECT n, reset_at FROM rate_limits WHERE k = ?')
    .bind(key)
    .first<{ n: number; reset_at: number }>();
  if (!row || row.reset_at <= t) {
    await env.DB.prepare(
      `INSERT INTO rate_limits (k, n, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(k) DO UPDATE SET n = 1, reset_at = excluded.reset_at`
    )
      .bind(key, t + windowS)
      .run();
    return 0;
  }
  if (row.n >= max) return row.reset_at - t;
  await env.DB.prepare('UPDATE rate_limits SET n = n + 1 WHERE k = ?').bind(key).run();
  return 0;
}

const clientIp = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'bilinmiyor';

const dakika = (sn: number) => Math.max(1, Math.ceil(sn / 60));

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
// Site herkese acik bir vitrin: okuma uclari (PUBLIC_READS) oturumsuz calisir.
// Veri degistiren her sey ve gizli bilgi tasiyan uclar parola ister.
// FAIL-CLOSED: PASSWORD tanimli degilse YONETIM kilitli kalir (vitrin acik olur);
// aksi halde secret'siz bir deploy paneli internete acik birakirdi.
api.use('*', async (c, next) => {
  const pw = c.env.PASSWORD;
  const path = c.req.path;

  if (isPublicPath(path) || isPublicRead(c.req.method, path) || isPublicWrite(c.req.method, path)) {
    return next();
  }

  if (!pw) {
    if (openModeAllowed(c.env)) return next();
    return c.json(
      { error: 'Yönetim kapalı: sunucuda PASSWORD tanımlı değil.', configured: false },
      503
    );
  }

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
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0 AND user_id IS NULL').first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id IS NULL AND kind IN ('drop','target') AND created_at >= ?`
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
       WHERE p.active = 1 AND p.current_price IS NOT NULL AND p.stock_status = 'in_stock'`
    )
      .bind(week, week)
      .all<any>(),
  ]);

  const topDrops = (tops.results ?? [])
    .map((r: any) => {
      const from = r.base_old ?? r.win_first;
      if (from == null || r.current_price == null || from <= 0) return null;
      const pct = ((from - r.current_price) / from) * 100;
      return pct >= 2
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
    'SELECT * FROM notifications WHERE product_id = ? AND user_id IS NULL ORDER BY created_at DESC LIMIT 10'
  )
    .bind(id)
    .all();
  const [baseline, stockState, stockTransitions, offers] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM price_baselines WHERE product_id = ?').bind(id).first(),
    c.env.DB.prepare(
      `SELECT confirmed_status, candidate_status, candidate_count, unknown_streak, parser_error,
              last_observed_at, last_transition_at
       FROM product_stock_state WHERE product_id = ?`
    ).bind(id).first(),
    c.env.DB.prepare(
      `SELECT id, product_id, from_status, to_status, confirmed_at, observation_count
       FROM stock_transitions WHERE product_id = ? ORDER BY confirmed_at DESC LIMIT 20`
    ).bind(id).all(),
    c.env.DB.prepare(
      `SELECT o.id, o.marketplace, o.seller_name, o.url, o.origin_country, o.origin_region,
              (SELECT os.price FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1) AS price,
              (SELECT os.currency FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1) AS currency,
              COALESCE(
                (SELECT sq.cost FROM shipping_quotes sq WHERE sq.offer_id = o.id ORDER BY captured_at DESC LIMIT 1),
                (SELECT os.shipping_cost FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1)
              ) AS shipping_cost,
              COALESCE(
                (SELECT MAX(io.installment_count) FROM installment_options io
                 WHERE io.offer_id = o.id AND io.captured_at = (SELECT MAX(captured_at) FROM installment_options WHERE offer_id = o.id)),
                (SELECT os.installment_count FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1)
              ) AS max_installments
       FROM offers o WHERE o.product_id = ? AND o.active = 1 ORDER BY o.id ASC`
    ).bind(id).all(),
  ]);
  return c.json({
    product: p,
    history: history.results ?? [],
    notifications: notifs.results ?? [],
    baseline,
    stockState,
    stockTransitions: stockTransitions.results ?? [],
    offers: offers.results ?? [],
  });
});

// ---- Faz 5: kargo, taksit ve kapıdaki maliyet ----
api.get('/tax-rules', async (c) => {
  const rules = await c.env.DB.prepare(
    `SELECT rule_code, scenario, origin_region, product_kind, customs_rate, additional_rate,
            exemption_eur, max_value_eur, max_weight_kg, requires_detailed_declaration,
            prohibited, effective_from, effective_to, source_title, source_url, verified_at
     FROM tax_rules ORDER BY scenario, product_kind, origin_region`
  ).all();
  return c.json({ rules: rules.results ?? [] });
});

api.post('/landed-cost/calculate', async (c) => {
  const wait = await limitHit(c.env, `landed:${clientIp(c)}`, 120, 3600);
  if (wait) return c.json({ error: `Çok fazla hesaplama yaptın. ${dakika(wait)} dakika sonra tekrar dene.` }, 429);
  const body = await c.req.json<LandedCostInput>().catch(() => null);
  if (!body) return c.json({ error: 'Geçerli hesaplama verisi gerekli' }, 400);
  try {
    const result = await calculateLandedCost(c.env, body, now());
    return c.json({ result });
  } catch (error: any) {
    return c.json({ error: String(error?.message ?? error) }, 400);
  }
});

api.get('/offers/:id/logistics', async (c) => {
  const id = Number(c.req.param('id'));
  const offer = await c.env.DB.prepare(
    `SELECT id, product_id, marketplace, seller_name, url, origin_country, origin_region
     FROM offers WHERE id = ?`
  ).bind(id).first();
  if (!offer) return c.json({ error: 'Teklif bulunamadı' }, 404);
  const [shipping, installments, landedCost] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM shipping_quotes WHERE offer_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1`
    ).bind(id).first(),
    c.env.DB.prepare(
      `SELECT * FROM installment_options
       WHERE offer_id = ? AND captured_at = (SELECT MAX(captured_at) FROM installment_options WHERE offer_id = ?)
       ORDER BY installment_count ASC`
    ).bind(id, id).all(),
    c.env.DB.prepare(
      `SELECT id, rule_code, status, currency, fx_rate_try, eur_try_rate, item_try, shipping_try,
              tax_try, known_subtotal_try, total_try, breakdown_json, calculated_at
       FROM landed_cost_quotes WHERE offer_id = ? ORDER BY calculated_at DESC, id DESC LIMIT 1`
    ).bind(id).first(),
  ]);
  return c.json({ offer, shipping, installments: installments.results ?? [], landedCost });
});

api.post('/offers/:id/landed-cost', async (c) => {
  const id = Number(c.req.param('id'));
  const exists = await c.env.DB.prepare('SELECT id FROM offers WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'Teklif bulunamadı' }, 404);
  const body = await c.req.json<LandedCostInput>().catch(() => null);
  if (!body) return c.json({ error: 'Geçerli hesaplama verisi gerekli' }, 400);
  try {
    const t = now();
    const result = await calculateLandedCost(c.env, body, t);
    const saved = await c.env.DB.prepare(
      `INSERT INTO landed_cost_quotes
       (offer_id, rule_code, status, currency, fx_rate_try, eur_try_rate, item_try, shipping_try,
        tax_try, known_subtotal_try, total_try, input_json, breakdown_json, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      result.rule.rule_code,
      result.status,
      body.currency,
      body.fxRateTry,
      body.eurTryRate,
      result.itemTry,
      result.shippingTry + result.assumedFreightTry,
      result.taxTry,
      result.knownSubtotalTry,
      result.totalTry,
      JSON.stringify(body),
      JSON.stringify(result),
      t
    ).run();
    return c.json({ id: saved.meta.last_row_id, result });
  } catch (error: any) {
    return c.json({ error: String(error?.message ?? error) }, 400);
  }
});

api.put('/offers/:id/logistics', async (c) => {
  const id = Number(c.req.param('id'));
  const exists = await c.env.DB.prepare('SELECT id FROM offers WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'Teklif bulunamadı' }, 404);
  const body = await c.req.json<any>().catch(() => null);
  if (!body) return c.json({ error: 'Geçerli lojistik verisi gerekli' }, 400);
  const region = ['domestic', 'eu', 'other'].includes(body.origin_region) ? body.origin_region : 'domestic';
  const t = now();
  const shippingCost = body.shipping ? Number(body.shipping.cost) : null;
  if (shippingCost != null && (!Number.isFinite(shippingCost) || shippingCost < 0)) {
    return c.json({ error: 'Geçersiz kargo tutarı' }, 400);
  }
  const installmentRows = Array.isArray(body.installments) ? body.installments.slice(0, 30) : [];
  for (const option of installmentRows) {
    const count = Number(option.installment_count);
    const monthly = Number(option.monthly_amount);
    const total = Number(option.total_amount);
    if (!Number.isInteger(count) || count < 1 || !Number.isFinite(monthly) || monthly < 0 || !Number.isFinite(total) || total < 0) {
      return c.json({ error: 'Geçersiz taksit seçeneği' }, 400);
    }
  }
  await c.env.DB.prepare('UPDATE offers SET origin_country = ?, origin_region = ? WHERE id = ?')
    .bind(body.origin_country ?? null, region, id).run();

  if (body.shipping) {
    await c.env.DB.prepare(
      `INSERT INTO shipping_quotes
       (offer_id, destination_country, cost, currency, free_shipping_threshold,
        min_delivery_days, max_delivery_days, source, captured_at)
       VALUES (?, 'TR', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      shippingCost,
      body.shipping.currency ?? 'TRY',
      body.shipping.free_shipping_threshold ?? null,
      body.shipping.min_delivery_days ?? null,
      body.shipping.max_delivery_days ?? null,
      body.shipping.source ?? 'manual',
      t
    ).run();
  }

  if (installmentRows.length) {
    for (const option of installmentRows) {
      const count = Number(option.installment_count);
      const monthly = Number(option.monthly_amount);
      const total = Number(option.total_amount);
      await c.env.DB.prepare(
        `INSERT INTO installment_options
         (offer_id, provider, card_family, installment_count, monthly_amount, total_amount, currency, interest_rate, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        option.provider ?? null,
        option.card_family ?? null,
        count,
        monthly,
        total,
        option.currency ?? 'TRY',
        option.interest_rate ?? null,
        t
      ).run();
    }
  }
  return c.json({ ok: true, capturedAt: t });
});

// URL onizleme (kaydetmeden once ne bulundugunu goster) — ziyaretciye acik, sinirli
api.post('/preview', async (c) => {
  const wait = await limitHit(c.env, `preview:${clientIp(c)}`, PREVIEW_PER_IP, 3600);
  if (wait) {
    return c.json(
      { error: `Çok fazla deneme yaptın. ${dakika(wait)} dakika sonra tekrar dene.` },
      429,
      { 'retry-after': String(wait) }
    );
  }
  const body = await c.req.json<{ url?: string }>().catch(() => ({}) as any);
  const url = String(body.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return c.json({ error: 'Geçerli bir bağlantı yapıştır (https:// ile başlamalı)' }, 400);
  if (isListingUrl(url)) {
    try {
      let html = '';
      const res = await directFetch(url);
      html = res.html;
      let items = discoverTrendyol(html, 24);
      if (!items.length) {
        try {
          html = await crawleeScrape(url);
        } catch { /* aşağıdaki boş sonuç hatası daha açıklayıcı */ }
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

  const r = await scrapeUrl(url, 'auto');
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
  if (isListingUrl(rawUrl)) return c.json({ error: 'Bu bir liste/kategori sayfası. Tek ürün bağlantısı gerekli, ya da Kategoriler bölümünden ekle.' }, 400);
  const url = canonicalUrl(rawUrl);
  const site = detectSite(url);

  // Ayni urun ikinci kez eklenmez: zaten takipte olani gosteririz, bosuna
  // istek atilmaz (ve sinir tuketilmez).
  const dup = await c.env.DB.prepare('SELECT id FROM products WHERE url = ?').bind(url).first<{ id: number }>();
  if (dup) return c.json({ error: 'Bu ürün zaten takipte', productId: dup.id }, 409);

  // Ziyaretci ekliyorsa sinirlar uygulanir; yonetici muaf.
  const admin = Boolean(c.env.PASSWORD) && (await checkSession(c.env, readSessionCookie(c)));
  if (!admin) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_ACTIVE_PRODUCTS) {
      return c.json({ error: 'Takip listesi şu an dolu, yeni ürün eklenemiyor.' }, 503);
    }
    const ip = clientIp(c);
    const waitIp = await limitHit(c.env, `add:${ip}`, ADD_PER_IP, 3600);
    const waitAll = waitIp ? 0 : await limitHit(c.env, 'add:__all__', ADD_PER_HOUR_ALL, 3600);
    const wait = Math.max(waitIp, waitAll);
    if (wait) {
      return c.json(
        {
          error: waitIp
            ? `Saatte en fazla ${ADD_PER_IP} ürün ekleyebilirsin. ${dakika(wait)} dakika sonra tekrar dene.`
            : `Site şu an yoğun. ${dakika(wait)} dakika sonra tekrar dene.`,
        },
        429,
        { 'retry-after': String(wait) }
      );
    }
  }

  const settings = await getSettings(c.env);
  const t = now();
  const alertMode = ['drop', 'target', 'any', 'off'].includes(String(body.alert_mode)) ? String(body.alert_mode) : 'drop';
  const engine = ['auto', 'direct', 'crawlee'].includes(String(body.engine)) ? String(body.engine) : 'auto';
  const interval = Math.max(5, Math.min(1440, Number(body.interval_min) || Number(settings.default_interval) || 60));
  const target = body.target_price != null && Number(body.target_price) > 0 ? Number(body.target_price) : null;
  const threshold = Math.max(0, Math.min(90, Number(body.threshold_pct) || 0));

  const r = await scrapeUrl(url, engine as any);

  if (!r.ok && !body.force) {
    return c.json({ error: r.error ?? 'Ürün okunamadı', canForce: true }, 422);
  }

  const res = await c.env.DB.prepare(
    `INSERT INTO products (url, site, title, image, currency, category_id, target_price, alert_mode, threshold_pct,
       interval_min, engine, active, current_price, list_price, in_stock, stock_status, min_price, max_price,
       fail_count, last_error, last_engine, last_checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      r.ok && r.inStock != null ? (r.inStock ? 'in_stock' : 'out_of_stock') : 'unknown',
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
  await c.env.DB.prepare(
    `INSERT INTO product_stock_state (product_id, confirmed_status)
     VALUES (?, ?)`
  ).bind(id, r.ok && r.inStock != null ? (r.inStock ? 'in_stock' : 'out_of_stock') : 'unknown').run();
  if (r.ok && r.price != null) {
    await c.env.DB.prepare('INSERT INTO price_history (product_id, price, list_price, in_stock, checked_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, r.price, r.listPrice ?? null, r.inStock == null ? null : r.inStock ? 1 : 0, t)
      .run();
  }
  // dual-write: offer + snapshot (Faz 2)
  try {
    const offerId = await ensureOffer(c.env, { id, url, site }, t);
    if (r.ok && r.price != null) {
      await writeOfferSnapshot(c.env, offerId, {
        price: r.price,
        listPrice: r.listPrice,
        currency: r.currency ?? 'TRY',
        stockStatus: r.inStock == null ? 'unknown' : r.inStock ? 'in_stock' : 'out_of_stock',
        shippingCost: r.shippingCost,
        installmentCount: r.installmentCount,
        engine: r.engine,
        parserVersion: r.parserVersion,
      }, t);
    }
  } catch { /* offer tablosu yoksa sessizce atla */ }

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
     WHERE n.user_id IS NULL
     ORDER BY n.created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return c.json({ notifications: rows.results ?? [] });
});

api.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE read = 0 AND user_id IS NULL').run();
  return c.json({ ok: true });
});

api.post('/notifications/:id/read', async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id IS NULL').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

api.delete('/notifications', async (c) => {
  await c.env.DB.prepare('DELETE FROM notifications WHERE user_id IS NULL').run();
  return c.json({ ok: true });
});

// ---- ayarlar ----
// Gizli alanlar istemciye ACIK METIN gitmez; sadece "tanimli mi" bilgisi ve
// tanimak icin maskeli bir onizleme doner. Kaydetmede maskeli deger gelirse
// (kullanici alana dokunmamissa) mevcut deger korunur.
const SECRET_SETTINGS = ['telegram_token'] as const;
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
    has: { telegram_token: Boolean(s.telegram_token) },
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

// ---- kullanıcı hesap sistemi (Faz 2) ----

const USER_SESSION_COOKIE = 'gfr_u';
const USER_SESSION_COOKIE_HOST = '__Host-gfr_u';
const userCookieName = (c: { req: { url: string } }) => (isHttps(c) ? USER_SESSION_COOKIE_HOST : USER_SESSION_COOKIE);
const readUserCookie = (c: Parameters<typeof getCookie>[0]) =>
  getCookie(c, USER_SESSION_COOKIE_HOST) ?? getCookie(c, USER_SESSION_COOKIE);

async function getUserFromSession(env: Env, cookie: string | undefined | null): Promise<{ id: number; email: string; role: string } | null> {
  if (!cookie) return null;
  const t = now();
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?'
  ).bind(cookie, t).first<{ id: number; email: string; role: string }>();
  return row ?? null;
}

api.post('/auth/register', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; display_name?: string; kvkk_consent?: boolean }>().catch(() => ({}) as any);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !/@/.test(email)) return c.json({ error: 'Geçerli bir e-posta adresi gerekli' }, 400);
  if (password.length < 8) return c.json({ error: 'Parola en az 8 karakter olmalı' }, 400);
  if (!body.kvkk_consent) return c.json({ error: 'KVKK aydınlatma metnini onaylamanız gerekli' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Bu e-posta ile zaten bir hesap var' }, 409);

  const t = now();
  const hash = await hashPassword(password);
  const res = await c.env.DB.prepare(
    `INSERT INTO users (email, password_hash, display_name, role, kvkk_consent, kvkk_consent_at, created_at)
     VALUES (?, ?, ?, 'user', 1, ?, ?)`
  ).bind(email, hash, body.display_name ?? null, t, t).run();
  const userId = res.meta.last_row_id as number;

  const sessionId = generateSessionId();
  const expiresAt = t + SESSION_MAX_AGE_S;
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(sessionId, userId, expiresAt, t).run();

  setCookie(c, userCookieName(c), sessionId, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return c.json({ ok: true, userId });
});

api.post('/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as any);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return c.json({ error: 'E-posta ve parola gerekli' }, 400);

  const ip = clientIp(c);
  const limited = await hitRateLimit(c.env, ip);
  if (limited) return c.json({ error: `Çok fazla deneme. ${limited} saniye sonra tekrar dene.` }, 429, { 'retry-after': String(limited) });

  const user = await c.env.DB.prepare('SELECT id, password_hash, role FROM users WHERE email = ?').bind(email).first<{ id: number; password_hash: string; role: string }>();
  await new Promise((r) => setTimeout(r, 350));
  if (!user || !(await verifyPassword(user.password_hash, password))) return c.json({ error: 'E-posta veya parola yanlış' }, 401);

  await clearRateLimit(c.env, ip);
  const t = now();
  const sessionId = generateSessionId();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(sessionId, user.id, t + SESSION_MAX_AGE_S, t).run();

  setCookie(c, userCookieName(c), sessionId, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return c.json({ ok: true, userId: user.id, role: user.role });
});

api.post('/auth/logout', async (c) => {
  const sid = readUserCookie(c);
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  deleteCookie(c, USER_SESSION_COOKIE_HOST, { path: '/' });
  deleteCookie(c, USER_SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

api.get('/auth/me', async (c) => {
  const user = await getUserFromSession(c.env, readUserCookie(c));
  if (!user) return c.json({ authed: false });
  return c.json({ authed: true, user: { id: user.id, email: user.email, role: user.role } });
});

api.get('/auth/notifications', async (c) => {
  const user = await getUserFromSession(c.env, readUserCookie(c));
  if (!user) return c.json({ error: 'Oturum gerekli' }, 401);
  const rows = await c.env.DB.prepare(
    `SELECT n.*, p.title AS product_title, p.url AS product_url
     FROM notifications n LEFT JOIN products p ON p.id = n.product_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`
  ).bind(user.id).all();
  return c.json({ notifications: rows.results ?? [] });
});

api.post('/auth/notifications/read-all', async (c) => {
  const user = await getUserFromSession(c.env, readUserCookie(c));
  if (!user) return c.json({ error: 'Oturum gerekli' }, 401);
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').bind(user.id).run();
  return c.json({ ok: true });
});

// ---- watches (kullanıcı takip listesi) ----

api.get('/watches', async (c) => {
  const user = await getUserFromSession(c.env, readUserCookie(c));
  if (!user) return c.json({ error: 'Oturum gerekli' }, 401);
  const rows = await c.env.DB.prepare(
    `SELECT w.*, p.title, p.site, p.current_price, p.currency, p.in_stock, p.image
     FROM watches w JOIN products p ON p.id = w.product_id
     WHERE w.user_id = ? AND w.active = 1 ORDER BY w.created_at DESC`
  ).bind(user.id).all();
  return c.json({ watches: rows.results ?? [] });
});

api.post('/watches', async (c) => {
  const user = await getUserFromSession(c.env, readUserCookie(c));
  if (!user) return c.json({ error: 'Oturum gerekli' }, 401);
  const body = await c.req.json<{ product_id?: number; target_price?: number; threshold_pct?: number }>().catch(() => ({}) as any);
  const productId = Number(body.product_id);
  if (!productId) return c.json({ error: 'product_id gerekli' }, 400);

  const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
  if (!product) return c.json({ error: 'Ürün bulunamadı' }, 404);

  const existing = await c.env.DB.prepare('SELECT id FROM watches WHERE user_id = ? AND product_id = ?').bind(user.id, productId).first();
  if (existing) return c.json({ error: 'Bu ürün zaten takip listende' }, 409);

  const t = now();
  const res = await c.env.DB.prepare(
    `INSERT INTO watches (user_id, product_id, target_price, threshold_pct, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(user.id, productId, body.target_price ?? null, body.threshold_pct ?? 0, t).run();
  return c.json({ ok: true, watchId: res.meta.last_row_id });
});

api.delete('/watches/:id', async (c) => {
  const user = await getUserFromSession(c.env, readUserCookie(c));
  if (!user) return c.json({ error: 'Oturum gerekli' }, 401);
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM watches WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  return c.json({ ok: true });
});

export default api;
