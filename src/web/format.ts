export function money(n: number | null | undefined, currency = 'TRY'): string {
  if (n == null || !Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency,
      minimumFractionDigits: n % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString('tr-TR')} ${currency}`;
  }
}

export function pctFmt(p: number): string {
  const a = Math.abs(p);
  return `%${a >= 10 ? a.toFixed(0) : a.toFixed(1)}`;
}

export function timeAgo(unixSec: number | null | undefined): string {
  if (!unixSec) return '—';
  const s = Math.floor(Date.now() / 1000) - unixSec;
  if (s < 45) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 24 * 3600) return `${Math.floor(s / 3600)} sa önce`;
  if (s < 48 * 3600) return 'dün';
  if (s < 7 * 24 * 3600) return `${Math.floor(s / 86400)} gün önce`;
  return dateShort(unixSec);
}

export function dateShort(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function dateFull(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** onceki fiyata gore degisim yuzdesi (negatif = dusus) */
export function changePct(p: { current_price: number | null; previous_price: number | null }): number | null {
  if (p.current_price == null || p.previous_price == null || p.previous_price === 0) return null;
  return ((p.current_price - p.previous_price) / p.previous_price) * 100;
}
