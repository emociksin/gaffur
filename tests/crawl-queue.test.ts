import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { claimJob, completeJob, enqueueJob, failJob, recoverStaleJobs } from '../src/worker/crawl/queue';

describe('crawl_jobs kuyruğu', () => {
  let db: LocalD1;
  let env: any;
  const t = 1_800_000_000;

  beforeEach(() => {
    db = new LocalD1(':memory:');
    const dir = join(process.cwd(), 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.pg.sql')).sort()) {
      db.raw().exec(readFileSync(join(dir, file), 'utf8'));
    }
    env = { DB: db };
  });

  it('aynı varlık için yalnız bir aktif iş üretir ve öncelikli işi önce claim eder', async () => {
    expect(await enqueueJob(env, { kind: 'product', entityId: 1, url: 'https://a.test/1', runAfter: t }, t)).toBe(true);
    expect(await enqueueJob(env, { kind: 'product', entityId: 1, url: 'https://a.test/1', runAfter: t }, t)).toBe(false);
    expect(await enqueueJob(env, { kind: 'listing', entityId: 2, url: 'https://a.test/list', priority: 10, runAfter: t }, t)).toBe(true);

    const first = await claimJob(env, 'worker-a', t);
    expect(first).toEqual(expect.objectContaining({ kind: 'listing', entity_id: 2, status: 'running', attempts: 1 }));
    const second = await claimJob(env, 'worker-b', t);
    expect(second).toEqual(expect.objectContaining({ kind: 'product', entity_id: 1, status: 'running' }));
    expect(await claimJob(env, 'worker-c', t)).toBeNull();
  });

  it('başarılı işi tamamlar ve aynı varlığın yeniden kuyruğa girmesine izin verir', async () => {
    await enqueueJob(env, { kind: 'product', entityId: 1, url: 'https://a.test/1', runAfter: t }, t);
    const job = await claimJob(env, 'worker-a', t);
    await completeJob(env, job!.id, { ok: true }, t + 1);
    const row = await db.prepare('SELECT status, result_json FROM crawl_jobs WHERE id = ?').bind(job!.id).first<any>();
    expect(row).toEqual({ status: 'completed', result_json: '{"ok":true}' });
    expect(await enqueueJob(env, { kind: 'product', entityId: 1, url: 'https://a.test/1', runAfter: t + 2 }, t + 2)).toBe(true);
  });

  it('hatalı işi gecikmeli yeniden kuyruğa alır ve kilitli kalmış işi kurtarır', async () => {
    await enqueueJob(env, { kind: 'product', entityId: 1, url: 'https://a.test/1', runAfter: t }, t);
    const job = await claimJob(env, 'worker-a', t);
    await failJob(env, job!, new Error('geçici hata'), t + 1);
    const retry = await db.prepare('SELECT status, run_after, last_error FROM crawl_jobs WHERE id = ?').bind(job!.id).first<any>();
    expect(retry).toEqual({ status: 'queued', run_after: t + 61, last_error: 'geçici hata' });

    const claimedAgain = await claimJob(env, 'worker-b', t + 61);
    expect(claimedAgain?.attempts).toBe(2);
    expect(await recoverStaleJobs(env, t + 31 * 60 + 2)).toBe(1);
    const recovered = await db.prepare('SELECT status, locked_by FROM crawl_jobs WHERE id = ?').bind(job!.id).first<any>();
    expect(recovered).toEqual({ status: 'queued', locked_by: null });
  });
});
