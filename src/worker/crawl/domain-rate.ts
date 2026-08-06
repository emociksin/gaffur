import type { Env } from '../env';

interface DomainState {
  domain: string;
  next_allowed_at: number;
  consecutive_failures: number;
}

export interface DomainSlot {
  acquired: boolean;
  domain: string;
  retryAt: number;
}

function domainOf(rawUrl: string): string {
  return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
}

function baseDelay(domain: string): number {
  if (domain.endsWith('trendyol.com')) return 3;
  if (domain.endsWith('hepsiburada.com')) return 2;
  return 1;
}

function adaptiveDelay(domain: string, failures: number): number {
  return Math.min(15 * 60, baseDelay(domain) * 2 ** Math.min(failures, 8));
}

export async function acquireDomainSlot(env: Env, rawUrl: string, t: number): Promise<DomainSlot> {
  const domain = domainOf(rawUrl);
  let state = await env.DB.prepare(
    'SELECT domain, next_allowed_at, consecutive_failures FROM crawl_domain_state WHERE domain = ?'
  ).bind(domain).first<DomainState>();
  if (!state) {
    try {
      await env.DB.prepare(
        `INSERT INTO crawl_domain_state (domain, next_allowed_at, consecutive_failures, updated_at)
         VALUES (?, 0, 0, ?)`
      ).bind(domain, t).run();
    } catch { /* eşzamanlı worker satırı oluşturmuş olabilir */ }
    state = await env.DB.prepare(
      'SELECT domain, next_allowed_at, consecutive_failures FROM crawl_domain_state WHERE domain = ?'
    ).bind(domain).first<DomainState>();
  }
  const delay = adaptiveDelay(domain, state?.consecutive_failures ?? 0);
  const claimed = await env.DB.prepare(
    `UPDATE crawl_domain_state SET next_allowed_at = ?, updated_at = ?
     WHERE domain = ? AND next_allowed_at <= ? RETURNING domain, next_allowed_at, consecutive_failures`
  ).bind(t + delay, t, domain, t).first<DomainState>();
  if (claimed) return { acquired: true, domain, retryAt: claimed.next_allowed_at };
  const current = await env.DB.prepare(
    'SELECT next_allowed_at FROM crawl_domain_state WHERE domain = ?'
  ).bind(domain).first<{ next_allowed_at: number }>();
  return { acquired: false, domain, retryAt: current?.next_allowed_at ?? t + delay };
}

export async function recordDomainResult(env: Env, domain: string, ok: boolean, t: number): Promise<void> {
  if (ok) {
    await env.DB.prepare(
      `UPDATE crawl_domain_state SET consecutive_failures = 0, success_count = success_count + 1,
       last_status = 'ok', updated_at = ? WHERE domain = ?`
    ).bind(t, domain).run();
    return;
  }
  const state = await env.DB.prepare(
    'SELECT consecutive_failures FROM crawl_domain_state WHERE domain = ?'
  ).bind(domain).first<{ consecutive_failures: number }>();
  const failures = (state?.consecutive_failures ?? 0) + 1;
  const retryAt = t + adaptiveDelay(domain, failures);
  await env.DB.prepare(
    `UPDATE crawl_domain_state SET consecutive_failures = ?, failure_count = failure_count + 1,
       next_allowed_at = CASE WHEN next_allowed_at > ? THEN next_allowed_at ELSE ? END,
       last_status = 'failed', updated_at = ? WHERE domain = ?`
  ).bind(failures, retryAt, retryAt, t, domain).run();
}
