import type { Env } from './env';
import type { Product, StockStatus } from '../shared/types';
import { categorySlug, productSlug } from '../shared/slug';
export { categorySlug, idFromSlug, productSlug, slugify } from '../shared/slug';

const DAY = 86400;
const DEFAULT_BASE_URL = 'https://gaffur.net';

interface SeoProduct extends Product {
  category_name: string | null;
}

interface SeoOffer {
  id: number;
  marketplace: string;
  seller_name: string | null;
  url: string;
  price: number | null;
  currency: string | null;
  stock_status: StockStatus | null;
  shipping_cost: number | null;
  checked_at: number | null;
}

interface SeoHistoryPoint {
  price: number;
  in_stock: number | null;
  checked_at: number;
}

interface SeoBaseline {
  median_30d: number | null;
  median_90d: number | null;
  all_time_low: number | null;
}

export interface PublicProductData {
  product: SeoProduct;
  offers: SeoOffer[];
  history: SeoHistoryPoint[];
  baseline: SeoBaseline | null;
  offerCount: number;
  historyDays: number;
  indexable: boolean;
  slug: string;
  modifiedAt: number;
}

export interface PublicCategoryData {
  category: { id: number; name: string; color: string; created_at: number };
  products: Array<SeoProduct & { offer_count: number; history_days: number }>;
  slug: string;
  indexable: boolean;
  modifiedAt: number;
}

function dailyHistory(rows: SeoHistoryPoint[]): SeoHistoryPoint[] {
  const byDay = new Map<string, SeoHistoryPoint>();
  for (const row of rows) {
    const day = new Date(row.checked_at * 1000).toISOString().slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || row.checked_at > existing.checked_at) byDay.set(day, row);
  }
  return [...byDay.values()].sort((a, b) => b.checked_at - a.checked_at).slice(0, 365);
}

export async function loadPublicProduct(env: Env, id: number): Promise<PublicProductData | null> {
  const product = await env.DB.prepare(
    `SELECT p.*, c.name AS category_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ?`
  ).bind(id).first<SeoProduct>();
  if (!product) return null;

  const [offerRows, historyRows, historySpan, baseline] = await Promise.all([
    env.DB.prepare(
      `SELECT o.id, o.marketplace, o.seller_name, o.url,
              (SELECT os.price FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1) AS price,
              (SELECT os.currency FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1) AS currency,
              (SELECT os.stock_status FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1) AS stock_status,
              (SELECT os.shipping_cost FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1) AS shipping_cost,
              (SELECT os.checked_at FROM offer_snapshots os WHERE os.offer_id = o.id ORDER BY checked_at DESC LIMIT 1) AS checked_at
       FROM offers o WHERE o.product_id = ? AND o.active = 1 ORDER BY o.id ASC`
    ).bind(id).all<SeoOffer>(),
    env.DB.prepare(
      `SELECT price, in_stock, checked_at FROM price_history
       WHERE product_id = ? AND checked_at >= ? ORDER BY checked_at ASC`
    ).bind(id, Math.floor(Date.now() / 1000) - 366 * DAY).all<SeoHistoryPoint>(),
    env.DB.prepare(
      'SELECT MIN(checked_at) AS first_at, MAX(checked_at) AS last_at FROM price_history WHERE product_id = ?'
    ).bind(id).first<{ first_at: number | null; last_at: number | null }>(),
    env.DB.prepare(
      'SELECT median_30d, median_90d, all_time_low FROM price_baselines WHERE product_id = ?'
    ).bind(id).first<SeoBaseline>(),
  ]);

  let offers = offerRows.results ?? [];
  if (!offers.length && product.current_price != null) {
    offers = [{
      id: product.id,
      marketplace: product.site,
      seller_name: null,
      url: product.url,
      price: product.current_price,
      currency: product.currency,
      stock_status: product.stock_status,
      shipping_cost: null,
      checked_at: product.last_checked_at,
    }];
  }
  const offerCount = offers.length;
  const firstAt = historySpan?.first_at ?? null;
  const lastAt = historySpan?.last_at ?? null;
  const historyDays = firstAt != null && lastAt != null ? Math.floor((lastAt - firstAt) / DAY) : 0;
  const modifiedAt = Math.max(product.last_checked_at ?? 0, lastAt ?? 0, product.created_at);
  return {
    product,
    offers,
    history: dailyHistory(historyRows.results ?? []),
    baseline: baseline ?? null,
    offerCount,
    historyDays,
    indexable: offerCount >= 2 || historyDays >= 30,
    slug: productSlug(product),
    modifiedAt,
  };
}

export async function loadPublicCategory(env: Env, id: number): Promise<PublicCategoryData | null> {
  const category = await env.DB.prepare(
    'SELECT id, name, color, created_at FROM categories WHERE id = ?'
  ).bind(id).first<{ id: number; name: string; color: string; created_at: number }>();
  if (!category) return null;
  const rows = await env.DB.prepare(
    `SELECT p.*, c.name AS category_name,
            (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id AND o.active = 1) AS offer_count,
            CAST(COALESCE(((SELECT MAX(checked_at) FROM price_history WHERE product_id = p.id) -
                           (SELECT MIN(checked_at) FROM price_history WHERE product_id = p.id)) / 86400, 0) AS INTEGER) AS history_days
     FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.category_id = ?
     ORDER BY p.active DESC, p.last_checked_at DESC, p.id DESC`
  ).bind(id).all<SeoProduct & { offer_count: number; history_days: number }>();
  const products = rows.results ?? [];
  const modifiedAt = Math.max(category.created_at, ...products.map((p) => p.last_checked_at ?? p.created_at));
  return {
    category,
    products,
    slug: categorySlug(category),
    indexable: products.some((p) => p.offer_count >= 2 || p.history_days >= 30),
    modifiedAt,
  };
}

export function publicBaseUrl(env: Env): string {
  const configured = env.PUBLIC_BASE_URL?.trim();
  if (configured && /^https?:\/\/[^/]+/i.test(configured)) return configured.replace(/\/+$/, '');
  return DEFAULT_BASE_URL;
}

const esc = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const xmlEsc = (value: unknown): string => esc(value);

const jsonLd = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

const money = (value: number | null | undefined, currency = 'TRY'): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
};

const dateText = (timestamp: number | null | undefined): string => {
  if (!timestamp) return 'bilinmiyor';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(timestamp * 1000));
};

const isoDate = (timestamp: number): string => new Date(timestamp * 1000).toISOString();

function stockText(status: StockStatus | null | undefined): string {
  if (status === 'in_stock') return 'Stokta';
  if (status === 'out_of_stock') return 'Stokta yok';
  if (status === 'preorder') return 'Ön sipariş';
  return 'Stok bilinmiyor';
}

function availability(status: StockStatus | null | undefined): string | undefined {
  if (status === 'in_stock') return 'https://schema.org/InStock';
  if (status === 'preorder') return 'https://schema.org/PreOrder';
  if (status === 'out_of_stock') return 'https://schema.org/OutOfStock';
  return undefined;
}

function judgement(data: PublicProductData): string {
  const current = data.product.current_price;
  if (!data.product.active) {
    return current == null
      ? 'Bu ürün artık aktif olarak izlenmiyor ve doğrulanmış bir son fiyatı yok.'
      : `Bu ürün artık aktif olarak izlenmiyor; son kayıtlı fiyatı ${money(current, data.product.currency)} idi.`;
  }
  if (current == null) return 'Bu ürün için güncel fiyat henüz doğrulanamadı.';
  const low = data.baseline?.all_time_low ?? data.product.min_price;
  if (low != null && current <= low + 0.01) return 'Şu an kayıtlı en düşük fiyat seviyesinde.';
  const median30 = data.baseline?.median_30d;
  if (median30 != null && current <= median30 * 0.98) return '30 günlük medyanın altında; fiyat görece avantajlı.';
  if (median30 != null && current >= median30 * 1.02) return '30 günlük medyanın üzerinde; beklemek daha mantıklı olabilir.';
  if (median30 != null) return 'Fiyat 30 günlük medyana yakın.';
  return 'Karar vermek için henüz yeterli fiyat geçmişi yok.';
}

function priceChart(history: SeoHistoryPoint[], currency: string): string {
  if (history.length < 2) return '';
  const points = [...history].sort((a, b) => a.checked_at - b.checked_at);
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 1);
  const width = 800;
  const height = 220;
  const padX = 34;
  const padY = 24;
  const coordinates = points.map((point, index) => {
    const x = padX + (index / Math.max(points.length - 1, 1)) * (width - padX * 2);
    const y = padY + ((max - point.price) / range) * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<figure class="seo-chart">
    <svg class="seo-price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Günlük fiyat geçmişi grafiği; en düşük ${esc(money(min, currency))}, en yüksek ${esc(money(max, currency))}">
      <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}" class="seo-chart-axis" />
      <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" class="seo-chart-axis" />
      <polyline points="${coordinates}" class="seo-chart-line" />
    </svg>
    <figcaption>${esc(dateText(points[0].checked_at))} – ${esc(dateText(points.at(-1)!.checked_at))}</figcaption>
  </figure>`;
}

function brandMarkup(): string {
  return '<span class="brand-sign"><span class="brand-word">GAFF<span class="brand-sun">U</span>R</span><span class="brand-sub">fiyat takip</span></span>';
}

function pageFrame(content: string, footerText: string): string {
  return `<div class="app seo-app">
    <header class="hdr seo-hdr">
      <a class="brand" href="/" aria-label="Gaffur ana sayfa">${brandMarkup()}</a>
      <p class="hdr-tagline">Fiyatı, stoku ve geçmişi doğrulanmış veriden gör</p>
      <div class="hdr-actions"><a class="btn btn-primary" href="/">Ürünleri gör</a></div>
    </header>
    <main class="main">${content}</main>
    <footer class="ftr"><span>gaffur.net</span><span class="dot"></span><span>${esc(footerText)}</span></footer>
  </div>`;
}

async function injectShell(
  env: Env,
  requestUrl: string,
  rootHtml: string,
  options: { title: string; description: string; canonical: string; robots: string; json: unknown; modifiedAt: number }
): Promise<Response> {
  const shellUrl = new URL('/index.html', requestUrl);
  const shellResponse = await env.ASSETS.fetch(new Request(shellUrl));
  if (!shellResponse.ok) return new Response('Sayfa kabuğu bulunamadı', { status: 500 });
  let html = await shellResponse.text();
  const nonce = crypto.randomUUID().replace(/-/g, '');
  html = html
    .replace('<html lang="tr">', '<html lang="tr" data-gaffur-ssr="1">')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(options.title)}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${esc(options.description)}" />`)
    .replace('</head>', `<link rel="canonical" href="${esc(options.canonical)}" />
      <meta name="robots" content="${esc(options.robots)}" />
      <meta property="og:type" content="website" />
      <meta property="og:title" content="${esc(options.title)}" />
      <meta property="og:description" content="${esc(options.description)}" />
      <meta property="og:url" content="${esc(options.canonical)}" />
      <meta property="og:site_name" content="Gaffur" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta property="article:modified_time" content="${isoDate(options.modifiedAt)}" />
      <script type="application/ld+json" nonce="${nonce}">${jsonLd(options.json)}</script>
    </head>`)
    .replace('<div id="root"></div>', `<div id="root">${rootHtml}</div>`);
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=900',
      'x-robots-tag': options.robots,
      'content-security-policy': [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline'",
        'img-src https: data:',
        "connect-src 'self'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    },
  });
}

function productStructuredData(data: PublicProductData, base: string): unknown {
  const p = data.product;
  const canonical = `${base}/urun/${data.slug}`;
  const inStockOffers = data.offers.filter((o) => o.price != null && o.stock_status === 'in_stock');
  const prices = inStockOffers.map((o) => o.price!).filter(Number.isFinite);
  const currency = inStockOffers.find((o) => o.currency)?.currency ?? p.currency;
  const product: Record<string, unknown> = {
    '@type': 'Product',
    '@id': `${canonical}#product`,
    name: p.title,
    url: canonical,
    sku: p.sku || `gaffur-${p.id}`,
    category: p.category_name || undefined,
    image: p.image ? [p.image] : undefined,
    brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
    mpn: p.mpn || undefined,
    dateModified: isoDate(data.modifiedAt),
  };
  if (p.gtin && /^\d{8,14}$/.test(p.gtin)) product[`gtin${p.gtin.length}`] = p.gtin;
  if (prices.length) {
    const aggregateOffer: Record<string, unknown> = {
      '@type': 'AggregateOffer',
      url: canonical,
      priceCurrency: currency,
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: prices.length,
    };
    const stockAvailability = availability(p.stock_status);
    if (stockAvailability) aggregateOffer.availability = stockAvailability;
    product.offers = aggregateOffer;
  }
  return {
    '@context': 'https://schema.org',
    '@graph': [
      product,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Gaffur', item: `${base}/` },
          ...(p.category_id && p.category_name ? [{ '@type': 'ListItem', position: 2, name: p.category_name, item: `${base}/kategori/${categorySlug({ id: p.category_id, name: p.category_name })}` }] : []),
          { '@type': 'ListItem', position: p.category_id && p.category_name ? 3 : 2, name: p.title, item: canonical },
        ],
      },
    ],
  };
}

export async function renderProductPage(env: Env, requestUrl: string, data: PublicProductData): Promise<Response> {
  const base = publicBaseUrl(env);
  const hasQuery = Boolean(new URL(requestUrl).search);
  const p = data.product;
  const canonical = `${base}/urun/${data.slug}`;
  const averagePrice = data.history.length
    ? data.history.reduce((sum, point) => sum + point.price, 0) / data.history.length
    : null;
  const description = `${p.title}: güncel fiyat ${money(p.current_price, p.currency)}, stok durumu ve günlük fiyat geçmişi. Son güncelleme ${dateText(data.modifiedAt)}.`.slice(0, 220);
  const categoryCrumb = p.category_id && p.category_name
    ? `<a href="/kategori/${categorySlug({ id: p.category_id, name: p.category_name })}">${esc(p.category_name)}</a><span>/</span>`
    : '';
  const offers = data.offers.map((offer) => `<tr>
    <td><a href="${esc(offer.url)}" rel="nofollow sponsored" target="_blank">${esc(offer.seller_name || offer.marketplace)}</a></td>
    <td>${money(offer.price, offer.currency || p.currency)}</td>
    <td>${offer.shipping_cost == null ? 'Bilinmiyor' : money(offer.shipping_cost, offer.currency || p.currency)}</td>
    <td>${esc(stockText(offer.stock_status))}</td>
    <td>${esc(dateText(offer.checked_at))}</td>
  </tr>`).join('');
  const history = data.history.map((point) => `<tr>
    <td><time datetime="${isoDate(point.checked_at)}">${esc(dateText(point.checked_at))}</time></td>
    <td>${money(point.price, p.currency)}</td>
    <td>${point.in_stock == null ? 'Bilinmiyor' : point.in_stock ? 'Stokta' : 'Stokta yok'}</td>
  </tr>`).join('');
  const content = `<nav class="seo-breadcrumb" aria-label="İçerik yolu"><a href="/">Ana sayfa</a><span>/</span>${categoryCrumb}<span aria-current="page">${esc(p.title)}</span></nav>
    <article class="seo-product">
      <header class="seo-product-head${p.image ? ' has-image' : ''}">
        ${p.image ? `<img class="seo-product-image" src="${esc(p.image)}" alt="${esc(p.title)}" referrerpolicy="no-referrer" />` : ''}
        <div><div class="card-badges"><span class="site-badge">${esc(p.site)}</span><span class="mini-badge">${esc(stockText(p.stock_status))}</span></div>
          <h1>${esc(p.title)}</h1>
          <p class="seo-judgement"><time datetime="${isoDate(data.modifiedAt)}">${esc(dateText(data.modifiedAt))} itibarıyla</time>: ${esc(judgement(data))}</p>
          <p class="mut">Son güncelleme: <time datetime="${isoDate(data.modifiedAt)}">${esc(dateText(data.modifiedAt))}</time></p>
        </div>
        <div class="seo-current-price"><small>Güncel fiyat</small><strong>${money(p.current_price, p.currency)}</strong></div>
      </header>
      <section class="det-stats" aria-label="Fiyat özeti">
        <div><small>En düşük</small><b class="stat-green">${money(p.min_price, p.currency)}</b></div>
        <div><small>En yüksek</small><b>${money(p.max_price, p.currency)}</b></div>
        <div><small>Günlük ortalama</small><b>${money(averagePrice, p.currency)}</b></div>
        <div><small>30 günlük medyan</small><b>${money(data.baseline?.median_30d, p.currency)}</b></div>
        <div><small>90 günlük medyan</small><b>${money(data.baseline?.median_90d, p.currency)}</b></div>
      </section>
      <section class="seo-section"><h2>Satıcı teklifleri</h2>
        ${data.offers.length ? `<div class="seo-table-wrap"><table class="seo-table"><thead><tr><th>Satıcı</th><th>Fiyat</th><th>Kargo</th><th>Stok</th><th>Kontrol</th></tr></thead><tbody>${offers}</tbody></table></div>` : '<p class="mut">Aktif satıcı teklifi bulunmuyor.</p>'}
        <p class="seo-note">Gaffur doğrudan satış yapmaz. Kapsam izlenen satıcılarla sınırlıdır; “tüm satıcılar” iddiasında bulunulmaz.</p>
      </section>
      <section class="seo-section"><h2>Günlük fiyat geçmişi</h2>
        <p class="mut">Aynı gündeki kontrollerden sonuncusu gösterilir. Toplam geçmiş aralığı: ${data.historyDays} gün.</p>
        ${priceChart(data.history, p.currency)}
        ${data.history.length ? `<div class="seo-table-wrap"><table class="seo-table"><thead><tr><th>Tarih</th><th>Fiyat</th><th>Stok</th></tr></thead><tbody>${history}</tbody></table></div>` : '<p class="mut">Henüz fiyat geçmişi oluşmadı.</p>'}
      </section>
    </article>`;
  return injectShell(env, requestUrl, pageFrame(content, `${data.offerCount} teklif · ${data.historyDays} günlük geçmiş`), {
    title: `${p.title} Fiyatı ve Fiyat Geçmişi | Gaffur`,
    description,
    canonical,
    robots: data.indexable && !hasQuery ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    json: productStructuredData(data, base),
    modifiedAt: data.modifiedAt,
  });
}

function categoryStructuredData(data: PublicCategoryData, base: string): unknown {
  const canonical = `${base}/kategori/${data.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ItemList',
        name: `${data.category.name} ürünleri`,
        url: canonical,
        numberOfItems: data.products.length,
        itemListElement: data.products.map((p, index) => ({
          '@type': 'ListItem', position: index + 1, name: p.title, url: `${base}/urun/${productSlug(p)}`,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Gaffur', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: data.category.name, item: canonical },
        ],
      },
    ],
  };
}

export async function renderCategoryPage(env: Env, requestUrl: string, data: PublicCategoryData): Promise<Response> {
  const base = publicBaseUrl(env);
  const hasQuery = Boolean(new URL(requestUrl).search);
  const canonical = `${base}/kategori/${data.slug}`;
  const cards = data.products.map((p) => `<a class="card seo-card" href="/urun/${productSlug(p)}">
    <div class="card-top">${p.image ? `<span class="card-img"><img src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" /></span>` : ''}
      <span class="card-head"><span class="card-badges"><span class="site-badge">${esc(p.site)}</span><span class="mini-badge">${esc(stockText(p.stock_status))}</span></span><strong class="card-title">${esc(p.title)}</strong></span>
    </div><span class="card-price-row"><span class="price-now">${money(p.current_price, p.currency)}</span><span class="mut">${p.offer_count || 1} teklif</span></span>
  </a>`).join('');
  const content = `<nav class="seo-breadcrumb" aria-label="İçerik yolu"><a href="/">Ana sayfa</a><span>/</span><span aria-current="page">${esc(data.category.name)}</span></nav>
    <header class="page-head"><div><h1>${esc(data.category.name)}</h1><p class="mut">${data.products.length} izlenen ürün</p></div></header>
    ${data.products.length ? `<div class="grid">${cards}</div>` : '<p class="mut">Bu kategoride henüz ürün yok.</p>'}`;
  return injectShell(env, requestUrl, pageFrame(content, `${data.products.length} ürün`), {
    title: `${data.category.name} Fiyatları ve Fiyat Geçmişi | Gaffur`,
    description: `${data.category.name} ürünlerinin güncel fiyatları, stok durumları ve doğrulanmış fiyat geçmişleri.`,
    canonical,
    robots: data.indexable && !hasQuery ? 'index, follow' : 'noindex, follow',
    json: categoryStructuredData(data, base),
    modifiedAt: data.modifiedAt,
  });
}

export function publicProductJson(data: PublicProductData, base: string): unknown {
  return {
    id: data.product.id,
    url: `${base}/urun/${data.slug}`,
    title: data.product.title,
    brand: data.product.brand ?? null,
    gtin: data.product.gtin ?? null,
    mpn: data.product.mpn ?? null,
    sku: data.product.sku || `gaffur-${data.product.id}`,
    category: data.product.category_name,
    image: data.product.image,
    currency: data.product.currency,
    currentPrice: data.product.current_price,
    stockStatus: data.product.stock_status,
    lastModified: isoDate(data.modifiedAt),
    indexable: data.indexable,
    coverage: { offerCount: data.offerCount, historyDays: data.historyDays },
    baseline: data.baseline,
    offers: data.offers,
    dailyHistory: data.history,
  };
}

export async function renderSitemapIndex(env: Env): Promise<Response> {
  const base = publicBaseUrl(env);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>${xmlEsc(base)}/sitemaps/urunler-aktif.xml</loc></sitemap>
    <sitemap><loc>${xmlEsc(base)}/sitemaps/urunler-arsiv.xml</loc></sitemap>
    <sitemap><loc>${xmlEsc(base)}/sitemaps/kategoriler.xml</loc></sitemap>
  </sitemapindex>`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

export async function renderProductSitemap(env: Env, active: boolean): Promise<Response> {
  const base = publicBaseUrl(env);
  const rows = await env.DB.prepare(
    `SELECT p.id, p.title, p.last_checked_at, p.created_at,
            (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id AND o.active = 1) AS offer_count,
            CAST(COALESCE(((SELECT MAX(checked_at) FROM price_history WHERE product_id = p.id) -
                           (SELECT MIN(checked_at) FROM price_history WHERE product_id = p.id)) / 86400, 0) AS INTEGER) AS history_days
     FROM products p WHERE p.active = ? ORDER BY p.id ASC`
  ).bind(active ? 1 : 0).all<{ id: number; title: string; last_checked_at: number | null; created_at: number; offer_count: number; history_days: number }>();
  const urls = (rows.results ?? []).filter((p) => p.offer_count >= 2 || p.history_days >= 30).map((p) =>
    `<url><loc>${xmlEsc(`${base}/urun/${productSlug(p)}`)}</loc><lastmod>${isoDate(p.last_checked_at ?? p.created_at)}</lastmod></url>`
  ).join('');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

export async function renderCategorySitemap(env: Env): Promise<Response> {
  const base = publicBaseUrl(env);
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.created_at, MAX(COALESCE(p.last_checked_at, p.created_at, c.created_at)) AS modified_at,
            SUM(CASE WHEN
              (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id AND o.active = 1) >= 2 OR
              COALESCE(((SELECT MAX(checked_at) FROM price_history WHERE product_id = p.id) -
                        (SELECT MIN(checked_at) FROM price_history WHERE product_id = p.id)) / 86400, 0) >= 30
              THEN 1 ELSE 0 END) AS indexable_products
     FROM categories c LEFT JOIN products p ON p.category_id = c.id
     GROUP BY c.id, c.name, c.created_at ORDER BY c.id ASC`
  ).all<{ id: number; name: string; created_at: number; modified_at: number; indexable_products: number }>();
  const urls = (rows.results ?? []).filter((c) => c.indexable_products > 0).map((c) =>
    `<url><loc>${xmlEsc(`${base}/kategori/${categorySlug(c)}`)}</loc><lastmod>${isoDate(c.modified_at ?? c.created_at)}</lastmod></url>`
  ).join('');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
