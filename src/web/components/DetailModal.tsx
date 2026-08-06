// Urun detayi: buyuk grafik, istatistikler, ayarlar, gecmis
import { useCallback, useEffect, useState } from 'react';
import type { Category, HistoryPoint, Notification, PriceBaseline, Product, StockTransition } from '../../shared/types';
import { api } from '../api';
import { dateFull, money, pctFmt, timeAgo } from '../format';
import { PriceChart } from './Chart';
import { IconCheck, IconDownload, IconExternal, IconRefresh, IconTrash, Modal, SiteBadge, Spinner, useIsAdmin, useToast } from '../ui';

const RANGES: [number, string][] = [
  [7, '7g'],
  [30, '30g'],
  [90, '90g'],
  [365, '1y'],
];

export function DetailModal({
  id,
  cats,
  onClose,
  refresh,
}: {
  id: number;
  cats: Category[];
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [days, setDays] = useState(90);
  const [data, setData] = useState<{
    product: Product;
    history: HistoryPoint[];
    notifications: Notification[];
    baseline: PriceBaseline | null;
    stockState: { unknown_streak: number; parser_error: number } | null;
    stockTransitions: StockTransition[];
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // duzenlenebilir alanlar
  const [form, setForm] = useState<{
    category_id: string;
    target_price: string;
    alert_mode: string;
    threshold_pct: string;
    interval_min: number;
    engine: string;
    active: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    const d = await api.product(id, days);
    setData(d);
    setForm({
      category_id: d.product.category_id == null ? '' : String(d.product.category_id),
      target_price: d.product.target_price == null ? '' : String(d.product.target_price),
      alert_mode: d.product.alert_mode,
      threshold_pct: String(d.product.threshold_pct ?? 0),
      interval_min: d.product.interval_min,
      engine: d.product.engine,
      active: !!d.product.active,
    });
  }, [id, days]);

  useEffect(() => {
    load().catch(() => toast('Ürün yüklenemedi', 'err'));
  }, [load, toast]);

  if (!data || !form) {
    return (
      <Modal onClose={onClose} wide>
        <div className="loading-block">
          <Spinner size={22} />
        </div>
      </Modal>
    );
  }

  const p = data.product;
  const hist = data.history;
  const avg = hist.length ? hist.reduce((s, h) => s + h.price, 0) / hist.length : null;

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api.checkProduct(p.id);
      if (r.outcome.ok) {
        toast(r.outcome.changed ? 'Fiyat değişti, güncellendi' : 'Fiyat aynı', 'ok');
      } else {
        toast(r.outcome.error ?? 'Kontrol başarısız', 'err');
      }
      await load();
      await refresh();
    } catch (e: any) {
      toast(e?.message ?? 'Kontrol başarısız', 'err');
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patchProduct(p.id, {
        category_id: form.category_id === '' ? null : Number(form.category_id),
        target_price: form.target_price === '' ? null : Number(form.target_price.replace(',', '.')),
        alert_mode: form.alert_mode,
        threshold_pct: Number(form.threshold_pct) || 0,
        interval_min: form.interval_min,
        engine: form.engine,
        active: form.active,
      });
      toast('Kaydedildi', 'ok');
      await load();
      await refresh();
    } catch (e: any) {
      toast(e?.message ?? 'Kaydedilemedi', 'err');
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    try {
      await api.deleteProduct(p.id);
      toast('Ürün silindi', 'ok');
      onClose();
      await refresh();
    } catch (e: any) {
      toast(e?.message ?? 'Silinemedi', 'err');
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <div className="det-head">
        {p.image && <img className="det-img" src={p.image} alt="" referrerPolicy="no-referrer" />}
        <div className="det-headinfo">
          <div className="card-badges">
            <SiteBadge site={p.site} />
            {p.fail_count >= 3 && <span className="mini-badge mini-badge-err">kontrol edilemiyor</span>}
            {p.in_stock === 0 && <span className="mini-badge mini-badge-err">stok yok</span>}
            {p.stock_status === 'preorder' && <span className="mini-badge">ön sipariş</span>}
            {data.stockState?.parser_error === 1 && <span className="mini-badge mini-badge-err">stok verisi okunamıyor</span>}
            {!p.active && <span className="mini-badge">durduruldu</span>}
          </div>
          <h2 className="det-title">{p.title}</h2>
          <div className="det-actions">
            <a className="btn btn-ghost btn-sm" href={p.url} target="_blank" rel="noreferrer">
              <IconExternal size={14} /> Ürüne git
            </a>
            {isAdmin && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={checkNow} disabled={checking}>
                  {checking ? <Spinner size={13} /> : <IconRefresh size={14} />} Şimdi kontrol et
                </button>
                <a className="btn btn-ghost btn-sm" href={`/api/export/history.csv?product_id=${p.id}`} download>
                  <IconDownload size={14} /> CSV
                </a>
                {!confirmDel ? (
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setConfirmDel(true)}>
                    <IconTrash size={14} /> Sil
                  </button>
                ) : (
                  <button className="btn btn-sm btn-dangerfill" onClick={del}>
                    Emin misin? Evet, sil
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="det-price">
          <span className="price-now">{money(p.current_price, p.currency)}</span>
          {p.previous_price != null && p.current_price != null && p.previous_price !== p.current_price && (
            <span className={`chg ${p.current_price < p.previous_price ? 'chg-down' : 'chg-up'}`}>
              {p.current_price < p.previous_price ? '▼' : '▲'}{' '}
              {pctFmt(((p.current_price - p.previous_price) / p.previous_price) * 100)}
            </span>
          )}
          <small className="mut">son kontrol {timeAgo(p.last_checked_at)}</small>
          {p.last_engine && <small className="mut">kaynak: {p.last_engine === 'crawlee' ? 'Crawlee' : p.last_engine === 'listing' ? 'liste' : 'doğrudan'}</small>}
        </div>
      </div>

      {p.last_error && p.fail_count > 0 && <div className="form-err">{p.last_error}</div>}

      <div className="det-stats">
        <div>
          <small>En düşük</small>
          <b className="stat-green">{money(p.min_price, p.currency)}</b>
        </div>
        <div>
          <small>En yüksek</small>
          <b>{money(p.max_price, p.currency)}</b>
        </div>
        <div>
          <small>Ortalama ({days}g)</small>
          <b>{money(avg, p.currency)}</b>
        </div>
        <div>
          <small>Liste fiyatı</small>
          <b>{money(p.list_price, p.currency)}</b>
        </div>
        <div>
          <small>Hedef</small>
          <b className={p.target_price != null && p.current_price != null && p.current_price <= p.target_price ? 'stat-green' : ''}>
            {money(p.target_price, p.currency)}
          </b>
        </div>
        <div>
          <small>30 günlük medyan</small>
          <b>{money(data.baseline?.median_30d ?? null, p.currency)}</b>
        </div>
        <div>
          <small>90 günlük medyan</small>
          <b>{money(data.baseline?.median_90d ?? null, p.currency)}</b>
        </div>
        <div>
          <small>Son 10 gün en düşük</small>
          <b className="stat-green">{money(data.baseline?.low_10d ?? null, p.currency)}</b>
        </div>
      </div>

      <div className="chart-head">
        <h3>Fiyat geçmişi</h3>
        <div className="range-btns">
          {RANGES.map(([d, l]) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <PriceChart points={hist} currency={p.currency} targetPrice={p.target_price} />

      {/* Takip ayarlari ve bildirim gecmisi yalnizca yoneticiye gorunur */}
      {isAdmin && (
        <>
      <h3 className="sec-title">Takip ayarları</h3>
      <div className="form-grid">
        <label>
          Kategori
          <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
            <option value="">Kategorisiz</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hedef fiyat
          <input
            value={form.target_price}
            onChange={(e) => setForm({ ...form, target_price: e.target.value })}
            placeholder="yok"
            inputMode="decimal"
          />
        </label>
        <label>
          Bildirim
          <select value={form.alert_mode} onChange={(e) => setForm({ ...form, alert_mode: e.target.value })}>
            <option value="drop">Fiyat düşünce</option>
            <option value="target">Hedef fiyata inince</option>
            <option value="any">Her değişimde</option>
            <option value="off">Bildirim yok</option>
          </select>
        </label>
        <label>
          Asgari düşüş eşiği (%)
          <input
            value={form.threshold_pct}
            onChange={(e) => setForm({ ...form, threshold_pct: e.target.value })}
            inputMode="decimal"
            placeholder="0"
          />
        </label>
        <label>
          Kontrol sıklığı
          <select value={form.interval_min} onChange={(e) => setForm({ ...form, interval_min: Number(e.target.value) })}>
            <option value={15}>15 dakikada bir</option>
            <option value={30}>30 dakikada bir</option>
            <option value={60}>Saatte bir</option>
            <option value={180}>3 saatte bir</option>
            <option value={720}>12 saatte bir</option>
            <option value={1440}>Günde bir</option>
          </select>
        </label>
        <label>
          Veri kaynağı
          <select value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })}>
            <option value="auto">Otomatik (önce doğrudan, olmadı Crawlee)</option>
            <option value="direct">Sadece doğrudan</option>
            <option value="crawlee">Sadece Crawlee</option>
          </select>
        </label>
      </div>
      <div className="det-savebar">
        <label className="pause-label">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Takip aktif
        </label>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <Spinner size={14} /> : <IconCheck size={15} />} Kaydet
        </button>
      </div>

      {data.notifications.length > 0 && (
        <>
          <h3 className="sec-title">Bu ürünün son bildirimleri</h3>
          <ul className="mini-notifs">
            {data.notifications.map((n) => (
              <li key={n.id}>
                <span className={`nkind nkind-${n.kind}`} />
                <span className="mini-notif-title">{n.title}</span>
                <span className="mut">{dateFull(n.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
        </>
      )}
    </Modal>
  );
}
