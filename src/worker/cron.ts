// Zamanlanmis kontrol dongusu — her 15 dakikada tetiklenir.
// Urun bazinda interval_min'e gore sirasi gelenler kontrol edilir.
// Subrequest limitine takilmamak icin parti boyutu kucuk tutulur (ucretsiz plan: 50 istek/calisma).
import type { Env } from './env';
import { now } from './db';
import { scheduleDueJobs } from './crawl/scheduler';
import { runQueuedJobs } from './crawl/worker';
import { refreshOpportunityFeedIfDue } from './intelligence/opportunities';
import { refreshComplianceIfDue } from './intelligence/compliance';
import { dispatchPendingNotifications, type DispatchReport } from './notifications/delivery';

export interface CronReport {
  products: number;
  changed: number;
  failed: number;
  listings: number;
  opportunities: number;
  compliance: number;
  deliveries: DispatchReport;
}

export async function runScheduled(env: Env): Promise<CronReport> {
  const t = now();
  await scheduleDueJobs(env, t);
  const crawl = await runQueuedJobs(env);
  const opportunities = await refreshOpportunityFeedIfDue(env, t);
  const compliance = await refreshComplianceIfDue(env, t);
  const deliveries = await dispatchPendingNotifications(env, t);
  return {
    ...crawl,
    opportunities: opportunities.count,
    compliance: compliance.count,
    deliveries,
  };
}
