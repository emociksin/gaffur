const TURKISH_FOLD: Record<string, string> = {
  'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i',
  'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u',
};

const STOP_WORDS = new Set([
  've', 'ile', 'icin', 'uyumlu', 'orijinal', 'original', 'resmi', 'distributor',
  'garantili', 'garanti', 'ithalatci', 'turkiye', 'yeni', 'sifir', 'urun', 'model',
  'adet', 'paket', 'hediye', 'ucretsiz', 'kargo', 'firsat', 'kampanya', 'renk',
]);

const KNOWN_BRANDS = new Set([
  'acer', 'anker', 'apple', 'arcelik', 'asus', 'beko', 'bosch', 'canon', 'dell',
  'dyson', 'epson', 'grundig', 'honor', 'hp', 'huawei', 'jbl', 'lenovo', 'lg',
  'logitech', 'msi', 'nintendo', 'oppo', 'philips', 'playstation', 'realme', 'redmi',
  'samsung', 'siemens', 'sony', 'tefal', 'vestel', 'vivo', 'xiaomi',
]);

const COLOR_MAP: Record<string, string> = {
  black: 'siyah', siyah: 'siyah', siyahi: 'siyah', white: 'beyaz', beyaz: 'beyaz', beyazi: 'beyaz',
  blue: 'mavi', mavi: 'mavi', mavisi: 'mavi', navy: 'lacivert', lacivert: 'lacivert', laciverti: 'lacivert',
  gray: 'gri', grey: 'gri', gri: 'gri', grisi: 'gri', silver: 'gumus', gumus: 'gumus', gumusu: 'gumus',
  gold: 'altin', altin: 'altin', altini: 'altin', green: 'yesil', yesil: 'yesil', yesili: 'yesil',
  red: 'kirmizi', kirmizi: 'kirmizi', kirmizisi: 'kirmizi', purple: 'mor', mor: 'mor', moru: 'mor',
  pink: 'pembe', pembe: 'pembe', pembesi: 'pembe', orange: 'turuncu', turuncu: 'turuncu', turuncusu: 'turuncu',
  beige: 'bej', bej: 'bej', beji: 'bej', titanium: 'titanyum', titanyum: 'titanyum', titanyumu: 'titanyum',
};

export interface NormalizedIdentity {
  normalizedTitle: string;
  normalizedBrand: string | null;
  modelKey: string | null;
  variantKey: string | null;
  tokens: string[];
  modelTokens: string[];
  variants: { capacities: string[]; colors: string[] };
}

export function foldTurkish(value: string): string {
  return value
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TURKISH_FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function capacityVariants(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const joined = tokens[i].match(/^(\d+(?:\.\d+)?)(gb|tb|mb)$/);
    if (joined) {
      out.push(`${Number(joined[1])}${joined[2]}`);
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(tokens[i]) && /^(gb|tb|mb)$/.test(tokens[i + 1] ?? '')) {
      out.push(`${Number(tokens[i])}${tokens[i + 1]}`);
      i++;
    }
  }
  return unique(out);
}

export function normalizeMpn(value?: string | null): { value: string | null; reliable: boolean } {
  const normalized = foldTurkish(value ?? '').replace(/\s+/g, '').toUpperCase();
  if (!normalized || normalized.length < 4 || normalized.length > 48) return { value: normalized || null, reliable: false };
  const reliable = /[A-Z]/.test(normalized) && /\d/.test(normalized) && !/^(MODEL|URUN|PRODUCT|SKU)/.test(normalized);
  return { value: normalized, reliable };
}

export function normalizeGtin(value?: string | null): { value: string | null; valid: boolean } {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if ((raw && /[^\d\s-]/.test(raw)) || ![8, 12, 13, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) {
    return { value: digits || null, valid: false };
  }
  const check = Number(digits.at(-1));
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 2; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return { value: digits, valid: (10 - (sum % 10)) % 10 === check };
}

export function normalizeIdentity(input: { title: string; brand?: string | null }): NormalizedIdentity {
  const normalizedTitle = foldTurkish(input.title);
  const rawTokens = normalizedTitle ? normalizedTitle.split(' ') : [];
  const explicitBrand = foldTurkish(input.brand ?? '').split(' ')[0] || null;
  const detectedBrand = explicitBrand ?? rawTokens.find((token) => KNOWN_BRANDS.has(token)) ?? null;
  const capacities = capacityVariants(rawTokens);
  const colors = unique(rawTokens.map((token) => COLOR_MAP[token]).filter(Boolean));
  const variantTokens = new Set([
    ...capacities.flatMap((capacity) => [capacity, capacity.replace(/(gb|tb|mb)$/, '')]),
    ...Object.keys(COLOR_MAP).filter((key) => rawTokens.includes(key)),
    'gb', 'tb', 'mb',
  ]);
  const tokens = unique(rawTokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
  const modelTokens = tokens.filter((token) => token !== detectedBrand && !variantTokens.has(token));
  const modelKey = modelTokens.length ? modelTokens.slice(0, 10).join(' ') : null;
  const variantParts = [...capacities.map((v) => `capacity:${v}`), ...colors.map((v) => `color:${v}`)];
  return {
    normalizedTitle,
    normalizedBrand: detectedBrand,
    modelKey,
    variantKey: variantParts.length ? variantParts.sort().join('|') : null,
    tokens,
    modelTokens,
    variants: { capacities, colors },
  };
}

export function diceSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  return (2 * overlap) / (left.size + right.size);
}

export function variantsConflict(a: NormalizedIdentity, b: NormalizedIdentity): string | null {
  if (a.variants.capacities.length && b.variants.capacities.length &&
      !a.variants.capacities.some((v) => b.variants.capacities.includes(v))) return 'capacity';
  if (a.variants.colors.length && b.variants.colors.length &&
      !a.variants.colors.some((v) => b.variants.colors.includes(v))) return 'color';
  return null;
}
