import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { app } from '../src/worker/index';

describe('kullanıcı hesabı ve watch akışı', () => {
  let db: LocalD1;
  let env: any;

  beforeEach(() => {
    db = new LocalD1(':memory:');
    const migrationDir = join(process.cwd(), 'migrations');
    for (const file of readdirSync(migrationDir).filter((f) => f.endsWith('.sql') && !f.endsWith('.pg.sql')).sort()) {
      db.raw().exec(readFileSync(join(migrationDir, file), 'utf8'));
    }
    db.raw().prepare(
      `INSERT INTO products
       (url, site, title, currency, alert_mode, threshold_pct, interval_min, engine, active, created_at)
       VALUES (?, ?, ?, 'TRY', 'drop', 0, 60, 'auto', 1, ?)`
    ).run('https://example.com/product', 'generic', 'Test ürünü', Math.floor(Date.now() / 1000));
    env = { DB: db, PASSWORD: 'yönetici-parolası' };
  });

  it('yönetici oturumu olmadan kayıt olur ve kendi watch listesini yönetir', async () => {
    const register = await app.fetch(new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: '12345678', kvkk_consent: true }),
    }), env);
    expect(register.status).toBe(200);
    const cookie = register.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toContain('gfr_u=');

    const add = await app.fetch(new Request('http://localhost/api/watches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie! },
      body: JSON.stringify({ product_id: 1 }),
    }), env);
    expect(add.status).toBe(200);

    const list = await app.fetch(new Request('http://localhost/api/watches', {
      headers: { cookie: cookie! },
    }), env);
    expect(list.status).toBe(200);
    const body = await list.json() as { watches: { product_id: number; title: string }[] };
    expect(body.watches).toEqual([expect.objectContaining({ product_id: 1, title: 'Test ürünü' })]);
  });
});
