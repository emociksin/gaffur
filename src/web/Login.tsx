import { useState } from 'react';
import { api } from './api';
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
          görülebiliyor. Ancak <b>yönetim</b> (ürün ekleme/silme, ayarlar) parola tanımlı
          olmadığı için kapalı — parolasız açılsaydı Telegram ve Firecrawl anahtarların da
          herkese görünür olurdu.
        </div>
        <p className="mut small">
          Kendi sunucunda (Coolify/Docker): <b>Environment Variables</b> bölümüne aşağıdaki
          değişkeni ekle, değeri kendi belirlediğin parola olsun, sonra yeniden dağıt.
        </p>
        <code className="setup-cmd">PASSWORD=&lt;seçtiğin parola&gt;</code>
        <p className="mut small">
          Cloudflare Workers'a dağıtıyorsan: <code>npx wrangler secret put PASSWORD</code>
        </p>
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
