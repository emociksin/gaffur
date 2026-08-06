import { Hono } from 'hono';
import api from './api';
import type { Env } from './env';

// `app` disari aciliyor: Node/Docker girisi (src/server/index.ts) ayni uygulamayi
// kendi baglamalariyla (SQLite + statik dosya) calistiriyor.
export const app = new Hono<{ Bindings: Env }>();

// ---- guvenlik basliklari (her yanitta) ----
// CSP: tum JS/CSS kendi origin'imizden; urun gorselleri disaridan geldigi icin
// img-src https: ve data: acik. Panelin iframe'e alinmasi (clickjacking) kapali.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
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
  h.set('content-security-policy', CSP);
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

// /api disindaki her sey statik varliklara (SPA) gider.
// Bilinmeyen /api yollari SPA HTML'i degil, duzgun bir JSON 404 dondurur.
app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return c.json({ error: 'Böyle bir uç nokta yok' }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default { fetch: app.fetch };
