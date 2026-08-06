import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { acquireDomainSlot, recordDomainResult } from '../src/worker/crawl/domain-rate';

describe('domain hız sınırı', () => {
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

  it('aynı domain için tek slot verir', async () => {
    const first = await acquireDomainSlot(env, 'https://www.trendyol.com/urun', t);
    expect(first).toEqual({ acquired: true, domain: 'trendyol.com', retryAt: t + 3 });
    expect(await acquireDomainSlot(env, 'https://trendyol.com/baska', t)).toEqual({
      acquired: false, domain: 'trendyol.com', retryAt: t + 3,
    });
    expect((await acquireDomainSlot(env, 'https://trendyol.com/baska', t + 3)).acquired).toBe(true);
  });

  it('başarısızlıkta aralığı katlar, başarıda tabana döndürür', async () => {
    const first = await acquireDomainSlot(env, 'https://trendyol.com/urun', t);
    await recordDomainResult(env, first.domain, false, t);
    const state = await db.prepare(
      'SELECT consecutive_failures, failure_count, next_allowed_at FROM crawl_domain_state WHERE domain = ?'
    ).bind('trendyol.com').first<any>();
    expect(state).toEqual({ consecutive_failures: 1, failure_count: 1, next_allowed_at: t + 6 });
    expect((await acquireDomainSlot(env, 'https://trendyol.com/urun', t + 3)).acquired).toBe(false);

    const retry = await acquireDomainSlot(env, 'https://trendyol.com/urun', t + 6);
    expect(retry.acquired).toBe(true);
    await recordDomainResult(env, retry.domain, true, t + 6);
    const recovered = await db.prepare(
      'SELECT consecutive_failures, success_count, last_status FROM crawl_domain_state WHERE domain = ?'
    ).bind('trendyol.com').first<any>();
    expect(recovered).toEqual({ consecutive_failures: 0, success_count: 1, last_status: 'ok' });
  });
});
