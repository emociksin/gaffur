// Kontrol hatti: direct → Crawlee → Firecrawl (gecici fallback) → parser → fiyat/bildirim
import type { Env } from '../env';
import type { AppSettings, Engine, Product, ScrapeResult } from '../../shared/types';
import { canonicalUrl, detectSite, discoverTrendyol } from './sites';
import { fmtMoney } from './price';
import { ensureOffer, getSettings, insertNotification, now, writeOfferSnapshot } from '../db';
import { escTg, sendTelegram, tgLink } from '../telegram';
import { readCapped, safeFetch, SsrfError } from './ssrf';
import { crawleeFetch } from './crawlee';
import { parseWithRegistry, TRENDYOL_LISTING_PARSER_VERSION } from './registry';
import { recordParserOutcome } from './parser-health';
import { calculatePriceBaseline, savePriceBaseline } from '../intelligence/price-baseline';
import {
  applyStockObservation,
  stockStatusFromBoolean,
  stockStatusToLegacy,
  type StockStatus,
} from '../intelligence/stock';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FETCH_HEADERS: Record<string, string> = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  'upgrade-insecure-requests': '1',
};

// SSRF-guvenli, timeout'lu, boyut-tavanli fetch. Redirect'ler manuel dogrulanir.
export async function directFetch(url: string): Promise<{ status: number; html: string }> {
  const res = await safeFetch(url, FETCH_HEADERS);
  const html = await readCapped(res);
  return { status: res.status, html };
}

export async function crawleeScrape(url: string): Promise<string> {
  return (await crawleeFetch(url, FETCH_HEADERS)).html;
}

export { SsrfError };

function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const head = html.slice(0, 6000);
  if (/cf-browser-verification|cf-chl|_Incapsula_|captcha|Access Denied|Bot Y[oö]netimi|PerimeterX|akamai/i.test(head))
    return true;
  if (html.length < 1500) return true;
  return false;
}

/** Tek URL'yi coz: motor sirasina gore dener, ilk fiyat bulan kazanir */
export async function scrapeUrl(rawUrl: string, engine: Engine): Promise<ScrapeResult> {
  const url = canonicalUrl(rawUrl);
  const site = detectSite(url);
  const base: ScrapeResult = { ok: false, url, site };
  let directNote = '';
  let blocked = false;
  let lastParserVersion: string | undefined;

  if (engine !== 'crawlee') {
    try {
      const { status, html } = await directFetch(url);
      const parsed = parseWithRegistry(site, html);
      const ext = parsed.data;
      lastParserVersion = parsed.parserVersion;
      if (!(ext as any).blocked && status < 400 && ext.price != null) {
        return {
          ...base,
          ok: true,
          engine: 'direct',
          parserVersion: parsed.parserVersion,
          title: ext.title,
          image: ext.image,
          price: ext.price,
          listPrice: ext.listPrice,
          currency: ext.currency ?? 'TRY',
          inStock: ext.inStock,
        };
      }
      blocked = Boolean((ext as any).blocked) || looksBlocked(status, html);
      directNote = blocked ? 'bot koruması' : status >= 400 ? `HTTP ${status}` : 'fiyat bulunamadı';
      if (!blocked && ext.title && engine === 'direct') {
        // sayfa acildi ama fiyat yok — kullaniciya net soyle
        return { ...base, title: ext.title, parserVersion: parsed.parserVersion, error: 'Sayfa açıldı ama fiyat bulunamadı' };
      }
    } catch (e: any) {
      // SSRF ihlali: URL guvensiz, fallback transport'a iletme.
      if (e instanceof SsrfError) {
        return { ...base, error: 'Bu adres güvenlik nedeniyle çekilemez' };
      }
      blocked = true;
      directNote = e?.message ? String(e.message).slice(0, 120) : 'bağlantı hatası';
    }
  }

  if (engine === 'crawlee' || (engine === 'auto' && (blocked || directNote))) {
    try {
      const { status, html } = await crawleeFetch(url, FETCH_HEADERS);
      const parsed = parseWithRegistry(site, html);
      const ext = parsed.data;
      lastParserVersion = parsed.parserVersion;
      if (!(ext as any).blocked && status < 400 && ext.price != null) {
        return {
          ...base,
          ok: true,
          engine: 'crawlee',
          parserVersion: parsed.parserVersion,
          title: ext.title,
          image: ext.image,
          price: ext.price,
          listPrice: ext.listPrice,
          currency: ext.currency ?? 'TRY',
          inStock: ext.inStock,
        };
      }
      directNote = looksBlocked(status, html) ? 'Crawlee bot koruması' : `Crawlee fiyat bulamadı (HTTP ${status})`;
    } catch (e: any) {
      if (e instanceof SsrfError) return { ...base, error: 'Bu adres güvenlik nedeniyle çekilemez' };
      directNote = `Crawlee: ${String(e?.message ?? e).slice(0, 120)}`;
    }
  }

  return { ...base, parserVersion: lastParserVersion, error: `Siteye erişilemedi (${directNote})` };
}

// ---- fiyat guncelleme + alarm ----

export interface CheckOutcome {
  ok: boolean;
  price?: number;
  changed: boolean;
  notified: boolean;
  error?: string;
}

async function lastHistoryAt(env: Env, productId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT checked_at FROM price_history WHERE product_id = ? ORDER BY checked_at DESC LIMIT 1'
  )
    .bind(productId)
    .first<{ checked_at: number }>();
  return row?.checked_at ?? 0;
}

function pctDrop(oldP: number, newP: number): number {
  return ((oldP - newP) / oldP) * 100;
}

const NOTIF_COOLDOWN_S = 6 * 3600;

async function isDuplicate(env: Env, productId: number, kind: string, t: number): Promise<boolean> {
  const since = t - NOTIF_COOLDOWN_S;
  const row = await env.DB.prepare(
    'SELECT 1 FROM notifications WHERE product_id = ? AND user_id IS NULL AND kind = ? AND created_at >= ? LIMIT 1'
  )
    .bind(productId, kind, since)
    .first();
  return row != null;
}

async function notify(
  env: Env,
  settings: AppSettings,
  p: Product,
  kind: string,
  title: string,
  body: string,
  oldPrice: number | null,
  newPrice: number | null,
  tgHtml: string | null
): Promise<void> {
  if (await isDuplicate(env, p.id, kind, now())) return;
  let sent = false;
  if (tgHtml && settings.telegram_token && settings.telegram_chat) {
    sent = await sendTelegram(settings.telegram_token, settings.telegram_chat, tgHtml);
  }
  await insertNotification(env, {
    product_id: p.id,
    kind,
    title,
    body,
    old_price: oldPrice,
    new_price: newPrice,
    sent_telegram: sent,
  });
}

interface ActiveWatch {
  id: number;
  user_id: number;
  target_price: number | null;
  alert_mode: string;
  threshold_pct: number;
}

async function notifyWatches(
  env: Env,
  p: Product,
  oldPrice: number | null,
  referencePrice: number | null,
  price: number,
  stockChanged: boolean,
  backInStock: boolean,
  t: number
): Promise<boolean> {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, target_price, alert_mode, threshold_pct
     FROM watches WHERE product_id = ? AND active = 1 AND user_id IS NOT NULL`
  ).bind(p.id).all<ActiveWatch>();
  let emitted = false;
  for (const watch of rows.results ?? []) {
    if (watch.alert_mode === 'off') continue;
    let kind: 'target' | 'drop' | 'stock' | null = null;
    let title = '';

    if (stockChanged && backInStock) {
      kind = 'stock';
      title = 'Takip ettiğin ürün tekrar stokta';
    } else if (oldPrice != null && watch.target_price != null && price <= watch.target_price && oldPrice > watch.target_price) {
      kind = 'target';
      title = 'Takip ettiğin ürün hedef fiyata indi';
    } else if (
      referencePrice != null &&
      price < referencePrice &&
      (watch.alert_mode === 'drop' || watch.alert_mode === 'any') &&
      pctDrop(referencePrice, price) >= Math.max(2, watch.threshold_pct || 0)
    ) {
      kind = 'drop';
      title = `Takip ettiğin ürünün fiyatı düştü (%${pctDrop(referencePrice, price).toFixed(1)})`;
    }
    if (!kind) continue;

    const duplicate = await env.DB.prepare(
      'SELECT 1 FROM notifications WHERE watch_id = ? AND kind = ? AND created_at >= ? LIMIT 1'
    ).bind(watch.id, kind, t - NOTIF_COOLDOWN_S).first();
    if (duplicate) continue;

    await insertNotification(env, {
      user_id: watch.user_id,
      watch_id: watch.id,
      product_id: p.id,
      kind,
      title,
      body: p.title,
      old_price: oldPrice,
      new_price: price,
    });
    emitted = true;
  }

  return emitted;
}

/**
 * Yeni fiyat bilgisini uygular: urun satirini gunceller, gecmise yazar, alarmlari degerlendirir.
 * Hem tekil kontrol (checkProduct) hem liste guncellemesi (refreshListing) bunu kullanir.
 */
export async function applyPriceUpdate(
  env: Env,
  settings: AppSettings,
  p: Product,
  r: { price: number; listPrice?: number | null; inStock?: boolean | null; engine: string; parserVersion?: string; title?: string; image?: string },
  t: number
): Promise<CheckOutcome> {
  const oldPrice = p.current_price;
  const price = r.price;
  const changed = oldPrice != null && Math.abs(oldPrice - price) >= 0.01;
  const currentStockStatus: StockStatus = p.stock_status ?? (p.in_stock == null ? 'unknown' : p.in_stock ? 'in_stock' : 'out_of_stock');
  const stock = await applyStockObservation(env, p.id, currentStockStatus, stockStatusFromBoolean(r.inStock), t);
  const newStock = stockStatusToLegacy(stock.confirmedStatus);
  const countsForPrice = stock.confirmedStatus !== 'out_of_stock';
  const newMin = countsForPrice ? (p.min_price == null ? price : Math.min(p.min_price, price)) : p.min_price;
  const newMax = countsForPrice ? (p.max_price == null ? price : Math.max(p.max_price, price)) : p.max_price;
  const baselineBefore = await calculatePriceBaseline(env, p.id, t);
  const referencePrice = baselineBefore.median_30d ?? oldPrice;

  await env.DB.prepare(
    `UPDATE products SET
       current_price = ?, previous_price = ?, list_price = ?, in_stock = ?, stock_status = ?,
       min_price = ?, max_price = ?, fail_count = 0, last_error = NULL,
       last_engine = ?, last_checked_at = ?, last_change_at = ?,
       title = CASE WHEN ? != '' THEN ? ELSE title END,
       image = COALESCE(?, image)
     WHERE id = ?`
  )
    .bind(
      price,
      changed ? oldPrice : p.previous_price,
      r.listPrice ?? null,
      newStock,
      stock.confirmedStatus,
      newMin,
      newMax,
      r.engine,
      t,
      changed ? t : p.last_change_at,
      r.title ?? '',
      r.title ?? '',
      r.image ?? null,
      p.id
    )
    .run();

  // gecmis: degisince her zaman; degismediyse 6 saatte bir nokta (grafik surekliligi)
  const lastAt = await lastHistoryAt(env, p.id);
  if (changed || t - lastAt >= 6 * 3600) {
    await env.DB.prepare(
      'INSERT INTO price_history (product_id, price, list_price, in_stock, checked_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(p.id, price, r.listPrice ?? null, newStock, t)
      .run();
  }

  await savePriceBaseline(env, await calculatePriceBaseline(env, p.id, t));

  // dual-write: offer + snapshot (Faz 2)
  try {
    const offerId = await ensureOffer(env, { id: p.id, url: p.url, site: p.site }, t);
    const stockMap: Record<number, string> = { 1: 'in_stock', 0: 'out_of_stock' };
    await writeOfferSnapshot(env, offerId, {
      price,
      listPrice: r.listPrice,
      currency: p.currency ?? 'TRY',
      stockStatus: newStock == null ? 'unknown' : (stockMap[newStock] ?? 'unknown'),
      engine: r.engine,
      parserVersion: r.parserVersion,
    }, t);
  } catch { /* offer tablosu yoksa (eski DB) sessizce atla */ }

  let notified = false;
  const cur = p.currency || 'TRY';
  const link = tgLink(p.url, p.title || 'Ürün');

  // stok degisimi bildirimi
  if (settings.notify_stock === '1' && stock.transitioned && stock.toStatus != null) {
    const backIn = stock.toStatus === 'in_stock';
    await notify(
      env,
      settings,
      p,
      'stock',
      backIn ? 'Tekrar stokta' : 'Stok tükendi',
      p.title,
      oldPrice,
      price,
      `${backIn ? '● Tekrar stokta' : '○ Stok tükendi'}\n${link}\nFiyat: <b>${fmtMoney(price, cur)}</b>`
    );
    notified = true;
  }

  if (changed && oldPrice != null) {
    const drop = referencePrice != null && price < referencePrice;
    const pct = referencePrice != null ? Math.abs(pctDrop(referencePrice, price)) : 0;
    const materialMove = pct >= 2;
    const pctTxt = `%${pct.toFixed(pct >= 10 ? 0 : 1)}`;
    const priceLine = `${fmtMoney(oldPrice, cur)} → <b>${fmtMoney(price, cur)}</b>`;
    const minLine = newMin != null && newMin < price ? `\nEn düşük: ${fmtMoney(newMin, cur)}` : '\nŞu an en düşük fiyatında';

    const mode = p.alert_mode;
    const hitTarget = p.target_price != null && price <= p.target_price && oldPrice > p.target_price;

    if (mode !== 'off' && hitTarget) {
      await notify(
        env,
        settings,
        p,
        'target',
        `Hedef fiyata indi (${pctTxt})`,
        p.title,
        oldPrice,
        price,
        `◎ <b>Hedef fiyata indi</b>\n${link}\n${priceLine}\nHedefin: ${fmtMoney(p.target_price, cur)}${minLine}`
      );
      notified = true;
    } else if (materialMove && (mode === 'any' || (mode === 'drop' && drop && pct >= Math.max(2, p.threshold_pct || 0)))) {
      if (drop || mode === 'any') {
        const kind = drop ? 'drop' : 'rise';
        if (drop || settings.notify_rise === '1' || mode === 'any') {
          await notify(
            env,
            settings,
            p,
            kind,
            drop ? `Fiyat düştü (${pctTxt})` : `Fiyat arttı (${pctTxt})`,
            p.title,
            oldPrice,
            price,
            `${drop ? '▼' : '▲'} <b>${drop ? 'Fiyat düştü' : 'Fiyat arttı'} ${pctTxt}</b>\n${link}\n${priceLine}${minLine}`
          );
          notified = true;
        }
      }
    }
  }

  if (await notifyWatches(env, p, oldPrice, referencePrice, price, stock.transitioned, stock.toStatus === 'in_stock', t)) notified = true;

  return { ok: true, price, changed, notified };
}

/** Tek urunu bastan sona kontrol et */
export async function checkProduct(env: Env, p: Product, settings?: AppSettings): Promise<CheckOutcome> {
  const s = settings ?? (await getSettings(env));
  const t = now();
  const r = await scrapeUrl(p.url, p.engine);
  if (r.parserVersion) await recordParserOutcome(env, r.site, r.parserVersion, r.ok && r.price != null, t);

  if (!r.ok || r.price == null) {
    const failCount = (p.fail_count ?? 0) + 1;
    await env.DB.prepare('UPDATE products SET fail_count = ?, last_error = ?, last_checked_at = ? WHERE id = ?')
      .bind(failCount, r.error ?? 'Bilinmeyen hata', t, p.id)
      .run();
    if (failCount === 3) {
      await notify(
        env,
        s,
        p,
        'error',
        'Ürün kontrol edilemiyor',
        `${p.title} — ${r.error ?? ''} (3 denemedir başarısız)`,
        null,
        null,
        null
      );
    }
    return { ok: false, changed: false, notified: false, error: r.error };
  }

  return applyPriceUpdate(
    env,
    s,
    p,
    {
      price: r.price,
      listPrice: r.listPrice ?? null,
      inStock: r.inStock ?? null,
      engine: r.engine ?? 'direct',
      parserVersion: r.parserVersion,
      title: r.title,
      image: r.image,
    },
    t
  );
}

// ---- kategori (liste sayfasi) takibi ----

export interface ListingRefreshResult {
  ok: boolean;
  found: number;
  added: number;
  updated: number;
  error?: string;
}

/** Kategori kaynak URL'sini ceker, yeni urunleri ekler, mevcutlarin fiyatini toplu gunceller */
export async function refreshListing(
  env: Env,
  category: { id: number; name: string; source_url: string | null },
  settings: AppSettings,
  maxNew = 30
): Promise<ListingRefreshResult> {
  if (!category.source_url) return { ok: false, found: 0, added: 0, updated: 0, error: 'Kaynak URL yok' };
  const t = now();
  let html = '';
  try {
    const res = await directFetch(category.source_url);
    if (looksBlocked(res.status, res.html)) {
      html = await crawleeScrape(category.source_url);
    } else {
      html = res.html;
    }
  } catch (e: any) {
    try {
      html = await crawleeScrape(category.source_url);
    } catch (crawlError: any) {
      return { ok: false, found: 0, added: 0, updated: 0, error: String(crawlError?.message ?? e).slice(0, 160) };
    }
  }

  const items = discoverTrendyol(html, maxNew);
  await recordParserOutcome(env, 'trendyol-listing', TRENDYOL_LISTING_PARSER_VERSION, items.length > 0, t);
  if (!items.length) {
    await env.DB.prepare('UPDATE categories SET last_discovered_at = ? WHERE id = ?').bind(t, category.id).run();
    return { ok: false, found: 0, added: 0, updated: 0, error: 'Listede ürün bulunamadı (sayfa yapısı değişmiş olabilir)' };
  }

  let added = 0;
  let updated = 0;
  const newTitles: string[] = [];

  for (const item of items) {
    const url = canonicalUrl(item.url);
    const existing = await env.DB.prepare('SELECT * FROM products WHERE url = ?').bind(url).first<Product>();
    if (existing) {
      if (item.price != null && existing.active) {
        await applyPriceUpdate(
          env,
          settings,
          existing,
          { price: item.price, inStock: item.inStock ?? null, engine: 'listing', title: item.title, image: item.image ?? undefined },
          t
        );
        updated++;
      }
      continue;
    }
    if (added >= maxNew) continue;
    const site = detectSite(url);
    const itemStock = item.inStock == null ? null : item.inStock ? 1 : 0;
    const res = await env.DB.prepare(
      `INSERT INTO products (url, site, title, image, currency, category_id, interval_min, engine, active,
        current_price, min_price, max_price, in_stock, stock_status, last_engine, last_checked_at, created_at)
       VALUES (?, ?, ?, ?, 'TRY', ?, 720, 'auto', 1, ?, ?, ?, ?, ?, 'listing', ?, ?)`
    )
      .bind(
        url,
        site,
        item.title,
        item.image,
        category.id,
        item.price,
        item.price,
        item.price,
        itemStock,
        itemStock == null ? 'unknown' : itemStock ? 'in_stock' : 'out_of_stock',
        t,
        t
      )
      .run();
    const newId = res.meta.last_row_id as number;
    await env.DB.prepare(
      'INSERT INTO product_stock_state (product_id, confirmed_status) VALUES (?, ?)'
    ).bind(newId, itemStock == null ? 'unknown' : itemStock ? 'in_stock' : 'out_of_stock').run();
    if (item.price != null) {
      await env.DB.prepare(
        'INSERT INTO price_history (product_id, price, in_stock, checked_at) VALUES (?, ?, ?, ?)'
      )
        .bind(newId, item.price, itemStock, t)
        .run();
    }
    added++;
    if (newTitles.length < 5) newTitles.push(item.title);
  }

  await env.DB.prepare('UPDATE categories SET last_discovered_at = ? WHERE id = ?').bind(t, category.id).run();

  if (added > 0) {
    let sent = false;
    const body = newTitles.join(' • ') + (added > newTitles.length ? ` … (+${added - newTitles.length})` : '');
    if (settings.telegram_token && settings.telegram_chat) {
      sent = await sendTelegram(
        settings.telegram_token,
        settings.telegram_chat,
        `◈ <b>${escTg(category.name)}</b> kategorisine ${added} yeni ürün eklendi\n${escTg(body)}`
      );
    }
    await insertNotification(env, {
      kind: 'new_product',
      title: `${category.name}: ${added} yeni ürün keşfedildi`,
      body,
      sent_telegram: sent,
    });
  }

  return { ok: true, found: items.length, added, updated };
}
