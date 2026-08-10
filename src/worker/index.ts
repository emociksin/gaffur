import { Hono } from 'hono';
import api from './api';
import type { Env } from './env';
import {
  idFromSlug,
  loadPublicCategory,
  loadPublicProduct,
  publicBaseUrl,
  publicProductJson,
  renderCategoryPage,
  renderCategorySitemap,
  renderProductPage,
  renderProductSitemap,
  renderSitemapIndex,
} from './seo';

// `app` disari aciliyor: Node/Docker girisi (src/server/index.ts) ayni uygulamayi
// kendi baglamalariyla (SQLite + statik dosya) calistiriyor.
export const app = new Hono<{ Bindings: Env }>();

// ---- OFFLINE MODE ------------------------------------------------------------
// Prod'da OFFLINE_MODE=1 verildiginde site kapali sayilir: /api/health disinda
// her yol 410 Gone + noindex doner. Uygulama kodu, rotalar ve testler bozulmadan
// yerinde durur; geri acmak icin Coolify'dan OFFLINE_MODE degiskenini kaldirmak
// yeterli. Testler bu bayragi set etmedigi icin tum entegrasyon testleri, gercek
// route'lari sinamaya devam eder (CI yesil kalir).
const OFFLINE_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Gaffur</title>
<style>
  html,body{margin:0;padding:0;background:#0b0d10;color:#e6e6e6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;height:100%}
  body{display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
  main{max-width:520px;text-align:center;line-height:1.55}
  h1{font-size:28px;margin:0 0 12px;color:#FFB020;font-weight:600;letter-spacing:.02em}
  p{margin:0 0 8px;color:#a8adb4;font-size:15px}
</style>
</head>
<body>
<main>
  <h1>Gaffur</h1>
  <p>Site şu anda kapalı.</p>
  <p>Proje yeniden yapılandırılıyor.</p>
</main>
</body>
</html>`;

app.use('*', async (c, next) => {
  const offline = c.env?.OFFLINE_MODE === '1';
  // Docker/Coolify healthcheck /api/health'e vurup 200 bekliyor; onu birak.
  if (offline && c.req.path !== '/api/health') {
    return new Response(OFFLINE_HTML, {
      status: 410,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow, noarchive',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      },
    });
  }
  await next();
});

// ---- guvenlik basliklari (her yanitta) ----
// CSP: tum JS/CSS kendi origin'imizden; urun gorselleri disaridan geldigi icin
// img-src https: ve data: acik. Panelin iframe'e alinmasi (clickjacking) kapali.
const csp = (nonce?: string) => [
  "default-src 'self'",
  `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}`,
  "style-src 'self' 'unsafe-inline'",
  'img-src https: data:',
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

app.use('*', async (c, next) => {
  await next();
  // ASSETS.fetch()'ten donen yanitin basliklari salt-okunurdur; ustune yazmak
  // sessizce ise yaramaz. Bu yuzden basliklari kopyalayip yeni yanit kurulur.
  const h = new Headers(c.res.headers);
  if (!h.has('content-security-policy')) h.set('content-security-policy', csp());
  h.set('x-content-type-options', 'nosniff');
  h.set('x-frame-options', 'DENY');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('permissions-policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  // Ters vekil (Traefik/Cloudflare) arkasinda istek Node'a http olarak gelir;
  // gercek sema X-Forwarded-Proto'da olur. Aksi halde HSTS hic gonderilmiyordu.
  const proto = c.req.header('x-forwarded-proto') || new URL(c.req.url).protocol.replace(':', '');
  if (proto === 'https') {
    h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers: h });
});

app.route('/api', api);

// Kalici public urun ve kategori sayfalari sunucuda tam HTML olarak uretilir.
app.get('/urun/*', async (c) => {
  const segment = c.req.path.slice('/urun/'.length);
  const wantsJson = segment.endsWith('.json');
  const requestedSlug = wantsJson ? segment.slice(0, -5) : segment;
  const id = idFromSlug(requestedSlug);
  if (!id) return wantsJson ? c.json({ error: 'Urun bulunamadi' }, 404) : c.text('Urun bulunamadi', 404);
  const data = await loadPublicProduct(c.env, id);
  if (!data) return wantsJson ? c.json({ error: 'Urun bulunamadi' }, 404) : c.text('Urun bulunamadi', 404);
  if (requestedSlug !== data.slug) return c.redirect(`/urun/${data.slug}${wantsJson ? '.json' : ''}`, 301);
  if (wantsJson) {
    return c.json(publicProductJson(data, publicBaseUrl(c.env)), 200, {
      'cache-control': 'public, max-age=300, stale-while-revalidate=900',
      'x-robots-tag': 'noindex',
    });
  }
  return renderProductPage(c.env, c.req.url, data);
});

app.get('/kategori/:slug', async (c) => {
  const requestedSlug = c.req.param('slug');
  const id = idFromSlug(requestedSlug);
  if (!id) return c.text('Kategori bulunamadi', 404);
  const data = await loadPublicCategory(c.env, id);
  if (!data) return c.text('Kategori bulunamadi', 404);
  if (requestedSlug !== data.slug) return c.redirect(`/kategori/${data.slug}`, 301);
  return renderCategoryPage(c.env, c.req.url, data);
});

app.get('/sitemap.xml', (c) => renderSitemapIndex(c.env));
app.get('/sitemaps/urunler-aktif.xml', (c) => renderProductSitemap(c.env, true));
app.get('/sitemaps/urunler-arsiv.xml', (c) => renderProductSitemap(c.env, false));
app.get('/sitemaps/kategoriler.xml', (c) => renderCategorySitemap(c.env));

// /api disindaki her sey statik varliklara (SPA) gider.
// Bilinmeyen /api yollari SPA HTML'i degil, duzgun bir JSON 404 dondurur.
app.notFound(async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/')) {
    return c.json({ error: 'Böyle bir uç nokta yok' }, 404);
  }
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  if (url.pathname.startsWith('/yonetim') || url.search) {
    const headers = new Headers(asset.headers);
    headers.set('x-robots-tag', url.pathname.startsWith('/yonetim') ? 'noindex, nofollow' : 'noindex, follow');
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  }
  return asset;
});

export default { fetch: app.fetch };
