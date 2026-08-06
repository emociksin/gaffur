export function slugify(value: string): string {
  const mapped = value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return mapped || 'urun';
}

export const productSlug = (product: { id: number; title: string }) => `${product.id}-${slugify(product.title)}`;
export const categorySlug = (category: { id: number; name: string }) => `${category.id}-${slugify(category.name)}`;

export function idFromSlug(slug: string): number | null {
  const match = slug.match(/^(\d+)(?:-|$)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
