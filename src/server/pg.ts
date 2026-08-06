// D1 uyumlu Postgres katmani: uygulama kodu degismeden Postgres uzerinde calisir.
import postgresLib from 'postgres';

type Arg = string | number | bigint | null | Uint8Array | boolean | undefined;

function normalize(v: unknown): Arg {
  if (v === undefined) return null;
  return v as Arg;
}

class PgStatement {
  #sql: postgresLib.Sql;
  #query: string;
  #args: Arg[] = [];

  constructor(sql: postgresLib.Sql, query: string) {
    this.#sql = sql;
    // D1 uses ? placeholders, Postgres uses $1, $2, ...
    let idx = 0;
    this.#query = query.replace(/\?/g, () => `$${++idx}`);
  }

  bind(...args: unknown[]): PgStatement {
    this.#args = args.map(normalize);
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = await this.#sql.unsafe(this.#query, this.#args as any[]);
    return (rows[0] as T) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const rows = await this.#sql.unsafe(this.#query, this.#args as any[]);
    return { results: rows as unknown as T[], success: true };
  }

  async run(): Promise<{ success: true; meta: { last_row_id: number; changes: number } }> {
    // INSERT sorgularina RETURNING id ekle (D1 uyumu icin last_row_id gerekli)
    let q = this.#query;
    if (/^\s*INSERT\b/i.test(q) && !/RETURNING/i.test(q)) {
      q = q.replace(/\s*$/, ' RETURNING id');
    }
    const rows = await this.#sql.unsafe(q, this.#args as any[]);
    const lastId = (rows[0] as any)?.id ?? 0;
    return { success: true, meta: { last_row_id: lastId, changes: rows.count } };
  }
}

export class PgD1 {
  #sql: postgresLib.Sql;

  constructor(url: string) {
    this.#sql = postgresLib(url, { max: 10 });
  }

  prepare(sql: string): PgStatement {
    return new PgStatement(this.#sql, sql);
  }

  async exec(sql: string): Promise<{ count: number }> {
    await this.#sql.unsafe(sql);
    return { count: 0 };
  }

  async batch(statements: PgStatement[]): Promise<unknown[]> {
    return Promise.all(statements.map((s) => s.run()));
  }

  async end(): Promise<void> {
    await this.#sql.end();
  }

  /** Postgres migration'lari calistir (SQLite'tan farkli syntax) */
  async runMigrations(migrationsDir: string): Promise<void> {
    const { readdirSync, readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    await this.#sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    const applied = new Set(
      (await this.#sql.unsafe('SELECT name FROM _migrations')).map((r: any) => r.name)
    );

    if (!existsSync(migrationsDir)) return;
    const files = readdirSync(migrationsDir).filter((f: string) => f.endsWith('.pg.sql')).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = readFileSync(join(migrationsDir, f), 'utf8');
      await this.#sql.unsafe(sql);
      await this.#sql.unsafe(
        'INSERT INTO _migrations (name, applied_at) VALUES ($1, $2)',
        [f, Math.floor(Date.now() / 1000)]
      );
      console.log('[pg-migration] uygulandi:', f);
    }
  }
}
