import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, Product, Summary } from '../shared/types';
import { api, type UserAccount } from './api';
import { AccountModal, Login } from './Login';
import { Dashboard } from './pages/Dashboard';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AddModal } from './components/AddModal';
import { DetailModal } from './components/DetailModal';
import { AdminProvider, BrandSign, IconBell, IconGear, IconPlus, IconRefresh, Spinner, useToast } from './ui';

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
  const [user, setUser] = useState<UserAccount | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  // Yonetim gizli bir adreste: /yonetim. Ana sayfada giris duğmesi YOK —
  // ziyaretcinin isine yaramaz, sadece "burada bir panel var" diye bagirir.
  const [showLogin, setShowLogin] = useState(() => window.location.pathname === '/yonetim');
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
        refresh(); // ziyaretci de listeyi gorur; okuma uclari herkese acik
      })
      .catch(() => setAuth({ loading: false, authed: false, open: false, configured: true }));
    api.userMe().then((m) => setUser(m.user ?? null)).catch(() => setUser(null));
    const onUnauth = () => setAuth((a) => ({ ...a, authed: false }));
    window.addEventListener('gfr-unauthorized', onUnauth);
    return () => window.removeEventListener('gfr-unauthorized', onUnauth);
  }, [refresh]);

  // arka plan tazeleme (ziyaretci icin de calisir; okuma uclari acik)
  useEffect(() => {
    const iv = setInterval(refresh, 60_000);
    return () => clearInterval(iv);
  }, [refresh]);

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

  // Ziyaretci siteyi gezebilir VE urun ekleyebilir. Yonetim (silme, ayarlar,
  // bildirimler, toplu kontrol) parola ister.
  const isAdmin = auth.authed || auth.open;

  const leaveAdminUrl = () => {
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
  };

  if (showLogin && !isAdmin) {
    return (
      <Login
        onSuccess={() => {
          setShowLogin(false);
          leaveAdminUrl();
          setAuth((a) => ({ ...a, authed: true }));
          refresh();
        }}
        onCancel={() => {
          setShowLogin(false);
          leaveAdminUrl();
        }}
        configured={auth.configured}
      />
    );
  }

  const unread = summary?.unread ?? 0;
  const activeTab = isAdmin ? tab : 'panel'; // ziyaretci yalnizca panoyu gorur

  return (
    <AdminProvider value={isAdmin}>
    <div className="app">
      <header className="hdr">
        <div className="brand" onClick={() => setTab('panel')} role="button" tabIndex={0}>
          <BrandSign />
        </div>
        {isAdmin ? (
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
        ) : (
          <p className="hdr-tagline">Ürün bağlantısını yapıştır, fiyatını senin yerine takip edelim</p>
        )}
        <div className="hdr-actions">
          <button className="btn btn-ghost account-button" onClick={() => setShowAccount(true)}>
            {user ? user.email : 'Hesabım'}
          </button>
          {isAdmin && (
            <button className="btn btn-ghost" onClick={checkAll} disabled={!!checkingAll} title="Tüm ürünleri şimdi kontrol et">
              {checkingAll ? <Spinner size={15} /> : <IconRefresh size={16} />}
              <span className="hide-sm">{checkingAll ? `Kontrol ediliyor… ${checkingAll.done}` : 'Şimdi Kontrol Et'}</span>
            </button>
          )}
          {/* Urun ekleme herkese acik: gelen ziyaretci kendi urununu takibe alabilir */}
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <IconPlus size={16} />
            <span className="hide-sm">Ürün Ekle</span>
          </button>
        </div>
      </header>

      <main className="main">
        {activeTab === 'panel' && (
          <Dashboard
            products={products}
            cats={cats}
            summary={summary}
            onOpenDetail={setDetailId}
            onAdd={() => setShowAdd(true)}
            refresh={refresh}
          />
        )}
        {activeTab === 'bildirim' && <NotificationsPage onOpenProduct={setDetailId} refreshGlobal={refresh} />}
        {activeTab === 'ayar' && <SettingsPage open={auth.open} />}
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
      {showAccount && (
        <AccountModal user={user} onClose={() => setShowAccount(false)} onChanged={setUser} />
      )}

      <footer className="ftr">
        <span>gaffur.net</span>
        <span className="dot" />
        <span>{summary ? `${summary.active} ürün takipte` : ''}</span>
      </footer>
    </div>
    </AdminProvider>
  );
}
