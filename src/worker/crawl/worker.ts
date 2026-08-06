import type { Env } from '../env';
import { getProduct, getSettings, now } from '../db';
import { checkProduct, refreshListing } from '../scrape/engine';
import { claimJob, completeJob, deferJob, failJob, recoverStaleJobs } from './queue';
import { acquireDomainSlot, recordDomainResult } from './domain-rate';

export interface WorkerReport {
  products: number;
  changed: number;
  failed: number;
  listings: number;
}

export async function runQueuedJobs(env: Env, limit = 12): Promise<WorkerReport> {
  const report: WorkerReport = { products: 0, changed: 0, failed: 0, listings: 0 };
  const settings = await getSettings(env);
  const workerId = `node-${crypto.randomUUID()}`;
  await recoverStaleJobs(env, now());

  for (let i = 0; i < limit; i++) {
    const job = await claimJob(env, workerId, now());
    if (!job) break;
    const slot = await acquireDomainSlot(env, job.url, now());
    if (!slot.acquired) {
      await deferJob(env, job.id, slot.retryAt, now());
      continue;
    }
    try {
      if (job.kind === 'product') {
        const product = await getProduct(env, job.entity_id);
        if (!product || !product.active) throw new Error('Ürün bulunamadı veya pasif');
        const outcome = await checkProduct(env, product, settings);
        report.products++;
        if (outcome.changed) report.changed++;
        if (!outcome.ok) report.failed++;
        await recordDomainResult(env, slot.domain, outcome.ok, now());
        await completeJob(env, job.id, outcome, now());
      } else {
        const category = await env.DB.prepare(
          'SELECT id, name, source_url FROM categories WHERE id = ? AND source_url IS NOT NULL'
        ).bind(job.entity_id).first<{ id: number; name: string; source_url: string }>();
        if (!category) throw new Error('Kategori bulunamadı veya kaynak URL yok');
        const outcome = await refreshListing(env, category, settings);
        report.listings++;
        if (!outcome.ok) report.failed++;
        await recordDomainResult(env, slot.domain, outcome.ok, now());
        await completeJob(env, job.id, outcome, now());
      }
    } catch (error) {
      report.failed++;
      await recordDomainResult(env, slot.domain, false, now());
      await failJob(env, job, error, now());
    }
    if (i < limit - 1) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return report;
}
