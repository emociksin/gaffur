import { categorySlug, productSlug } from './slug';

export const publicProductPath = (product: { id: number; title: string }) => `/urun/${productSlug(product)}`;
export const publicCategoryPath = (category: { id: number; name: string }) => `/kategori/${categorySlug(category)}`;

export function isAdminPathname(pathname: string): boolean {
  return pathname === '/yonetim' || pathname.startsWith('/yonetim/');
}
