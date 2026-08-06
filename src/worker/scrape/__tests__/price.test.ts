import { describe, it, expect } from 'vitest';
import { parsePrice } from '../price';

describe('parsePrice', () => {
  const cases: [string, number | null][] = [
    ['8.499', 8499],
    ['8.499,00', 8499],
    ['1.299,90', 1299.9],
    ['1,299.90', 1299.9],
    ['394.32', 394.32],
    ['₺12.999', 12999],
    ['$1,299.99', 1299.99],
    ['€499.00', 499],
    ['15,00 TL', 15],
    ['0.99', 0.99],
    ['1.234.567,89', 1234567.89],
    ['abc', null],
    ['', null],
  ];

  for (const [input, expected] of cases) {
    it(`parsePrice("${input}") → ${expected}`, () => {
      expect(parsePrice(input)).toBe(expected);
    });
  }
});
