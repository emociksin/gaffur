import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { app } from '../src/worker/index';
import { insertNotification } from '../src/worker/db';
import { refreshOpportunityFeed } from '../src/worker/intelligence/opportunities';
import { refreshComplianceAssessments } from '../src/worker/intelligence/compliance';
import { ensureNotificationPreferences, nextDigestAt } from '../src/worker/notifications/delivery';
import { createWebPushRequest } from '../src/worker/notifications/web-push';

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

describe('Faz 7 bildirim, fırsat ve uyum katmanı', () => {
  let db: LocalD1;
  let env: any;
  const t = 1_800_000_000;

  beforeEach(() => {
    db = new LocalD1(':memory:');
    const dir = join(process.cwd(), 'migrations');
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql') && !name.endsWith('.pg.sql')).sort()) {
      db.raw().exec(readFileSync(join(dir, file), 'utf8'));
    }
    env = { DB: db, PUBLIC_BASE_URL: 'https://gaffur.test', PASSWORD: 'admin-test' };
    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, currency, alert_mode, threshold_pct, interval_min, engine,
        active, current_price, list_price, in_stock, stock_status, last_change_at,
        last_checked_at, created_at)
       VALUES (?, 'test', 'Fırsat ürün', 'TRY', 'drop', 0, 60, 'auto',
        1, 80, 120, 1, 'in_stock', ?, ?, ?)`
    ).run('https://shop.test/product', t, t, t - 30 * 86400);
    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, currency, alert_mode, threshold_pct, interval_min, engine,
        active, current_price, in_stock, stock_status, last_checked_at, created_at)
       VALUES (?, 'test', 'Stok dışı ürün', 'TRY', 'drop', 0, 60, 'auto',
        1, 10, 0, 'out_of_stock', ?, ?)`
    ).run('https://shop.test/out', t, t - 30 * 86400);
  });

  it('fırsat akışını 30 günlük medyandan hesaplar ve stok dışını almaz', async () => {
    db.raw().prepare(
      `INSERT INTO price_baselines
       (product_id, median_30d, all_time_low, calculated_at) VALUES (?, ?, ?, ?)`
    ).run(1, 100, 80, t);
    db.raw().prepare(
      `INSERT INTO price_baselines
       (product_id, median_30d, all_time_low, calculated_at) VALUES (?, ?, ?, ?)`
    ).run(2, 20, 10, t);

    const result = await refreshOpportunityFeed(env, t);
    expect(result.count).toBe(1);
    expect(db.raw().prepare('SELECT product_id, drop_pct, at_all_time_low FROM opportunity_feed').all())
      .toEqual([{ product_id: 1, drop_pct: 20, at_all_time_low: 1 }]);
  });

  it('10 günlük araç kesin ihlal demeden şüpheli kanıt üretir', async () => {
    const history = db.raw().prepare(
      'INSERT INTO price_history (product_id, price, list_price, in_stock, checked_at) VALUES (1, ?, ?, 1, ?)'
    );
    history.run(100, 100, t - 9 * 86400);
    history.run(90, 90, t - 2 * 86400);

    await refreshComplianceAssessments(env, t + 60);
    const assessment = db.raw().prepare(
      'SELECT status, advertised_reference, low_10d_before, sample_count, reason FROM compliance_assessments WHERE product_id = 1'
    ).get() as any;
    expect(assessment).toEqual(expect.objectContaining({
      status: 'suspicious',
      advertised_reference: 120,
      low_10d_before: 90,
      sample_count: 2,
    }));
    expect(assessment.reason).not.toMatch(/ihlal/i);
  });

  it('tercih açılınca teslimatı kuyruğa alır ve tek tık iptalde bekleyenleri durdurur', async () => {
    db.raw().prepare(
      `INSERT INTO users (email, password_hash, role, email_verified, kvkk_consent, created_at)
       VALUES ('user@example.com', 'hash', 'user', 1, 1, ?)`
    ).run(t);
    const preferences = await ensureNotificationPreferences(env, 1, t);
    db.raw().prepare(
      `UPDATE notification_preferences SET email_enabled = 1, delivery_mode = 'daily' WHERE user_id = 1`
    ).run();

    const notificationId = await insertNotification(env, {
      user_id: 1,
      product_id: 1,
      kind: 'drop',
      title: 'Fiyat düştü',
      new_price: 80,
    });
    expect(notificationId).toBeGreaterThan(0);
    expect(db.raw().prepare(
      'SELECT channel, delivery_mode, status FROM notification_deliveries WHERE notification_id = ?'
    ).get(notificationId)).toEqual({ channel: 'email', delivery_mode: 'daily', status: 'pending' });

    const response = await app.fetch(new Request(`https://gaffur.test/api/unsubscribe/${preferences.unsubscribe_token}`), env);
    expect(response.status).toBe(200);
    expect(db.raw().prepare(
      'SELECT email_enabled, web_push_enabled FROM notification_preferences WHERE user_id = 1'
    ).get()).toEqual({ email_enabled: 0, web_push_enabled: 0 });
    expect(db.raw().prepare('SELECT status FROM notification_deliveries WHERE notification_id = ?').get(notificationId))
      .toEqual({ status: 'skipped' });
  });

  it('günlük özeti İstanbul saatiyle sonraki 09.00 için planlar', () => {
    const beforeNine = Date.parse('2027-01-15T05:00:00Z') / 1000; // Istanbul 08.00
    const afterNine = Date.parse('2027-01-15T07:00:00Z') / 1000; // Istanbul 10.00
    expect(new Date(nextDigestAt(beforeNine) * 1000).toISOString()).toBe('2027-01-15T06:00:00.000Z');
    expect(new Date(nextDigestAt(afterNine) * 1000).toISOString()).toBe('2027-01-16T06:00:00.000Z');
  });

  it('standart aes128gcm Web Push gövdesi ve VAPID yetkilendirmesi üretir', async () => {
    const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const vapidPublic = new Uint8Array(await crypto.subtle.exportKey('raw', vapidPair.publicKey));
    const vapidPrivateJwk = await crypto.subtle.exportKey('jwk', vapidPair.privateKey);
    const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const receiverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
    const pushEnv = {
      ...env,
      VAPID_SUBJECT: 'mailto:bildirim@gaffur.net',
      VAPID_PUBLIC_KEY: b64url(vapidPublic),
      VAPID_PRIVATE_KEY: vapidPrivateJwk.d,
    };
    const request = await createWebPushRequest(pushEnv, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      p256dh: b64url(receiverPublic),
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
    }, JSON.stringify({ title: 'Fiyat düştü' }), t);

    expect(request.headers['content-encoding']).toBe('aes128gcm');
    expect(request.headers.authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(request.body.length).toBeGreaterThan(16 + 4 + 1 + 65 + 16);
    expect(new DataView(request.body.buffer).getUint32(16, false)).toBe(4096);
    expect(request.body[20]).toBe(65);
  });
});
