// D1 ve Fetcher arayuzleri: eskiden @cloudflare/workers-types'tan geliyordu,
// artik yalniz Node/Docker hedeflendiginden kullanilan altkumeyi burada tanimliyoruz.

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }>;
  run(): Promise<{ success: true; meta: { last_row_id: number; changes: number } }>;
}

interface D1Database {
  prepare(sql: string): D1Statement;
  exec(sql: string): Promise<{ count: number }>;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** SEO sayfalarinda canonical URL ve sitemap icin disaridan gorunen origin. */
  PUBLIC_BASE_URL?: string;
  /** Resend HTTP API ile e-posta teslimati. Ikisi birlikte yoksa kanal kapali raporlanir. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Standart Web Push (RFC 8291) icin VAPID anahtarlari. */
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /**
   * Yonetim parolasi. Prod'da ZORUNLU: ortam degiskeninden verilir.
   * Tanimli degilse uygulama fail-closed calisir: tum API 503 doner.
   */
  PASSWORD?: string;
  /**
   * SADECE yerel gelistirme icin parolasiz acik mod.
   * Prod'da ASLA tanimlanmamalidir.
   */
  ALLOW_OPEN?: string;
  /**
   * "1" ise site tamamen kapali sayilir: /api/health disinda her yol
   * 410 Gone + noindex doner ve cron devre disi kalir. Kaldirinca uygulama
   * eski haline doner. Coolify degiskeninden yonetilir.
   */
  OFFLINE_MODE?: string;
}
