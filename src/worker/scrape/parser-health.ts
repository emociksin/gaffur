import type { Env } from '../env';
import { insertNotification } from '../db';

export async function recordParserOutcome(env: Env, site: string, version: string, ok: boolean, t: number): Promise<void> {
  const bucket = t - (t % 3600);
  await env.DB.prepare(
    `INSERT INTO parser_health (site, parser_version, bucket_at, success_count, failure_count, alarm_sent, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(site, parser_version, bucket_at) DO UPDATE SET
       success_count = parser_health.success_count + excluded.success_count,
       failure_count = parser_health.failure_count + excluded.failure_count, updated_at = excluded.updated_at`
  ).bind(site, version, bucket, ok ? 1 : 0, ok ? 0 : 1, t).run();
  const alarm = await env.DB.prepare(
    `UPDATE parser_health SET alarm_sent = 1 WHERE site = ? AND parser_version = ? AND bucket_at = ?
       AND alarm_sent = 0 AND success_count + failure_count >= 10
       AND failure_count * 100 >= (success_count + failure_count) * 50
     RETURNING success_count, failure_count`
  ).bind(site, version, bucket).first<{ success_count: number; failure_count: number }>();
  if (!alarm) return;
  const total = alarm.success_count + alarm.failure_count;
  await insertNotification(env, {
    kind: 'error', title: `${site} parser hata oranı yüksek`,
    body: `${version}: son saatte ${alarm.failure_count}/${total} başarısız (%${Math.round(alarm.failure_count / total * 100)})`,
  });
}
