// D1 uyumlu ince katman: Worker kodu degismeden node:sqlite uzerinde calisir.
// Kullanilan D1 yuzeyi kucuk: prepare/bind/first/all/run/exec + meta.last_row_id
import { DatabaseSync } from 'node:sqlite';

type Arg = string | number | bigint | null | Uint8Array;

function normalize(v: unknown): Arg {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  return String(v);
}

class Statement {
  #db: DatabaseSync;
  #sql: string;
  #args: Arg[] = [];

  constructor(db: DatabaseSync, sql: string) {
    this.#db = db;
    this.#sql = sql;
  }

  bind(...args: unknown[]): Statement {
    this.#args = args.map(normalize);
    return this;
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.#db.prepare(this.#sql).get(...this.#args);
    return Promise.resolve((row as T) ?? null);
  }

  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const rows = this.#db.prepare(this.#sql).all(...this.#args) as T[];
    return Promise.resolve({ results: rows, success: true });
  }

  run(): Promise<{ success: true; meta: { last_row_id: number; changes: number } }> {
    const r = this.#db.prepare(this.#sql).run(...this.#args);
    return Promise.resolve({
      success: true,
      meta: { last_row_id: Number(r.lastInsertRowid ?? 0), changes: Number(r.changes ?? 0) },
    });
  }
}

export class LocalD1 {
  #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec('PRAGMA busy_timeout = 5000;');
    this.#db.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(sql: string): Statement {
    return new Statement(this.#db, sql);
  }

  exec(sql: string): Promise<{ count: number }> {
    this.#db.exec(sql);
    return Promise.resolve({ count: 0 });
  }

  batch(statements: Statement[]): Promise<unknown[]> {
    return Promise.all(statements.map((s) => s.run()));
  }

  raw(): DatabaseSync {
    return this.#db;
  }
}
