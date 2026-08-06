import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { parserVersionFor, parseWithRegistry } from '../src/worker/scrape/registry';
import { recordParserOutcome } from '../src/worker/scrape/parser-health';

describe('parser registry ve sağlık alarmı', () => {
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

  it('siteye kararlı parser sürümü atar', () => {
    expect(parserVersionFor('trendyol')).toBe('trendyol-2026.08.2');
    expect(parserVersionFor('magaza.test')).toBe('generic-2026.08.2');
    expect(parseWithRegistry('magaza.test', '<script type="application/ld+json">{"@type":"Product","offers":{"price":99}}</script>'))
      .toEqual(expect.objectContaining({ parserVersion: 'generic-2026.08.2', data: expect.objectContaining({ price: 99 }) }));
  });

  it('10 örnekte yüzde 50+ hata için saatlik tek alarm üretir', async () => {
    for (let i = 0; i < 9; i++) await recordParserOutcome(env, 'trendyol', 'v-test', false, t + i);
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 0 });
    await recordParserOutcome(env, 'trendyol', 'v-test', false, t + 9);
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 1 });
    await recordParserOutcome(env, 'trendyol', 'v-test', false, t + 10);
    expect(db.raw().prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 1 });
  });
});
