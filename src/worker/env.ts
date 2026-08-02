export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /**
   * Yonetim parolasi. Prod'da ZORUNLU: `wrangler secret put PASSWORD`.
   * Tanimli degilse uygulama fail-closed calisir: tum API 503 doner.
   */
  PASSWORD?: string;
  /**
   * SADECE yerel gelistirme icin parolasiz acik mod. `.dev.vars` dosyasina
   * `ALLOW_OPEN=1` yazilarak acilir; `.dev.vars` deploy edilmez ve git'e girmez.
   * Prod'da ASLA tanimlanmamalidir - tanimlanirsa uygulama herkese acik olur.
   */
  ALLOW_OPEN?: string;
}
