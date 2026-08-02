// Fiyat/sayi cozumleme — TR ("1.299,90") ve EN ("1,299.90") bicimlerinin ikisini de guvenle cozer.

export function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || /^[-.,]+$/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    // Sagdaki ayirici ondaliktir, digeri binliktir
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      s = parts[0] + '.' + parts[1]; // ondalik virgul
    } else {
      s = s.replace(/,/g, ''); // binlik virgul(ler)
    }
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2) {
      s = parts.join(''); // 12.345.678 → binlik
    } else if (parts[1] && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0') {
      // "1.299" → TR binlik. ("0.299" veya "12.34" ondaliktir)
      s = parts.join('');
    }
    // aksi halde ondalik nokta olarak birak
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (neg) return null; // negatif fiyat anlamsiz
  return Math.round(n * 100) / 100;
}

export function detectCurrency(s: string | null | undefined, fallback = 'TRY'): string {
  if (!s) return fallback;
  const t = s.toUpperCase();
  if (s.includes('₺') || /\bTL\b/.test(t) || t.includes('TRY')) return 'TRY';
  if (s.includes('€') || t.includes('EUR')) return 'EUR';
  if (s.includes('$') || t.includes('USD')) return 'USD';
  if (s.includes('£') || t.includes('GBP')) return 'GBP';
  return fallback;
}

/** Makul fiyat araligi disindakileri ele (parser yanlis yakalamasin) */
export function sanePrice(n: number | null): number | null {
  if (n == null) return null;
  if (n < 0.5 || n > 100_000_000) return null;
  return n;
}

export function fmtMoney(n: number | null | undefined, currency = 'TRY'): string {
  if (n == null || !Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency,
      minimumFractionDigits: n % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}
