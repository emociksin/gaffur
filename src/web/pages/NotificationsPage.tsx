import { useCallback, useEffect, useState } from 'react';
import type { Notification } from '../../shared/types';
import { api } from '../api';
import { dateFull, money, timeAgo } from '../format';
import { IconBell, IconCheck, IconTrash, Spinner, useToast } from '../ui';

const KIND_LABEL: Record<string, string> = {
  drop: 'düşüş',
  rise: 'artış',
  target: 'hedef',
  stock: 'stok',
  new_product: 'yeni ürün',
  error: 'hata',
  info: 'bilgi',
};

export function NotificationsPage({
  onOpenProduct,
  refreshGlobal,
}: {
  onOpenProduct: (id: number) => void;
  refreshGlobal: () => Promise<void>;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = useCallback(async () => {
    const r = await api.notifications();
    setItems(r.notifications);
  }, []);

  useEffect(() => {
    load().catch(() => toast('Bildirimler yüklenemedi', 'err'));
  }, [load, toast]);

  const readAll = async () => {
    await api.readAll();
    await load();
    await refreshGlobal();
  };

  const clearAll = async () => {
    await api.clearNotifications();
    await load();
    await refreshGlobal();
    toast('Bildirimler temizlendi', 'ok');
  };

  const open = async (n: Notification) => {
    if (!n.read) {
      api.readOne(n.id).then(() => refreshGlobal());
      setItems((arr) => (arr ? arr.map((x) => (x.id === n.id ? { ...x, read: 1 } : x)) : arr));
    }
    if (n.product_id) onOpenProduct(n.product_id);
  };

  if (items == null)
    return (
      <div className="loading-block">
        <Spinner size={22} />
      </div>
    );

  return (
    <div className="notifs-page">
      <div className="page-head">
        <h2>Bildirimler</h2>
        <div className="page-head-actions">
          <button className="btn btn-ghost btn-sm" onClick={readAll} disabled={!items.some((n) => !n.read)}>
            <IconCheck size={14} /> Tümünü okundu say
          </button>
          <button className="btn btn-ghost btn-sm btn-danger" onClick={clearAll} disabled={items.length === 0}>
            <IconTrash size={14} /> Temizle
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <IconBell size={40} />
          <h2>Henüz bildirim yok</h2>
          <p>Fiyat düşüşleri, hedefe inen ürünler ve stok değişimleri burada görünecek.</p>
        </div>
      ) : (
        <ul className="notif-list">
          {items.map((n) => (
            <li
              key={n.id}
              className={`notif ${n.read ? '' : 'unread'} ${n.product_id ? 'clickable' : ''}`}
              onClick={() => open(n)}
            >
              <span className={`nkind nkind-${n.kind}`} title={KIND_LABEL[n.kind] ?? n.kind} />
              <div className="notif-body">
                <b>{n.title}</b>
                {n.product_title && <span className="notif-prod">{n.product_title}</span>}
                {!n.product_title && n.body && <span className="notif-prod">{n.body}</span>}
                {n.old_price != null && n.new_price != null && (
                  <span className="notif-prices">
                    <s>{money(n.old_price)}</s> → <b>{money(n.new_price)}</b>
                  </span>
                )}
              </div>
              <div className="notif-right">
                <span title={dateFull(n.created_at)}>{timeAgo(n.created_at)}</span>
                {n.sent_telegram ? <small className="tg-sent">telegram ✓</small> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
