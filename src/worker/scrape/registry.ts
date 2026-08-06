import type { Extracted } from './parse';
import { extractForSite, type SiteId } from './sites';

const VERSIONS: Record<string, string> = {
  trendyol: 'trendyol-2026.08.1', hepsiburada: 'hepsiburada-2026.08.1',
  amazon: 'amazon-2026.08.1', n11: 'n11-2026.08.1',
};
export const GENERIC_PARSER_VERSION = 'generic-2026.08.1';
export const TRENDYOL_LISTING_PARSER_VERSION = 'trendyol-listing-2026.08.1';

export function parserVersionFor(site: SiteId): string {
  return VERSIONS[site] ?? GENERIC_PARSER_VERSION;
}

export function parseWithRegistry(site: SiteId, html: string): {
  parserVersion: string; data: Extracted & { blocked?: boolean };
} {
  return { parserVersion: parserVersionFor(site), data: extractForSite(site, html) };
}
