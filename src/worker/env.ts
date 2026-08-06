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
}
