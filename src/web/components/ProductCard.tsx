import { useState } from 'react';
import type { Category, Product } from '../../shared/types';
import { publicProductPath } from '../../shared/routes';
import { changePct, money, pctFmt, timeAgo } from '../format';
import { api } from '../api';
import { Sparkline } from './Chart';
import { IconAlert, IconRefresh, IconTag, SiteBadge, Spinner, useIsAdmin, useToast } from '../ui';

export function ProductCard({
  p,
  cat,
  onOpen,
  refresh,
  watched,
  onToggleWatch,
}: {
  p: Product;
  cat?: Category;
  onOpen: () => void;
  refresh: () => Promise<void>;
  watched: boolean;
  onToggleWatch: (productId: number) => Promise<void>;
}) {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [checking, setChecking] = useState(false);
  const [watching, setWatching] = useState(false);
  const chg = changePct(p);
  const isErr = p.fail_count >= 3;
  const atMin = p.current_price != null && p.min_price != null && p.current_price <= p.min_price + 0.001;
  const targetHit = p.target_price != null && p.current_price != null && p.current_price <= p.target_price;

  const quickCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    try {
      const r = await api.checkProduct(p.id);
      if (r.outcome.ok) {
        toast(
          r.outcome.changed
            ? `Fiyat güncellendi: ${money(r.product.current_price, r.product.currency)}`
            : 'Fiyat değişmemiş',
          'ok'
        );
      } else {
        toast(r.outcome.error ?? 'Kontrol başarısız', 'err');
      }
      await refresh();
    } catch (e: any) {
      toast(e?.message ?? 'Kontrol başarısız', 'err');
    } finally {
      setChecking(false);
    }
  };

  const toggleWatch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setWatching(true);
    try {
      await onToggleWatch(p.id);
    } finally {
      setWatching(false);
    }
  };

  return (
    <article className={`card ${!p.active ? 'card-paused' : ''}`} onClick={onOpen} role="button" tabIndex={0}>
      <div className="card-top">
        <div className="card-img">
          {p.image ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <IconTag size={24} />}
        </div>
        <div className="card-head">
          <div className="card-badges">
            <SiteBadge site={p.site} />
            {cat && (
              <span className="cat-tag" style={{ ['--chip' as any]: cat.color }}>
                <span className="chip-dot" />
                {cat.name}
              </span>
            )}
            {!p.active && <span className="mini-badge">durduruldu</span>}
          </div>
          <h4 className="card-title" title={p.title}>
            <a
              href={publicProductPath(p)}
              onClick={(event) => {
                event.stopPropagation();
                if (isAdmin) {
                  event.preventDefault();
                  onOpen();
                }
              }}
            >
              {p.title}
            </a>
          </h4>
        </div>
      </div>

      <div className="card-price-row">
        <div className="card-price">
          <span className="price-now">{money(p.current_price, p.currency)}</span>
          {p.list_price != null && p.current_price != null && p.list_price > p.current_price && (
            <s className="price-list">{money(p.list_price, p.currency)}</s>
          )}
        </div>
        {chg != null && Math.abs(chg) >= 0.05 && (
          <span className={`chg ${chg < 0 ? 'chg-down' : 'chg-up'}`}>
            {chg < 0 ? '▼' : '▲'} {pctFmt(chg)}
          </span>
        )}
      </div>

      <div className="card-spark">
        <Sparkline points={p.spark ?? []} />
        <div className="card-meta">
          {isErr ? (
            <span className="meta-err">
              <IconAlert size={13} /> kontrol edilemiyor
            </span>
          ) : p.in_stock === 0 ? (
            <span className="meta-err">stok yok</span>
          ) : targetHit ? (
            <span className="meta-target">hedef fiyatta</span>
          ) : atMin ? (
            <span className="meta-min">en düşük seviyede</span>
          ) : p.min_price != null ? (
            <span>
              en düşük {money(p.min_price, p.currency)}
            </span>
          ) : null}
          <span className="meta-time">{timeAgo(p.last_checked_at)}</span>
        </div>
      </div>

      <button className={`watch-btn ${watched ? 'on' : ''}`} onClick={toggleWatch} disabled={watching}>
        {watching ? <Spinner size={13} /> : watched ? 'Takipten çıkar' : 'Takibe al'}
      </button>

      {isAdmin && (
        <button className="card-check" onClick={quickCheck} disabled={checking} title="Şimdi kontrol et">
          {checking ? <Spinner size={14} /> : <IconRefresh size={14} />}
        </button>
      )}
    </article>
  );
}
