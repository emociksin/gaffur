import { useEffect, useState } from 'react';
import { api, type UserAccount } from './api';
import type { Notification, Watch } from '../shared/types';
import { money } from './format';
import { BrandSign, Spinner } from './ui';

export function Login({
  onSuccess,
  onCancel,
  configured = true,
}: {
  onSuccess: () => void;
  onCancel?: () => void;
  configured?: boolean;
}) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Sunucuda parola tanimli degilse giris denemek anlamsiz (503 doner);
  // ne yapilmasi gerektigi anlatilir.
  if (!configured) return <SetupNotice onCancel={onCancel} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(pw);
      onSuccess();
    } catch (e: any) {
      setErr(e?.message ?? 'Giriş başarısız');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className={`login-card ${err ? 'shake' : ''}`} onSubmit={submit}>
        <BrandSign lg />
        <p className="login-sub">Fiyatları senin yerine kollar.</p>
        <input
          type="password"
          placeholder="Parola"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          autoComplete="current-password"
        />
        {err && <div className="login-err">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !pw}>
          {busy ? <Spinner size={15} /> : 'Giriş'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-block" onClick={onCancel}>
            Siteye dön
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * PASSWORD secret'i tanimli degilken gosterilir. Uygulama bu durumda
 * fail-closed calisir (API 503 doner), yani panel disariya acilmaz.
 */
export function SetupNotice({ onCancel }: { onCancel?: () => void }) {
  return (
    <div className="login-page">
      <div className="login-card setup-card">
        <BrandSign lg />
        <p className="login-sub">Yönetim henüz açılmadı</p>
        <div className="setup-warn">
          Site ziyaretçilere açık ve çalışıyor; ürünler ve fiyatlar herkes tarafından
          görülebiliyor. Ancak <b>yönetim</b> (ürün ekleme/silme, bildirimler ve ayarlar)
          parola tanımlı olmadığı için güvenli biçimde kapalı.
        </div>
        <p className="mut small">
          Coolify'da <b>Environment Variables</b> bölümüne aşağıdaki değişkenleri ekle,
          parolayı kendin belirle ve sonra yeniden dağıt.
        </p>
        <code className="setup-cmd">PASSWORD=&lt;seçtiğin güçlü parola&gt;</code>
        <code className="setup-cmd">PUBLIC_BASE_URL=https://gaffur.net</code>
        <p className="mut small">
          Yerel geliştirmede parolasız çalışmak istersen proje kökündeki <code>.dev.vars</code>{' '}
          dosyasına <code>ALLOW_OPEN=1</code> yaz. Bu dosya deploy edilmez.
        </p>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-block" onClick={onCancel}>
            Siteye dön
          </button>
        )}
      </div>
    </div>
  );
}

export function AccountModal({
  user,
  onClose,
  onChanged,
  watches,
  onWatchesChanged,
}: {
  user: UserAccount | null;
  onClose: () => void;
  onChanged: (user: UserAccount | null) => void;
  watches: Watch[];
  onWatchesChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const loadNotifications = async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    try {
      setNotifications((await api.userNotifications()).notifications);
    } catch {
      setNotifications([]);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (mode === 'register') await api.userRegister(email, pw, consent);
      else await api.userLogin(email, pw);
      const session = await api.userMe();
      onChanged(session.user ?? null);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'İşlem tamamlanamadı');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.userLogout();
      onChanged(null);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Çıkış yapılamadı');
      setBusy(false);
    }
  };

  const removeWatch = async (id: number) => {
    setBusy(true);
    setErr('');
    try {
      await api.deleteWatch(id);
      await onWatchesChanged();
    } catch (e: any) {
      setErr(e?.message ?? 'Takip silinemedi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="login-card account-card" role="dialog" aria-modal="true" aria-label="Kullanıcı hesabı">
        <button className="account-close" type="button" onClick={onClose} aria-label="Kapat">×</button>
        <BrandSign lg />
        {user ? (
          <>
            <p className="login-sub">Hesabın açık</p>
            <div className="account-email">{user.email}</div>
            <p className="mut small">Takip listen ({watches.length})</p>
            <div className="account-watches">
              {watches.length === 0 ? (
                <p className="mut small">Henüz bir ürün takip etmiyorsun.</p>
              ) : watches.map((watch) => (
                <div className="account-watch" key={watch.id}>
                  <span>{watch.title}</span>
                  <b>{money(watch.current_price, watch.currency)}</b>
                  <button type="button" onClick={() => removeWatch(watch.id)} disabled={busy}>Çıkar</button>
                </div>
              ))}
            </div>
            {notifications.length > 0 && (
              <div className="account-notifications">
                <div className="account-notifications-head">
                  <b>Bildirimlerin</b>
                  {notifications.some((n) => !n.read) && (
                    <button type="button" onClick={async () => { await api.readUserNotifications(); await loadNotifications(); }}>Okundu say</button>
                  )}
                </div>
                {notifications.slice(0, 5).map((n) => (
                  <div className={`account-notification ${n.read ? '' : 'unread'}`} key={n.id}>
                    <b>{n.title}</b>
                    <span>{n.product_title ?? n.body}</span>
                  </div>
                ))}
              </div>
            )}
            {err && <div className="login-err">{err}</div>}
            <button className="btn btn-ghost btn-block" onClick={logout} disabled={busy}>
              {busy ? <Spinner size={15} /> : 'Çıkış yap'}
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="login-sub">{mode === 'login' ? 'Takip listene giriş yap' : 'Ücretsiz hesap oluştur'}</p>
            <div className="account-switch" role="tablist">
              <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr(''); }}>Giriş</button>
              <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErr(''); }}>Kayıt</button>
            </div>
            <input type="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="email" />
            <input type="password" placeholder="Parola (en az 8 karakter)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {mode === 'register' && (
              <label className="account-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>KVKK aydınlatma metnini okudum ve kabul ediyorum.</span>
              </label>
            )}
            {err && <div className="login-err">{err}</div>}
            <button className="btn btn-primary btn-block" disabled={busy || !email || pw.length < 8 || (mode === 'register' && !consent)}>
              {busy ? <Spinner size={15} /> : mode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
