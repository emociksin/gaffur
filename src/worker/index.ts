// SITE KAPALI — proje yeniden yapılandırılıyor.
// Tüm istekler 410 Gone + X-Robots-Tag: noindex, nofollow ile karşılanır ki
// arama motorları mevcut sayfaları indeksten düşürsün. 410, 404'ten daha
// kesin bir sinyaldir: kaynak kalıcı olarak yok. Uygulama koduna, API'ye
// veya statik varlıklara hiçbir istek düşmez.
//
// Geri açmak için: bu dosyayı Git geçmişinden geri al.
import { Hono } from 'hono';
import type { Env } from './env';

export const app = new Hono<{ Bindings: Env }>();

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

const OFFLINE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
} as const;

// Coolify/Docker healthcheck: konteynerin ayakta olduğunu göstermesi için
// bu yol 200 dönmeli, yoksa healthcheck başarısız → deployment failed.
// Yanıt hâlâ noindex, arama motorlarına sızmaz.
app.get('/api/health', () =>
  new Response('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' },
  })
);

app.all('*', () =>
  new Response(OFFLINE_HTML, { status: 410, headers: { ...OFFLINE_HEADERS } })
);

export default { fetch: app.fetch };
