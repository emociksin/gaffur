// Urun/kategori ekleme akisi: URL yapistir → onizleme → ayarlar → kaydet
import { useState } from 'react';
import type { Category, DiscoveredItem, ScrapeResult } from '../../shared/types';
import { api, ApiError } from '../api';
import { money } from '../format';
import { IconCheck, IconSearch, Modal, SiteBadge, Spinner, useIsAdmin, useToast } from '../ui';

const INTERVALS: [number, string][] = [
  [15, '15 dakikada bir'],
  [30, '30 dakikada bir'],
  [60, 'Saatte bir'],
  [180, '3 saatte bir'],
  [720, '12 saatte bir'],
  [1440, 'Günde bir'],
];

export function AddModal({
  cats,
  onClose,
  onDone,
}: {
  cats: Category[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [canForce, setCanForce] = useState(false);
  const [preview, setPreview] = useState<ScrapeResult | null>(null);
  const [listing, setListing] = useState<DiscoveredItem[] | null>(null);

  // form alanlari
  const [catId, setCatId] = useState<string>('');
  const [newCat, setNewCat] = useState('');
  const [target, setTarget] = useState('');
  const [alertMode, setAlertMode] = useState('drop');
  const [interval, setIntervalMin] = useState(60);
  const [listName, setListName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchPreview = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setErr('');
    setCanForce(false);
    setPreview(null);
    setListing(null);
    try {
      const r = await api.preview(url.trim());
      if (r.type === 'listing' && r.items) {
        setListing(r.items);
        setListName('');
      } else if (r.result) {
        setPreview(r.result);
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Önizleme alınamadı');
      if (e instanceof ApiError && e.status === 422) setCanForce(true);
    } finally {
      setBusy(false);
    }
  };

  const resolveCategory = async (): Promise<number | null> => {
    if (newCat.trim()) {
      const r = await api.addCategory({ name: newCat.trim() });
      return r.category.id;
    }
    return catId ? Number(catId) : null;
  };

  const saveProduct = async (force = false) => {
    setSaving(true);
    setErr('');
    try {
      const categoryId = await resolveCategory();
      await api.addProduct({
        url: url.trim(),
        category_id: categoryId,
        target_price: target ? Number(target.replace(',', '.')) : null,
        alert_mode: alertMode,
        interval_min: interval,
        force,
      });
      toast('Ürün takibe alındı', 'ok');
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? 'Kaydedilemedi');
      if (e instanceof ApiError && e.canForce) setCanForce(true);
    } finally {
      setSaving(false);
    }
  };

  const saveListing = async () => {
    if (!listName.trim()) {
      setErr('Kategoriye bir ad ver');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const r = await api.addCategory({ name: listName.trim(), source_url: url.trim(), auto_track: true });
      if (r.refresh?.ok) {
        toast(`"${listName.trim()}" takibe alındı — ${r.refresh.added} ürün eklendi`, 'ok');
      } else {
        toast(r.refresh?.error ?? 'Kategori eklendi ama liste okunamadı', 'err');
      }
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const newItems = listing?.filter((i) => !i.tracked) ?? [];

  return (
    <Modal onClose={onClose} wide={!!listing}>
      <h2 className="modal-title">Takibe Al</h2>
      <p className="modal-sub">
        Ürün bağlantısı yapıştır (Trendyol, Hepsiburada, Amazon, N11 veya başka bir site). Trendyol kategori/arama
        bağlantısı yapıştırırsan listedeki ürünlerin tümünü birden takip edebilirsin.
      </p>

      <div className="url-row">
        <input
          placeholder="https://www.trendyol.com/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchPreview()}
          autoFocus
        />
        <button className="btn btn-primary" onClick={fetchPreview} disabled={busy || !url.trim()}>
          {busy ? <Spinner size={15} /> : <IconSearch size={15} />}
          Getir
        </button>
      </div>

      {err && (
        <div className="form-err">
          {err}
          {canForce && (
            <button className="btn btn-ghost btn-sm" onClick={() => saveProduct(true)} disabled={saving}>
              Yine de takibe al (ilk fiyat sonraki kontrolde bulunur)
            </button>
          )}
        </div>
      )}

      {preview && (
        <div className="preview">
          <div className="preview-card">
            {preview.image && <img src={preview.image} alt="" referrerPolicy="no-referrer" />}
            <div className="preview-info">
              <SiteBadge site={preview.site} />
              <b>{preview.title ?? 'Başlık bulunamadı'}</b>
              <span className="preview-price">{money(preview.price ?? null, preview.currency ?? 'TRY')}</span>
              {preview.inStock === false && <span className="meta-err">stokta yok</span>}
              <small className="preview-engine">
                kaynak: {preview.engine === 'firecrawl' ? 'Firecrawl' : 'doğrudan erişim'}
              </small>
            </div>
          </div>

          {/* Ziyaretci yalnizca hedef fiyat verir; kategori, bildirim kanali ve
              kontrol sikligi site sahibinin isi (bildirimler onun Telegram'ina gider). */}
          <div className="form-grid">
            {isAdmin && (
              <>
                <label>
                  Kategori
                  <select value={catId} onChange={(e) => setCatId(e.target.value)} disabled={!!newCat.trim()}>
                    <option value="">Kategorisiz</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  veya yeni kategori
                  <input placeholder="örn. Elektronik" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
                </label>
              </>
            )}
            <label>
              Hedef fiyat (opsiyonel)
              <input
                placeholder={preview.price ? `örn. ${Math.round(preview.price * 0.9)}` : 'örn. 1500'}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                inputMode="decimal"
              />
            </label>
            {isAdmin && (
              <>
                <label>
                  Bildirim
                  <select value={alertMode} onChange={(e) => setAlertMode(e.target.value)}>
                    <option value="drop">Fiyat düşünce</option>
                    <option value="target">Hedef fiyata inince</option>
                    <option value="any">Her değişimde</option>
                    <option value="off">Bildirim yok</option>
                  </select>
                </label>
                <label>
                  Kontrol sıklığı
                  <select value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
                    {INTERVALS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          <button className="btn btn-primary btn-block" onClick={() => saveProduct(false)} disabled={saving}>
            {saving ? <Spinner size={15} /> : <IconCheck size={16} />}
            Takibe Al
          </button>
        </div>
      )}

      {listing && !isAdmin && (
        <div className="preview">
          <p className="mut">
            Bu bir liste bağlantısı. Şu an tek tek ürün bağlantısı ekleyebilirsin — listedeki
            bir ürünün sayfasını açıp onun bağlantısını yapıştır.
          </p>
        </div>
      )}

      {listing && isAdmin && (
        <div className="preview">
          <div className="listing-head">
            <b>{listing.length} ürün bulundu</b>
            <span className="mut">
              {newItems.length} yeni · {listing.length - newItems.length} zaten takipte
            </span>
          </div>
          <div className="listing-grid">
            {listing.map((i, idx) => (
              <div key={idx} className={`listing-item ${i.tracked ? 'tracked' : ''}`}>
                {i.image ? <img src={i.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="listing-noimg" />}
                <span className="listing-title">{i.title}</span>
                <b>{money(i.price, 'TRY')}</b>
                {i.tracked && <small>takipte</small>}
              </div>
            ))}
          </div>
          <div className="form-grid">
            <label>
              Kategori adı
              <input
                placeholder="örn. Robot Süpürgeler"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                autoFocus
              />
            </label>
          </div>
          <p className="mut small">
            Liste bir kategoriye dönüşür: fiyatlar toplu güncellenir, listeye giren yeni ürünler otomatik eklenir ve
            bildirim gelir.
          </p>
          <button className="btn btn-primary btn-block" onClick={saveListing} disabled={saving}>
            {saving ? <Spinner size={15} /> : <IconCheck size={16} />}
            Kategoriyi ve {newItems.length} ürünü takibe al
          </button>
        </div>
      )}
    </Modal>
  );
}
