// SVG fiyat grafigi (bagimliliksiz) — step-after cizgi, alan dolgusu, hover tooltip
import { useMemo, useRef, useState } from 'react';
import { dateFull, dateShort, money } from '../format';

interface Pt {
  price: number;
  checked_at: number;
}

export function PriceChart({
  points,
  currency,
  targetPrice,
  height = 240,
}: {
  points: Pt[];
  currency: string;
  targetPrice?: number | null;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; xPx: number } | null>(null);
  const W = 720;
  const H = height;
  const PAD = { l: 56, r: 14, t: 14, b: 26 };

  const model = useMemo(() => {
    if (points.length === 0) return null;
    const prices = points.map((p) => p.price);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    if (targetPrice != null) {
      lo = Math.min(lo, targetPrice);
      hi = Math.max(hi, targetPrice);
    }
    if (hi - lo < hi * 0.02 || hi === lo) {
      const pad = Math.max(hi * 0.03, 1);
      lo -= pad;
      hi += pad;
    } else {
      const pad = (hi - lo) * 0.12;
      lo = Math.max(0, lo - pad);
      hi += pad;
    }
    const t0 = points[0].checked_at;
    const t1 = points[points.length - 1].checked_at;
    const span = Math.max(t1 - t0, 1);
    const X = (t: number) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r);
    const Y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    // step-after path
    let d = `M ${X(points[0].checked_at).toFixed(1)} ${Y(points[0].price).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const x = X(points[i].checked_at);
      d += ` H ${x.toFixed(1)} V ${Y(points[i].price).toFixed(1)}`;
    }
    const lastX = X(t1);
    const area = `${d} V ${(H - PAD.b).toFixed(1)} H ${PAD.l} Z`;
    // y ticks
    const ticks: number[] = [];
    for (let i = 0; i <= 3; i++) ticks.push(lo + ((hi - lo) * i) / 3);
    // x ticks (4 adet)
    const xt: number[] = [];
    for (let i = 0; i <= 3; i++) xt.push(t0 + (span * i) / 3);
    return { lo, hi, X, Y, d, area, ticks, xt, lastX, t0, t1, span };
  }, [points, targetPrice, H]);

  if (!model || points.length === 0) {
    return <div className="chart-empty">Henüz yeterli veri yok — ilk kontrollerden sonra grafik oluşacak.</div>;
  }

  const first = points[0].price;
  const last = points[points.length - 1].price;
  const trendUp = last > first;
  const color = trendUp ? 'var(--red)' : last < first ? 'var(--green)' : 'var(--blue)';

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const xSvg = frac * W;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = Math.abs(model.X(points[i].checked_at) - xSvg);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    setHover({ i: best, xPx: (model.X(points[best].checked_at) / W) * rect.width });
  };

  const hp = hover ? points[hover.i] : null;

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart-svg">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {model.ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={model.Y(v)} y2={model.Y(v)} className="chart-grid" />
            <text x={PAD.l - 8} y={model.Y(v) + 4} className="chart-label" textAnchor="end">
              {v >= 10000 ? Math.round(v).toLocaleString('tr-TR') : v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}
        {model.xt.map((t, i) => (
          <text
            key={i}
            x={model.X(t)}
            y={H - 8}
            className="chart-label"
            textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}
          >
            {dateShort(t)}
          </text>
        ))}
        {targetPrice != null && (
          <g>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={model.Y(targetPrice)}
              y2={model.Y(targetPrice)}
              className="chart-target"
            />
            <text x={W - PAD.r} y={model.Y(targetPrice) - 5} className="chart-label chart-label-target" textAnchor="end">
              hedef {money(targetPrice, currency)}
            </text>
          </g>
        )}
        <path d={model.area} fill="url(#chartFill)" />
        <path d={model.d} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx={model.lastX} cy={model.Y(last)} r="4" fill={color} />
        {hp && (
          <g>
            <line
              x1={model.X(hp.checked_at)}
              x2={model.X(hp.checked_at)}
              y1={PAD.t}
              y2={H - PAD.b}
              className="chart-cross"
            />
            <circle cx={model.X(hp.checked_at)} cy={model.Y(hp.price)} r="4.5" fill="#fff" stroke={color} strokeWidth="2" />
          </g>
        )}
      </svg>
      {hp && hover && (
        <div
          className="chart-tip"
          style={{ left: `min(max(${hover.xPx}px, 70px), calc(100% - 80px))` }}
        >
          <b>{money(hp.price, currency)}</b>
          <span>{dateFull(hp.checked_at)}</span>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ points, width = 120, height = 30 }: { points: { p: number; t: number }[]; width?: number; height?: number }) {
  if (!points || points.length < 2) return <div className="spark spark-empty" style={{ width, height }} />;
  const prices = points.map((x) => x.p);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || 1;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const ts = Math.max(t1 - t0, 1);
  const pts = points
    .map((x) => `${(((x.t - t0) / ts) * (width - 4) + 2).toFixed(1)},${((1 - (x.p - lo) / span) * (height - 6) + 3).toFixed(1)}`)
    .join(' ');
  const first = prices[0];
  const last = prices[prices.length - 1];
  const color = last < first ? 'var(--green)' : last > first ? 'var(--red)' : 'var(--mut)';
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
