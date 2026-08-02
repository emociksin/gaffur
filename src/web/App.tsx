import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, Product, Summary } from '../shared/types';
import { api } from './api';
import { Login, SetupNotice } from './Login';
import { Dashboard } from './pages/Dashboard';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AddModal } from './components/AddModal';
import { DetailModal } from './components/DetailModal';
import { IconBell, IconGear, IconPlus, IconRefresh, IconTag, Spinner, useToast } from './ui';

type Tab = 'panel' | 'bildirim' | 'ayar';

export default function App() {
  const toast = useToast();
  const [auth, setAuth] = useState<{
    loading: boolean;
    authed: boolean;
    open: boolean;
    configured: boolean;
  }>({
    loading: true,
    authed: false,
    open: false,
    configured: true,
  });
  const [tab, setTab] = useState<Tab>('panel');
  const [products, setProducts] = useState<Product[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [checkingAll, setCheckingAll] = useState<{ done: number } | null>(null);
  const checkingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [p, c, s] = await Promise.all([api.products(), api.categories(), api.summary()]);
      setProducts(p.products);
      setCats(c.categories);
      setSummary(s);
    } catch {
      /* oturum dusmus olabilir; event zaten yakalanir */
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setAuth({ loading: false, authed: m.authed, open: m.open, configured: m.configured });
        if (m.authed) refresh();
      })
      .catch(() => setAuth({ loading: false, authed: false, open: false, configured: true }));
    const onUnauth = () => setAuth((a) => ({ ...a, authed: false }));
    window.addEventListener('gfr-unauthorized', onUnauth);
    return () => window.removeEventListener('gfr-unauthorized', onUnauth);
  }, [refresh]);

  // arka plan tazeleme
  useEffect(() => {
    if (!auth.authed) return;
    const iv = setInterval(refresh, 60_000);
    return () => clearInterval(iv);
  }, [auth.authed, refresh]);

  const checkAll = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setCheckingAll({ done: 0 });
    let done = 0;
    try {
      for (let i = 0; i < 30; i++) {
        const r = await api.checkAll();
        done += r.checked;
        setCheckingAll({ done });
        if (r.remaining <= 0 || r.checked === 0) break;
      }
      await refresh();
      toast(done > 0 ? `${done} ürün kontrol edildi` : 'Kontrol edilecek ürün yok', 'ok');
    } catch (e: any) {
      toast(e?.message ?? 'Kontrol sırasında hata oluştu', 'err');
    } finally {
      checkingRef.current = false;
      setCheckingAll(null);
    }
  }, [refresh, toast]);

  if (auth.loading) {
    return (
      <div className="boot">
        <Spinner size={26} />
      </div>
    );
  }

  // Parola yok VE acik mod da kapaliysa uygulama kilitli: parola sormak
  // anlamsiz (giris de 503 doner), kurulumun nasil tamamlanacagi anlatilir.
  // Yerel acik modda (ALLOW_OPEN=1) uygulama normal calisir.
  if (!auth.configured && !auth.open) {
    return <SetupNotice />;
  }

  if (!auth.authed) {
    return (
      <Login
        onSuccess={() => {
          setAuth((a) => ({ ...a, authed: true }));
          refresh();
        }}
      />
    );
  }

  const unread = summary?.unread ?? 0;

  return (
    <div className="app">
      <header className="hdr">
        <div className="brand" onClick={() => setTab('panel')} role="button" tabIndex={0}>
          <span className="brand-mark">
            <IconTag size={20} />
          </span>
          <span className="brand-text">
            GAFFUR<small>fiyat takip</small>
          </span>
        </div>
        <nav className="tabs" aria-label="Sayfalar">
          <button className={tab === 'panel' ? 'on' : ''} onClick={() => setTab('panel')}>
            Panel
          </button>
          <button className={tab === 'bildirim' ? 'on' : ''} onClick={() => setTab('bildirim')}>
            <IconBell size={16} />
            Bildirimler
            {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <button className={tab === 'ayar' ? 'on' : ''} onClick={() => setTab('ayar')}>
            <IconGear size={16} />
            Ayarlar
          </button>
        </nav>
        <div className="hdr-actions">
          <button className="btn btn-ghost" onClick={checkAll} disabled={!!checkingAll} title="Tüm ürünleri şimdi kontrol et">
            {checkingAll ? <Spinner size={15} /> : <IconRefresh size={16} />}
            <span className="hide-sm">{checkingAll ? `Kontrol ediliyor… ${checkingAll.done}` : 'Şimdi Kontrol Et'}</span>
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <IconPlus size={16} />
            <span className="hide-sm">Ürün Ekle</span>
          </button>
        </div>
      </header>

      <main className="main">
        {tab === 'panel' && (
          <Dashboard
            products={products}
            cats={cats}
            summary={summary}
            onOpenDetail={setDetailId}
            onAdd={() => setShowAdd(true)}
            refresh={refresh}
          />
        )}
        {tab === 'bildirim' && <NotificationsPage onOpenProduct={setDetailId} refreshGlobal={refresh} />}
        {tab === 'ayar' && <SettingsPage open={auth.open} />}
      </main>

      {showAdd && (
        <AddModal
          cats={cats}
          onClose={() => setShowAdd(false)}
          onDone={() => {
            setShowAdd(false);
            refresh();
          }}
        />
      )}
      {detailId != null && (
        <DetailModal
          id={detailId}
          cats={cats}
          onClose={() => setDetailId(null)}
          refresh={refresh}
        />
      )}

      <footer className="ftr">
        <span>gaffur.net</span>
        <span className="dot" />
        <span>{summary ? `${summary.active} ürün takipte` : ''}</span>
      </footer>
    </div>
  );
}
