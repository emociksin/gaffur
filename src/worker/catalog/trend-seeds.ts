import type { TrendCatalogKind, TrendSignalType } from '../../shared/types';

export const TREND_CAPTURED_AT = 1_785_974_400; // 2026-08-06 00:00:00 UTC
export const TREND_TIMEFRAME = 'today 12-m';
export const TREND_CATEGORY = 'Bilgisayarlar ve Elektronik Ürünler';
export const TREND_SCOPE = 'Türkiye · Son 12 ay · Bilgisayarlar ve Elektronik Ürünler · Web Araması';

interface SeedInput {
  query: string;
  kind: TrendCatalogKind;
  anchor: string;
  anchorRank: number | null;
  anchorInterest: number | null;
  type: TrendSignalType;
  rank: number;
  interest?: number;
  growth?: string;
}

const exploreUrl = (query?: string) => {
  const params = new URLSearchParams({
    date: TREND_TIMEFRAME,
    geo: 'TR',
    cat: '5',
    hl: 'tr',
  });
  if (query) params.set('q', query);
  return `https://trends.google.com/trends/explore?${params.toString()}`;
};

const anchor = (
  name: string,
  anchorRank: number | null,
  anchorInterest: number | null,
  items: Array<Omit<SeedInput, 'anchor' | 'anchorRank' | 'anchorInterest'>>
): SeedInput[] => items.map((item) => ({ ...item, anchor: name, anchorRank, anchorInterest }));

const inputs: SeedInput[] = [
  ...anchor('apple', 3, 88, [
    { query: 'apple watch', kind: 'product_family', type: 'top', rank: 1, interest: 100 },
    { query: 'apple macbook', kind: 'product_family', type: 'top', rank: 2, interest: 99 },
    { query: 'apple 17', kind: 'product_family', type: 'top', rank: 4, interest: 86 },
    { query: 'apple şarj', kind: 'accessory', type: 'top', rank: 5, interest: 82 },
    { query: 'apple 16', kind: 'product_family', type: 'top', rank: 6, interest: 82 },
    { query: 'apple ipad', kind: 'product_family', type: 'top', rank: 7, interest: 78 },
    { query: 'apple air', kind: 'product_family', type: 'top', rank: 8, interest: 70 },
    { query: 'apple 15', kind: 'product_family', type: 'top', rank: 9, interest: 61 },
    { query: 'apple tv', kind: 'product_family', type: 'top', rank: 10, interest: 61 },
    { query: 'apple watch 11 46mm', kind: 'product_family', type: 'rising', rank: 1, growth: 'Breakout' },
    { query: 'apple iphone 17 pro max', kind: 'product_family', type: 'rising', rank: 6, growth: 'Breakout' },
  ]),
  ...anchor('bilgisayar', 5, 76, [
    { query: 'bilgisayar fiyatları', kind: 'category', type: 'top', rank: 3, interest: 7 },
    { query: 'masaüstü bilgisayar', kind: 'category', type: 'top', rank: 4, interest: 7 },
    { query: 'dizüstü bilgisayar', kind: 'category', type: 'top', rank: 5, interest: 6 },
    { query: 'laptop bilgisayar', kind: 'category', type: 'top', rank: 7, interest: 5 },
    { query: 'asus bilgisayar', kind: 'product_family', type: 'top', rank: 8, interest: 5 },
    { query: 'lenovo bilgisayar', kind: 'product_family', type: 'top', rank: 10, interest: 5 },
  ]),
  ...anchor('tablet', 17, 47, [
    { query: 'tablet samsung', kind: 'product_family', type: 'top', rank: 1, interest: 100 },
    { query: 'tablet fiyatları', kind: 'category', type: 'top', rank: 2, interest: 45 },
    { query: 'lenovo tablet', kind: 'product_family', type: 'top', rank: 3, interest: 35 },
    { query: 'tablet apple', kind: 'product_family', type: 'top', rank: 4, interest: 31 },
    { query: 'galaxy tablet', kind: 'product_family', type: 'top', rank: 5, interest: 24 },
    { query: 'ipad tablet', kind: 'product_family', type: 'top', rank: 6, interest: 23 },
    { query: 'huawei', kind: 'brand', type: 'top', rank: 7, interest: 23 },
    { query: 'huawei tablet', kind: 'product_family', type: 'top', rank: 8, interest: 22 },
    { query: 'tablet kalemi', kind: 'accessory', type: 'top', rank: 9, interest: 21 },
    { query: 'samsung galaxy tablet', kind: 'product_family', type: 'top', rank: 10, interest: 19 },
  ]),
  ...anchor('asus', 18, 45, [
    { query: 'asus rog', kind: 'product_family', type: 'top', rank: 1, interest: 100 },
    { query: 'asus tuf', kind: 'product_family', type: 'top', rank: 2, interest: 51 },
    { query: 'asus rog strix', kind: 'product_family', type: 'top', rank: 3, interest: 39 },
    { query: 'asus tuf gaming', kind: 'product_family', type: 'top', rank: 4, interest: 34 },
    { query: 'asus laptop', kind: 'product_family', type: 'top', rank: 5, interest: 31 },
    { query: 'asus monitör', kind: 'product_family', type: 'top', rank: 6, interest: 25 },
    { query: 'asus vivobook', kind: 'product_family', type: 'top', rank: 7, interest: 19 },
    { query: 'asus prime', kind: 'product_family', type: 'top', rank: 8, interest: 19 },
    { query: 'asus oled', kind: 'product_family', type: 'top', rank: 9, interest: 16 },
    { query: 'asus anakart', kind: 'product_family', type: 'top', rank: 10, interest: 16 },
  ]),
  ...anchor('laptop', 21, 40, [
    { query: 'lenovo laptop', kind: 'product_family', type: 'top', rank: 1, interest: 100 },
    { query: 'laptop asus', kind: 'product_family', type: 'top', rank: 2, interest: 90 },
    { query: 'gaming laptop', kind: 'category', type: 'top', rank: 3, interest: 85 },
    { query: 'laptop gaming', kind: 'category', type: 'top', rank: 4, interest: 85 },
    { query: 'hp laptop', kind: 'product_family', type: 'top', rank: 5, interest: 82 },
    { query: 'laptop ram', kind: 'accessory', type: 'top', rank: 6, interest: 74 },
    { query: 'laptop fiyatları', kind: 'category', type: 'top', rank: 7, interest: 60 },
    { query: 'laptop ssd', kind: 'accessory', type: 'top', rank: 8, interest: 54 },
    { query: 'monster laptop', kind: 'product_family', type: 'top', rank: 9, interest: 49 },
    { query: 'monster', kind: 'brand', type: 'top', rank: 10, interest: 49 },
  ]),
  ...anchor(TREND_CATEGORY, null, null, [
    { query: 'xiaomi 17 pro', kind: 'product_family', type: 'rising', rank: 1, growth: 'Breakout' },
    { query: 'xiaomi 17 pro max', kind: 'product_family', type: 'rising', rank: 2, growth: 'Breakout' },
    { query: 'iphone 17', kind: 'product_family', type: 'rising', rank: 6, growth: '+2450%' },
  ]),
];

export interface TrendCatalogSeed extends SeedInput {
  normalizedQuery: string;
  sourceUrl: string;
  queryUrl: string;
}

export const TREND_CATALOG_SEEDS: TrendCatalogSeed[] = inputs.map((item) => ({
  ...item,
  normalizedQuery: item.query.toLocaleLowerCase('tr-TR').normalize('NFKC'),
  sourceUrl: exploreUrl(item.anchor === TREND_CATEGORY ? undefined : item.anchor),
  queryUrl: exploreUrl(item.query),
}));

if (TREND_CATALOG_SEEDS.length !== 50) {
  throw new Error(`Faz 9 trend kataloğu 50 kayıt olmalı; bulunan: ${TREND_CATALOG_SEEDS.length}`);
}
