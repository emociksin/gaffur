import { extractLogistics, type Extracted } from './parse';
import { extractForSite, type SiteId } from './sites';

const VERSIONS: Record<string, string> = {
  trendyol: 'trendyol-2026.08.2', hepsiburada: 'hepsiburada-2026.08.2',
  amazon: 'amazon-2026.08.2', n11: 'n11-2026.08.2',
};
export const GENERIC_PARSER_VERSION = 'generic-2026.08.2';
export const TRENDYOL_LISTING_PARSER_VERSION = 'trendyol-listing-2026.08.1';

export function parserVersionFor(site: SiteId): string {
  return VERSIONS[site] ?? GENERIC_PARSER_VERSION;
}

export function parseWithRegistry(site: SiteId, html: string): {
  parserVersion: string; data: Extracted & { blocked?: boolean };
} {
  const data = extractForSite(site, html);
  const logistics = extractLogistics(html);
  return {
    parserVersion: parserVersionFor(site),
    data: {
      ...data,
      shippingCost: data.shippingCost ?? logistics.shippingCost,
      installmentCount: data.installmentCount ?? logistics.installmentCount,
    },
  };
}
