// Site tespiti, URL kanonlastirma, site-ozel cikarim adaptorleri ve kategori kesfi
import { bracedJson, decodeEntities, extractGeneric, extractJsonLd, type Extracted } from './parse';
import { parsePrice, sanePrice } from './price';
import type { DiscoveredItem } from '../../shared/types';

export type SiteId = 'trendyol' | 'hepsiburada' | 'amazon' | 'n11' | string;

export function detectSite(url: string): SiteId {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes('trendyol.com')) return 'trendyol';
    if (h.includes('hepsiburada.com')) return 'hepsiburada';
    if (h.includes('amazon.')) return 'amazon';
    if (h.includes('n11.com')) return 'n11';
    return h.replace(/^www\./, '');
  } catch {
    return 'bilinmiyor';
  }
}

const TRACKING_PARAMS = /^(utm_|gclid|fbclid|adjust_|ref_|mc_|pk_|_ga)/i;

export function canonicalUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }
  const site = detectSite(rawUrl);
  if (site === 'amazon') {
    const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (m) return `${u.origin}/dp/${m[1].toUpperCase()}`;
  }
  if (site === 'trendyol' || site === 'hepsiburada' || site === 'n11') {
    return u.origin + u.pathname;
  }
  // genel: takip parametrelerini temizle
  const keep = new URLSearchParams();
  u.searchParams.forEach((v, k) => {
    if (!TRACKING_PARAMS.test(k)) keep.append(k, v);
  });
  const q = keep.toString();
  return u.origin + u.pathname + (q ? `?${q}` : '');
}

function cdnImage(img: string | undefined | null): string | undefined {
  if (!img) return undefined;
  if (img.startsWith('http')) return img;
  if (img.startsWith('/')) return 'https://cdn.dsmcdn.com' + img;
  return undefined;
}

// ---- Trendyol ----

function extractTrendyol(html: string): Extracted {
  const out: Extracted = {};
  const st = bracedJson(html, '__PRODUCT_DETAIL_APP_INITIAL_STATE__');
  const p = st?.product;
  if (p) {
    const brand = p.brand?.name ?? '';
    const name = p.name ?? '';
    const t = `${brand} ${name}`.trim();
    if (t) out.title = decodeEntities(t);
    const pr = p.price ?? {};
    out.price =
      sanePrice(parsePrice(pr.discountedPrice?.value ?? pr.sellingPrice?.value ?? pr.value)) ?? undefined;
    out.listPrice = sanePrice(parsePrice(pr.originalPrice?.value)) ?? undefined;
    const img = Array.isArray(p.images) ? p.images[0] : undefined;
    out.image = cdnImage(typeof img === 'string' ? img : img?.url);
    if (typeof p.hasStock === 'boolean') out.inStock = p.hasStock;
    else if (typeof p.inStock === 'boolean') out.inStock = p.inStock;
    out.currency = 'TRY';
  }
  if (out.price == null) {
    const g = extractGeneric(html);
    return { ...g, ...out, price: out.price ?? g.price, image: out.image ?? g.image, title: out.title ?? g.title };
  }
  return out;
}

/** Trendyol kategori/arama sayfasindan urun listesi kesfi.
 *  2026 mimarisi: window["__single-search-result__PROPS"].data.products
 *  (eski __SEARCH_APP_INITIAL_STATE__ yedek olarak denenir) */
export function discoverTrendyol(html: string, limit = 24): DiscoveredItem[] {
  const st =
    bracedJson(html, '__single-search-result__PROPS') ?? bracedJson(html, '__SEARCH_APP_INITIAL_STATE__');
  const products: any[] = st?.data?.products ?? st?.products ?? st?.searchResult?.products ?? [];
  const items: DiscoveredItem[] = [];
  for (const p of products.slice(0, limit)) {
    if (!p?.url) continue;
    let href: string = String(p.url);
    href = href.split('?')[0];
    if (!href.startsWith('http')) href = 'https://www.trendyol.com' + (href.startsWith('/') ? href : '/' + href);
    const brand = p.brand?.name ?? p.brand ?? '';
    const name = p.name ?? '';
    const title = decodeEntities(`${typeof brand === 'string' ? brand : ''} ${name}`.trim()) || href;
    const pr = p.price ?? {};
    const price =
      sanePrice(parsePrice(pr.discountedPrice ?? pr.current ?? pr.sellingPrice ?? pr.originalPrice ?? pr.value)) ??
      null;
    const img = Array.isArray(p.images) ? p.images[0] : undefined;
    const inStock = typeof p.hasStock === 'boolean' ? p.hasStock : typeof p.inStock === 'boolean' ? p.inStock : null;
    items.push({ url: href, title, price, image: cdnImage(typeof img === 'string' ? img : img?.url) ?? null, inStock });
  }
  return items;
}

/** Bu URL bir urun listesi sayfasi mi (kategori/arama)? */
export function isListingUrl(url: string): boolean {
  const site = detectSite(url);
  if (site !== 'trendyol') return false;
  try {
    const u = new URL(url);
    if (/-p-\d+/.test(u.pathname)) return false; // urun detay
    return /-x-[cbg]\d+/.test(u.pathname) || u.pathname.startsWith('/sr') || u.searchParams.has('q');
  } catch {
    return false;
  }
}

// ---- Hepsiburada ----

function extractHepsiburada(html: string): Extracted {
  const out = extractGeneric(html);
  if (out.price == null) {
    // HB gomulu state: "price":{"value":1299.9,...}
    const m = html.match(/"price"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/i);
    if (m) out.price = sanePrice(parseFloat(m[1])) ?? undefined;
  }
  if (out.currency == null) out.currency = 'TRY';
  return out;
}

// ---- Amazon ----

function amazonWindow(html: string, anchor: string, span = 4000): string | null {
  const i = html.indexOf(anchor);
  if (i < 0) return null;
  return html.slice(i, i + span);
}

function extractAmazon(html: string): Extracted & { blocked?: boolean } {
  if (/api-services-support@amazon\.com|Robot Check|captcha/i.test(html.slice(0, 20000)) && html.length < 60000) {
    return { blocked: true };
  }
  const out: Extracted = { currency: 'TRY' };
  const tm = html.match(/id="productTitle"[^>]*>\s*([\s\S]{0,400}?)\s*</);
  if (tm) out.title = decodeEntities(tm[1].replace(/\s+/g, ' ').trim());
  const core =
    amazonWindow(html, 'id="corePriceDisplay') ??
    amazonWindow(html, 'id="corePrice_feature_div') ??
    amazonWindow(html, 'id="apex_desktop') ??
    html;
  const pm = core.match(/class="a-offscreen"[^>]*>\s*([^<]{1,40})</);
  if (pm) out.price = sanePrice(parsePrice(pm[1])) ?? undefined;
  const lm = core.match(/class="a-price a-text-price"[\s\S]{0,300}?class="a-offscreen"[^>]*>\s*([^<]{1,40})</);
  if (lm) out.listPrice = sanePrice(parsePrice(lm[1])) ?? undefined;
  const av = amazonWindow(html, 'id="availability"', 1200);
  if (av) out.inStock = /stokta|in stock|stok var/i.test(av.replace(/<[^>]+>/g, ' '));
  const im = html.match(/id="landingImage"[^>]*src="([^"]+)"/) ?? html.match(/"hiRes"\s*:\s*"(https[^"]+)"/);
  if (im) out.image = im[1];
  if (out.price == null) {
    const g = extractGeneric(html);
    out.price = g.price;
    out.title = out.title ?? g.title;
    out.image = out.image ?? g.image;
  }
  return out;
}

// ---- N11 ----

function extractN11(html: string): Extracted {
  const out = extractGeneric(html);
  if (out.price == null) {
    const m = html.match(/class="newPrice"[\s\S]{0,200}?content="([\d.,]+)"/i) ?? html.match(/class="newPrice"[\s\S]{0,200}?>\s*([\d.,]+)\s*TL/i);
    if (m) out.price = sanePrice(parsePrice(m[1])) ?? undefined;
  }
  if (out.currency == null) out.currency = 'TRY';
  return out;
}

// ---- dispatch ----

export function extractForSite(site: SiteId, html: string): Extracted & { blocked?: boolean } {
  switch (site) {
    case 'trendyol':
      return extractTrendyol(html);
    case 'hepsiburada':
      return extractHepsiburada(html);
    case 'amazon':
      return extractAmazon(html);
    case 'n11':
      return extractN11(html);
    default:
      return extractGeneric(html);
  }
}

export function siteLabel(site: SiteId): string {
  switch (site) {
    case 'trendyol':
      return 'Trendyol';
    case 'hepsiburada':
      return 'Hepsiburada';
    case 'amazon':
      return 'Amazon';
    case 'n11':
      return 'N11';
    default:
      return site;
  }
}

// JSON-LD disari da lazim olabildigi icin re-export
export { extractJsonLd };
