// Zamanlanmis kontrol dongusu — her 15 dakikada tetiklenir.
// Urun bazinda interval_min'e gore sirasi gelenler kontrol edilir.
// Subrequest limitine takilmamak icin parti boyutu kucuk tutulur (ucretsiz plan: 50 istek/calisma).
import type { Env } from './env';
import { now } from './db';
import { scheduleDueJobs } from './crawl/scheduler';
import { runQueuedJobs } from './crawl/worker';

export interface CronReport {
  products: number;
  changed: number;
  failed: number;
  listings: number;
}

export async function runScheduled(env: Env): Promise<CronReport> {
  const t = now();
  await scheduleDueJobs(env, t);
  return runQueuedJobs(env);
}
