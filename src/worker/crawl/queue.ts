import type { Env } from '../env';

export type CrawlJobKind = 'product' | 'listing';
export type CrawlJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CrawlJob {
  id: number;
  kind: CrawlJobKind;
  entity_id: number;
  url: string;
  status: CrawlJobStatus;
  priority: number;
  run_after: number;
  attempts: number;
  max_attempts: number;
  locked_at: number | null;
  locked_by: string | null;
  last_error: string | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

export async function enqueueJob(
  env: Env,
  input: { kind: CrawlJobKind; entityId: number; url: string; priority?: number; runAfter: number },
  t: number
): Promise<boolean> {
  const active = await env.DB.prepare(
    `SELECT id FROM crawl_jobs WHERE kind = ? AND entity_id = ? AND status IN ('queued', 'running') LIMIT 1`
  ).bind(input.kind, input.entityId).first();
  if (active) return false;
  try {
    await env.DB.prepare(
      `INSERT INTO crawl_jobs
       (kind, entity_id, url, status, priority, run_after, attempts, max_attempts, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, ?, 0, 3, ?, ?)`
    ).bind(input.kind, input.entityId, input.url, input.priority ?? 0, input.runAfter, t, t).run();
    return true;
  } catch {
    // Partial unique index eşzamanlı scheduler yarışını güvenli biçimde bastırır.
    return false;
  }
}

export async function claimJob(env: Env, workerId: string, t: number): Promise<CrawlJob | null> {
  return env.DB.prepare(
    `UPDATE crawl_jobs SET
       status = 'running', locked_at = ?, locked_by = ?, attempts = attempts + 1, updated_at = ?
     WHERE id = (
       SELECT id FROM crawl_jobs
       WHERE status = 'queued' AND run_after <= ?
       ORDER BY priority DESC, run_after ASC, id ASC LIMIT 1
     ) AND status = 'queued'
     RETURNING *`
  ).bind(t, workerId, t, t).first<CrawlJob>();
}

export async function completeJob(env: Env, jobId: number, result: unknown, t: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE crawl_jobs SET status = 'completed', result_json = ?, locked_at = NULL,
       locked_by = NULL, updated_at = ?, finished_at = ? WHERE id = ? AND status = 'running'`
  ).bind(JSON.stringify(result), t, t, jobId).run();
}

export async function failJob(env: Env, job: CrawlJob, error: unknown, t: number): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const retry = job.attempts < job.max_attempts;
  const delay = Math.min(30 * 60, 60 * 2 ** Math.max(0, job.attempts - 1));
  await env.DB.prepare(
    `UPDATE crawl_jobs SET status = ?, run_after = ?, last_error = ?, locked_at = NULL,
       locked_by = NULL, updated_at = ?, finished_at = ? WHERE id = ? AND status = 'running'`
  ).bind(retry ? 'queued' : 'failed', retry ? t + delay : t, message.slice(0, 1000), t, retry ? null : t, job.id).run();
}

export async function recoverStaleJobs(env: Env, t: number, staleAfterS = 30 * 60): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE crawl_jobs SET status = 'queued', locked_at = NULL, locked_by = NULL,
       run_after = ?, updated_at = ?, last_error = 'Worker zaman aşımı sonrası yeniden kuyruğa alındı'
     WHERE status = 'running' AND locked_at < ?`
  ).bind(t, t, t - staleAfterS).run();
  return result.meta.changes;
}
