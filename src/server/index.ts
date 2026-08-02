// Node/Docker girisi — Coolify gibi kendi sunucunda calistirmak icin.
// Ayni Hono uygulamasini kullanir; Cloudflare'e ozgu uc sey burada karsilanir:
//   D1        -> node:sqlite (LocalD1)
//   ASSETS    -> dist/client'tan statik sunum + SPA yedegi
//   cron      -> setInterval ile runScheduled
import { serve } from '@hono/node-server';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../worker/index';
import { runScheduled } from '../worker/cron';
import { LocalD1 } from './d1';
import type { Env } from '../worker/env';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CLIENT_DIR = resolve(process.env.CLIENT_DIR || join(ROOT, 'dist', 'client'));
const MIGRATIONS_DIR = resolve(process.env.MIGRATIONS_DIR || join(ROOT, 'migrations'));
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'gaffur.db');
const PORT = Number(process.env.PORT || 3000);
const CRON_MS = Number(process.env.CRON_INTERVAL_MIN || 15) * 60_000;

// ---- veritabani + migration ----
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new LocalD1(DB_PATH);

function runMigrations(): void {
  const raw = db.raw();
  raw.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(
    (raw.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name)
  );
  if (!existsSync(MIGRATIONS_DIR)) return;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    raw.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    raw.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, Math.floor(Date.now() / 1000));
    console.log('[migration] uygulandi:', f);
  }
}
runMigrations();

// ---- statik varliklar (ASSETS binding karsiligi) ----
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const ASSETS = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Hatalı adres', { status: 400 });
    }
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Dizin disina cikma (path traversal) korumasi: cozulen yol CLIENT_DIR altinda kalmali
    let file = resolve(join(CLIENT_DIR, pathname));
    if (file !== CLIENT_DIR && !file.startsWith(CLIENT_DIR + sep)) {
      return new Response('Yasak', { status: 403 });
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(CLIENT_DIR, 'index.html'); // SPA yedegi
      if (!existsSync(file)) return new Response('Bulunamadı', { status: 404 });
    }

    const ext = extname(file).toLowerCase();
    const isHashed = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\./.test(file.replace(/\\/g, '/'));
    return new Response(readFileSync(file), {
      headers: {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  },
} satisfies Pick<Fetcher, 'fetch'>;

const env = {
  DB: db,
  ASSETS,
  PASSWORD: process.env.PASSWORD,
  ALLOW_OPEN: process.env.ALLOW_OPEN,
} as unknown as Env;

// ---- zamanlayici (cron trigger karsiligi) ----
if (process.env.SCHEDULER_DISABLED !== '1') {
  const tick = () => {
    runScheduled(env).catch((e) => console.error('[cron]', e));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, CRON_MS);
  console.log('[cron] aktif, aralık:', CRON_MS / 60_000, 'dk');
}

if (!process.env.PASSWORD && process.env.ALLOW_OPEN !== '1') {
  console.warn(
    '[uyarı] PASSWORD tanımlı değil: uygulama kilitli çalışıyor (tüm API 503). ' +
      'Ortam değişkenlerinden PASSWORD ekleyip yeniden başlat.'
  );
}

serve({ fetch: (request: Request) => app.fetch(request, env), port: PORT }, (info) => {
  console.log(`[gaffur] http://0.0.0.0:${info.port} — veritabanı: ${DB_PATH}`);
});
