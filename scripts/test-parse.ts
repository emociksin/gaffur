// parsePrice birim testleri (TR/EN bicim karisikliklari — Mutabakat derslerinden)
import { parsePrice } from '../src/worker/scrape/price';

const cases: [string | number, number | null][] = [
  ['1.299,90', 1299.9],
  ['1.299', 1299],
  ['8.499', 8499],
  ['12.345.678', 12345678],
  ['1299.00', 1299],
  ['1299,90', 1299.9],
  ['1,299.90', 1299.9],
  ['1,299', 1299],
  ['₺1.234,56', 1234.56],
  ['1.234,56 TL', 1234.56],
  ['199 TL', 199],
  ['12.34', 12.34],
  ['0.99', 0.99],
  ['8499.00', 8499],
  [8499, 8499],
  ['', null],
  ['fiyat yok', null],
  ['-50', null],
  ['394.32', 394.32],
  ['890.1', 890.1],
];

let fail = 0;
for (const [input, expect] of cases) {
  const got = parsePrice(input);
  const ok = got === expect;
  if (!ok) {
    fail++;
    console.log('FAIL', JSON.stringify(input), 'beklenen', expect, 'gelen', got);
  }
}
console.log(fail === 0 ? `TUM TESTLER GECTI (${cases.length})` : `${fail} test FAIL`);
process.exit(fail ? 1 : 0);
