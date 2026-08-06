// SQLite → Postgres veri tasima (tek seferlik, idempotent).
// Kullanim: DATABASE_URL=postgres://... npx tsx scripts/backfill-pg.ts
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'gaffur.db');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) { console.error('DATABASE_URL gerekli'); process.exit(1); }

const lite = new DatabaseSync(DB_PATH);
const pg = postgres(DATABASE_URL);

const tables = ['categories', 'products', 'price_history', 'notifications', 'settings', 'login_attempts', 'rate_limits'];

for (const table of tables) {
  const rows = lite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  if (!rows.length) { console.log(`${table}: bos`); continue; }
  const cols = Object.keys(rows[0]);
  const colList = cols.join(', ');
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  // id kolonlu tablolarda ON CONFLICT(id) ile idempotent
  const hasId = cols.includes('id');
  const hasKey = cols.includes('key');
  const hasPk = cols.includes('k') || cols.includes('ip');
  let conflict = '';
  if (hasId) conflict = ` ON CONFLICT (id) DO NOTHING`;
  else if (hasKey) conflict = ` ON CONFLICT (key) DO NOTHING`;
  else if (cols.includes('k')) conflict = ` ON CONFLICT (k) DO NOTHING`;
  else if (cols.includes('ip')) conflict = ` ON CONFLICT (ip) DO NOTHING`;

  let count = 0;
  for (const row of rows) {
    const vals = cols.map(c => row[c] ?? null);
    await pg.unsafe(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})${conflict}`, vals);
    count++;
  }
  // id sequence'ini ayarla
  if (hasId && rows.length) {
    const maxId = Math.max(...rows.map(r => Number(r.id)));
    await pg.unsafe(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), $1, true)`, [maxId]);
  }
  console.log(`${table}: ${count} satir`);
}

await pg.end();
lite.close();
console.log('Backfill tamamlandi.');
