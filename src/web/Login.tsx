import { useState } from 'react';
import { api } from './api';
import { BrandSign, Spinner } from './ui';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
      </form>
    </div>
  );
}

/**
 * PASSWORD secret'i tanimli degilken gosterilir. Uygulama bu durumda
 * fail-closed calisir (API 503 doner), yani panel disariya acilmaz.
 */
export function SetupNotice() {
  return (
    <div className="login-page">
      <div className="login-card setup-card">
        <BrandSign lg />
        <p className="login-sub">Kurulum tamamlanmadı</p>
        <div className="setup-warn">
          Yönetim parolası tanımlı olmadığı için uygulama kilitli. Bu bilinçli bir güvenlik
          önlemi: parola olmadan panel herkese açık olurdu.
        </div>
        <p className="mut small">Sunucuda tek komut yeterli, sonra sayfayı yenile:</p>
        <code className="setup-cmd">npx wrangler secret put PASSWORD</code>
        <p className="mut small">
          Yerel geliştirmede parolasız çalışmak istersen proje kökündeki <code>.dev.vars</code>{' '}
          dosyasına <code>ALLOW_OPEN=1</code> yaz. Bu dosya deploy edilmez.
        </p>
      </div>
    </div>
  );
}
