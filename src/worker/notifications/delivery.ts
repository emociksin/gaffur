import type { Env } from '../env';
import { publicProductPath } from '../../shared/routes';
import { escapeHtml, sendEmail, type DeliveryAttempt } from './email';
import { sendWebPush } from './web-push';

const DAY_S = 86_400;
const ISTANBUL_OFFSET_S = 3 * 3600;
const DIGEST_HOUR = 9;

export interface NotificationPreferencesRow {
  user_id: number;
  email_enabled: number;
  web_push_enabled: number;
  delivery_mode: 'instant' | 'daily';
  unsubscribe_token: string;
  unsubscribed_at: number | null;
  updated_at: number;
}

export interface DispatchReport {
  attempted: number;
  sent: number;
  failed: number;
  pendingConfiguration: number;
}

interface DeliveryRow {
  delivery_id: number;
  notification_id: number;
  user_id: number;
  channel: 'email' | 'web_push';
  delivery_mode: 'instant' | 'daily';
  attempt_count: number;
  title: string;
  body: string | null;
  new_price: number | null;
  created_at: number;
  product_id: number | null;
  product_title: string | null;
  email: string;
  email_verified: number;
  unsubscribe_token: string;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function nextDigestAt(t: number): number {
  const dayStart = Math.floor((t + ISTANBUL_OFFSET_S) / DAY_S) * DAY_S - ISTANBUL_OFFSET_S;
  const today = dayStart + DIGEST_HOUR * 3600;
  return today > t ? today : today + DAY_S;
}

export async function ensureNotificationPreferences(env: Env, userId: number, t: number): Promise<NotificationPreferencesRow> {
  const existing = await env.DB.prepare('SELECT * FROM notification_preferences WHERE user_id = ?')
    .bind(userId).first<NotificationPreferencesRow>();
  if (existing) return existing;
  await env.DB.prepare(
    `INSERT INTO notification_preferences
     (user_id, email_enabled, web_push_enabled, delivery_mode, unsubscribe_token, updated_at)
     VALUES (?, 0, 0, 'instant', ?, ?)`
  ).bind(userId, randomToken(), t).run();
  return (await env.DB.prepare('SELECT * FROM notification_preferences WHERE user_id = ?')
    .bind(userId).first<NotificationPreferencesRow>())!;
}

export async function queueNotificationDeliveries(
  env: Env,
  notificationId: number,
  userId: number,
  t: number
): Promise<void> {
  const preferences = await ensureNotificationPreferences(env, userId, t);
  if (preferences.unsubscribed_at != null) return;
  const nextAt = preferences.delivery_mode === 'daily' ? nextDigestAt(t) : t;
  const channels: Array<'email' | 'web_push'> = [];
  if (preferences.email_enabled) channels.push('email');
  if (preferences.web_push_enabled) channels.push('web_push');
  for (const channel of channels) {
    await env.DB.prepare(
      `INSERT INTO notification_deliveries
       (notification_id, user_id, channel, delivery_mode, status, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(notification_id, channel) DO NOTHING`
    ).bind(notificationId, userId, channel, preferences.delivery_mode, nextAt, t).run();
  }
}

function origin(env: Env): string {
  return (env.PUBLIC_BASE_URL || 'https://gaffur.net').replace(/\/$/, '');
}

function productUrl(env: Env, row: DeliveryRow): string {
  if (!row.product_id) return origin(env);
  return origin(env) + publicProductPath({ id: row.product_id, title: row.product_title || row.body || 'urun' });
}

function money(value: number | null): string {
  return value == null ? '' : new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value);
}

function emailHtml(env: Env, rows: DeliveryRow[]): string {
  const unsubscribe = `${origin(env)}/api/unsubscribe/${encodeURIComponent(rows[0].unsubscribe_token)}`;
  const items = rows.map((row) => `
    <li style="margin:0 0 16px">
      <strong>${escapeHtml(row.title)}</strong><br>
      <span>${escapeHtml(row.product_title || row.body || '')}</span>
      ${row.new_price == null ? '' : `<br><b>${escapeHtml(money(row.new_price))}</b>`}
      <br><a href="${escapeHtml(productUrl(env, row))}">Ürünü görüntüle</a>
    </li>`).join('');
  return `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;color:#201a13">
    <h2>Gaffur fiyat bildirimi</h2>
    <ul style="padding-left:20px">${items}</ul>
    <p style="font-size:12px;color:#6d6256">Bu bildirimleri hesabındaki tercihlerden değiştirebilirsin.</p>
    <p><a href="${escapeHtml(unsubscribe)}">Tüm e-posta ve web push bildirimlerini tek tıkla kapat</a></p>
  </body></html>`;
}

async function deliverEmail(env: Env, rows: DeliveryRow[]): Promise<DeliveryAttempt> {
  if (!rows[0].email_verified) {
    return { ok: false, configured: true, expired: true, error: 'E-posta doğrulanmamış' };
  }
  const unsubscribeUrl = `${origin(env)}/api/unsubscribe/${encodeURIComponent(rows[0].unsubscribe_token)}`;
  return sendEmail(env, {
    to: rows[0].email,
    subject: rows.length > 1 ? `Gaffur günlük özetin: ${rows.length} gelişme` : rows[0].title,
    html: emailHtml(env, rows),
    unsubscribeUrl,
  });
}

async function deliverPush(env: Env, rows: DeliveryRow[], t: number): Promise<DeliveryAttempt> {
  const subscriptions = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
     WHERE user_id = ? AND active = 1`
  ).bind(rows[0].user_id).all<{ id: number; endpoint: string; p256dh: string; auth: string }>();
  if (!(subscriptions.results ?? []).length) {
    return { ok: false, configured: true, expired: true, error: 'Aktif web push aboneliği yok' };
  }

  let sent = 0;
  let configured = true;
  let allExpired = true;
  let lastError = '';
  for (const subscription of subscriptions.results ?? []) {
    const first = rows[0];
    const result = await sendWebPush(env, subscription, {
      title: (rows.length > 1 ? `Gaffur: ${rows.length} yeni fiyat gelişmesi` : first.title).slice(0, 100),
      body: (rows.length > 1 ? 'Günlük özetini görmek için dokun.' : (first.product_title || first.body || '')).slice(0, 240),
      url: productUrl(env, first),
      tag: rows.length > 1 ? `gaffur-digest-${first.user_id}` : `gaffur-notification-${first.notification_id}`,
    });
    configured = configured && result.configured;
    if (!result.expired) allExpired = false;
    lastError = result.error || lastError;
    if (result.ok) {
      sent++;
      await env.DB.prepare(
        'UPDATE push_subscriptions SET fail_count = 0, last_error = NULL, last_success_at = ?, updated_at = ? WHERE id = ?'
      ).bind(t, t, subscription.id).run();
    } else if (result.expired) {
      await env.DB.prepare(
        'UPDATE push_subscriptions SET active = 0, fail_count = fail_count + 1, last_error = ?, updated_at = ? WHERE id = ?'
      ).bind(result.error ?? 'Abonelik sona erdi', t, subscription.id).run();
    } else if (result.configured) {
      await env.DB.prepare(
        'UPDATE push_subscriptions SET fail_count = fail_count + 1, last_error = ?, updated_at = ? WHERE id = ?'
      ).bind(result.error ?? 'Gönderilemedi', t, subscription.id).run();
    }
  }
  if (sent) return { ok: true, configured: true };
  return { ok: false, configured, expired: configured && allExpired, error: lastError || 'Web push gönderilemedi' };
}

async function updateRows(env: Env, rows: DeliveryRow[], result: DeliveryAttempt, t: number): Promise<'sent' | 'failed' | 'pending'> {
  if (result.ok) {
    for (const row of rows) {
      await env.DB.prepare(
        `UPDATE notification_deliveries
         SET status = 'sent', sent_at = ?, last_error = NULL, attempt_count = attempt_count + 1
         WHERE id = ?`
      ).bind(t, row.delivery_id).run();
    }
    return 'sent';
  }
  if (!result.configured) {
    for (const row of rows) {
      await env.DB.prepare(
        'UPDATE notification_deliveries SET last_error = ?, next_attempt_at = ? WHERE id = ?'
      ).bind(result.error ?? 'Kanal yapılandırılmadı', t + 6 * 3600, row.delivery_id).run();
    }
    return 'pending';
  }
  for (const row of rows) {
    const attempts = row.attempt_count + 1;
    const terminal = result.expired || attempts >= 5;
    await env.DB.prepare(
      `UPDATE notification_deliveries
       SET status = ?, attempt_count = ?, last_error = ?, next_attempt_at = ?
       WHERE id = ?`
    ).bind(
      terminal ? 'failed' : 'pending',
      attempts,
      result.error ?? 'Teslimat başarısız',
      t + Math.min(6 * 3600, 300 * 2 ** Math.min(attempts, 6)),
      row.delivery_id
    ).run();
  }
  return 'failed';
}

export async function dispatchPendingNotifications(env: Env, t: number, limit = 100): Promise<DispatchReport> {
  const query = await env.DB.prepare(
    `SELECT d.id AS delivery_id, d.notification_id, d.user_id, d.channel,
            d.delivery_mode, d.attempt_count, n.title, n.body, n.new_price,
            n.created_at, n.product_id, p.title AS product_title,
            u.email, u.email_verified, pref.unsubscribe_token
     FROM notification_deliveries d
     JOIN notifications n ON n.id = d.notification_id
     JOIN users u ON u.id = d.user_id
     JOIN notification_preferences pref ON pref.user_id = d.user_id
     LEFT JOIN products p ON p.id = n.product_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= ?
       AND pref.unsubscribed_at IS NULL
       AND ((d.channel = 'email' AND pref.email_enabled = 1)
         OR (d.channel = 'web_push' AND pref.web_push_enabled = 1))
     ORDER BY d.next_attempt_at ASC, d.id ASC
     LIMIT ?`
  ).bind(t, limit).all<DeliveryRow>();
  const rows = query.results ?? [];
  const groups = new Map<string, DeliveryRow[]>();
  for (const row of rows) {
    const key = row.delivery_mode === 'daily'
      ? `${row.user_id}:${row.channel}:daily`
      : `${row.user_id}:${row.channel}:${row.delivery_id}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const report: DispatchReport = { attempted: 0, sent: 0, failed: 0, pendingConfiguration: 0 };
  for (const group of groups.values()) {
    report.attempted += group.length;
    const result = group[0].channel === 'email'
      ? await deliverEmail(env, group)
      : await deliverPush(env, group, t);
    const state = await updateRows(env, group, result, t);
    if (state === 'sent') report.sent += group.length;
    else if (state === 'pending' && !result.configured) report.pendingConfiguration += group.length;
    else report.failed += group.length;
  }
  return report;
}

export async function unsubscribeExternalNotifications(env: Env, token: string, t: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT user_id FROM notification_preferences WHERE unsubscribe_token = ?')
    .bind(token).first<{ user_id: number }>();
  if (!row) return false;
  await env.DB.prepare(
    `UPDATE notification_preferences
     SET email_enabled = 0, web_push_enabled = 0, unsubscribed_at = ?, updated_at = ?
     WHERE user_id = ?`
  ).bind(t, t, row.user_id).run();
  await env.DB.prepare('UPDATE push_subscriptions SET active = 0, updated_at = ? WHERE user_id = ?')
    .bind(t, row.user_id).run();
  await env.DB.prepare(
    `UPDATE notification_deliveries SET status = 'skipped', last_error = 'Kullanıcı abonelikten çıktı'
     WHERE user_id = ? AND status = 'pending'`
  ).bind(row.user_id).run();
  return true;
}
