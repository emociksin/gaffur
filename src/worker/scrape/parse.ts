// HTML'den urun bilgisi cikarma — genel katman (JSON-LD, meta, gomulu JSON, baglamsal regex)
import { parsePrice, detectCurrency, sanePrice } from './price';

export interface Extracted {
  title?: string;
  image?: string;
  price?: number;
  listPrice?: number;
  currency?: string;
  inStock?: boolean;
}

// ---- yardimcilar ----

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** marker'dan sonraki ilk { ... } blogunu string-farkindalikli brace sayarak cikarir */
export function bracedJson(html: string, marker: string): any | null {
  const mi = html.indexOf(marker);
  if (mi < 0) return null;
  const start = html.indexOf('{', mi);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length && i < start + 3_000_000; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
      'i'
    );
    const m = html.match(re);
    if (m) {
      const c = m[0].match(/content=["']([^"']*)["']/i);
      if (c && c[1]) return decodeEntities(c[1]);
    }
  }
  return null;
}

export function titleFromHtml(html: string): string | null {
  const og = metaContent(html, ['og:title']);
  if (og) return og;
  const t = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (t) {
    let s = decodeEntities(t[1].replace(/\s+/g, ' ').trim());
    // "Urun Adi - Site" kuyrugunu kirp
    s = s.replace(/\s*[|\-–]\s*(?:Trendyol|Hepsiburada|Amazon\.com\.tr|n11\.com|n11|Amazon)\s*$/i, '');
    return s || null;
  }
  return null;
}

// ---- JSON-LD ----

function walkForProduct(node: any, out: any[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkForProduct(n, out);
    return;
  }
  const t = node['@type'];
  const types = Array.isArray(t) ? t : t ? [t] : [];
  if (types.some((x) => typeof x === 'string' && x.toLowerCase() === 'product')) out.push(node);
  if (node['@graph']) walkForProduct(node['@graph'], out);
}

export function extractJsonLd(html: string): Extracted | null {
  const products: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(html)) && count < 20) {
    count++;
    try {
      const data = JSON.parse(m[1].trim());
      walkForProduct(data, products);
    } catch {
      /* bozuk blok, atla */
    }
  }
  if (!products.length) return null;
  const p = products[0];
  const out: Extracted = {};
  if (typeof p.name === 'string') out.title = decodeEntities(p.name);
  const img = p.image;
  if (typeof img === 'string') out.image = img;
  else if (Array.isArray(img) && img.length) out.image = typeof img[0] === 'string' ? img[0] : img[0]?.url;
  else if (img && typeof img === 'object') {
    // ImageObject: {url} veya {contentUrl: [...]|string} (Trendyol 2026)
    const cu = img.contentUrl;
    out.image = img.url ?? (Array.isArray(cu) ? cu[0] : typeof cu === 'string' ? cu : undefined);
  }

  let offers = p.offers;
  if (Array.isArray(offers)) offers = offers[0];
  if (offers && typeof offers === 'object') {
    const rawPrice = offers.price ?? offers.lowPrice ?? offers.highPrice;
    out.price = sanePrice(parsePrice(rawPrice)) ?? undefined;
    if (typeof offers.priceCurrency === 'string') out.currency = detectCurrency(offers.priceCurrency);
    const av = String(offers.availability ?? '');
    if (av) out.inStock = /instock|limitedavailability|preorder/i.test(av);
  }
  return out;
}

// ---- meta / microdata ----

export function extractMeta(html: string): Extracted {
  const out: Extracted = {};
  const priceRaw =
    metaContent(html, ['product:price:amount', 'og:price:amount', 'price']) ??
    (() => {
      const m = html.match(/<[^>]+itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
      return m ? m[1] : null;
    })();
  out.price = sanePrice(parsePrice(priceRaw)) ?? undefined;
  const cur = metaContent(html, ['product:price:currency', 'og:price:currency', 'priceCurrency']);
  if (cur) out.currency = detectCurrency(cur);
  const img = metaContent(html, ['og:image', 'twitter:image']);
  if (img) out.image = img;
  const t = titleFromHtml(html);
  if (t) out.title = t;
  return out;
}

// ---- gomulu JSON state (React/Next uygulamalari) ----

const EMBED_KEYS = [
  'discountedPrice',
  'sellingPrice',
  'salePrice',
  'currentPrice',
  'finalPrice',
  'lastPrice',
  'price',
];

export function extractEmbeddedPrice(html: string): number | null {
  for (const key of EMBED_KEYS) {
    // "key":{"...","value":123.45}  bicimi
    const reObj = new RegExp(`"${key}"\\s*:\\s*\\{[^{}]{0,200}?"value"\\s*:\\s*([\\d.]+)`, 'i');
    const mo = html.match(reObj);
    if (mo) {
      const n = sanePrice(parsePrice(parseFloat(mo[1])));
      if (n) return n;
    }
    // "key":123.45 veya "key":"1.299,90"
    const reFlat = new RegExp(`"${key}"\\s*:\\s*"?([\\d][\\d.,]{0,15})"?[,}]`, 'i');
    const mf = html.match(reFlat);
    if (mf) {
      const n = sanePrice(parsePrice(mf[1]));
      if (n) return n;
    }
  }
  return null;
}

// ---- baglamsal regex (son care): fiyat sinifli elementlerin yakininda ara ----

export function extractContextualPrice(html: string): number | null {
  const re = /(?:class|id)=["'][^"']*(?:price|fiyat|prc)[^"']*["'][^>]*>([\s\S]{0,160})/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  const candidates: number[] = [];
  while ((m = re.exec(html)) && count < 40) {
    count++;
    const seg = m[1].replace(/<[^>]+>/g, ' ');
    const pm = seg.match(/(?:₺|TL)?\s*([\d]{1,3}(?:[.,][\d]{3})*(?:[.,][\d]{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₺|TL)?/);
    if (pm && (seg.includes('₺') || /\bTL\b/.test(seg) || /price|fiyat/i.test(m[0]))) {
      const n = sanePrice(parsePrice(pm[1]));
      if (n) candidates.push(n);
    }
  }
  if (!candidates.length) return null;
  return candidates[0];
}

/** Genel cikartici: en guvenilir kaynaktan en zayifa dogru dener, alanlari birlestirir */
export function extractGeneric(html: string): Extracted {
  const ld = extractJsonLd(html) ?? {};
  const meta = extractMeta(html);
  const out: Extracted = {
    title: ld.title ?? meta.title,
    image: ld.image ?? meta.image,
    price: ld.price ?? meta.price,
    listPrice: ld.listPrice ?? meta.listPrice,
    currency: ld.currency ?? meta.currency,
    inStock: ld.inStock ?? meta.inStock,
  };
  if (out.price == null) out.price = extractEmbeddedPrice(html) ?? undefined;
  if (out.price == null) out.price = extractContextualPrice(html) ?? undefined;
  return out;
}
