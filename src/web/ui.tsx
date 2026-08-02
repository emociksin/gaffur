// Kucuk UI yapi taslari: ikonlar, modal, toast, rozetler
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---- ikonlar (inline SVG, stroke tabanli) ----
type IconProps = { size?: number; className?: string };
const I = ({ size = 18, className, children }: IconProps & { children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconTag = (p: IconProps) => (
  <I {...p}>
    <path d="M12.6 2.9 21 11.3a2 2 0 0 1 0 2.8l-6.9 6.9a2 2 0 0 1-2.8 0L2.9 12.6A2 2 0 0 1 2.3 11l.5-5.9a2 2 0 0 1 1.8-1.8l5.9-.5c.6 0 1.2.2 1.6.6Z" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
  </I>
);
export const IconBell = (p: IconProps) => (
  <I {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 13 6 8Z" />
    <path d="M10 19a2.2 2.2 0 0 0 4 0" />
  </I>
);
export const IconPlus = (p: IconProps) => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);
export const IconRefresh = (p: IconProps) => (
  <I {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </I>
);
export const IconTrash = (p: IconProps) => (
  <I {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
  </I>
);
export const IconGear = (p: IconProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" />
  </I>
);
export const IconExternal = (p: IconProps) => (
  <I {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14 21 3" />
  </I>
);
export const IconSearch = (p: IconProps) => (
  <I {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </I>
);
export const IconX = (p: IconProps) => (
  <I {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </I>
);
export const IconCheck = (p: IconProps) => (
  <I {...p}>
    <path d="M20 6 9 17l-5-5" />
  </I>
);
export const IconChart = (p: IconProps) => (
  <I {...p}>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-5 3 3 5-7" />
  </I>
);
export const IconSend = (p: IconProps) => (
  <I {...p}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </I>
);
export const IconBox = (p: IconProps) => (
  <I {...p}>
    <path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7V8Z" />
    <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
  </I>
);
export const IconAlert = (p: IconProps) => (
  <I {...p}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </I>
);
export const IconFolder = (p: IconProps) => (
  <I {...p}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </I>
);
export const IconDownload = (p: IconProps) => (
  <I {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </I>
);
export const IconEye = (p: IconProps) => (
  <I {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);

// ---- marka: mahalle esnaf tabelasi (emaye levha + turuncu gunes) ----
export function BrandSign({ lg }: { lg?: boolean }) {
  return (
    <span className={`brand-sign${lg ? ' brand-sign-lg' : ''}`}>
      <span className="brand-word">
        GAFF<span className="brand-sun">U</span>R
      </span>
      <span className="brand-sub">fiyat takip</span>
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="yükleniyor" />;
}

// ---- yonetici baglami ----
// Ziyaretci siteyi gezebilir ama yonetim kontrollerini gormez. Sunucu tarafi
// zaten koruyor; bu yalnizca arayuzun dogru gorunmesi icin.
const AdminCtx = createContext(false);
export const AdminProvider = AdminCtx.Provider;
export const useIsAdmin = () => useContext(AdminCtx);

// ---- toast ----
type Toast = { id: number; text: string; kind: 'ok' | 'err' | 'info' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = idRef.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'ok' ? <IconCheck size={15} /> : t.kind === 'err' ? <IconAlert size={15} /> : null}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---- modal ----
export function Modal({
  onClose,
  children,
  wide,
}: {
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <button className="modal-x" onClick={onClose} aria-label="Kapat">
          <IconX size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="toggle-row">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="knob" />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

export function SiteBadge({ site }: { site: string }) {
  const label =
    site === 'trendyol'
      ? 'Trendyol'
      : site === 'hepsiburada'
        ? 'Hepsiburada'
        : site === 'amazon'
          ? 'Amazon'
          : site === 'n11'
            ? 'N11'
            : site;
  return <span className={`site-badge site-${site}`}>{label}</span>;
}
