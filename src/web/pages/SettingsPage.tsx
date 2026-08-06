import { useEffect, useState } from 'react';
import type { AppSettings, Category } from '../../shared/types';
import { api } from '../api';
import { IconDownload, IconSend, IconTrash, Spinner, Toggle, useToast } from '../ui';

export function SettingsPage({ open }: { open: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<AppSettings | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tgName, setTgName] = useState('');

  // Sunucu Telegram token'ini maskeli gönderir; kullanıcı dokunmazsa mevcut değer korunur.
  const [has, setHas] = useState({ telegram_token: false });

  const load = async () => {
    const [a, c] = await Promise.all([api.settings(), api.categories()]);
    setS(a.settings);
    setHas(a.has);
    setCats(c.categories);
  };

  useEffect(() => {
    load().catch(() => toast('Ayarlar yüklenemedi', 'err'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s)
    return (
      <div className="loading-block">
        <Spinner size={22} />
      </div>
    );

  const save = async (patch: Partial<AppSettings>, label = 'Kaydedildi') => {
    setBusy('save');
    try {
      const r = await api.saveSettings(patch);
      setS(r.settings);
      toast(label, 'ok');
    } catch (e: any) {
      toast(e?.message ?? 'Kaydedilemedi', 'err');
    } finally {
      setBusy(null);
    }
  };

  const detectTg = async () => {
    setBusy('tg-detect');
    try {
      const r = await api.telegramDetect(s.telegram_token);
      setS({ ...s, telegram_chat: r.chatId });
      setTgName(r.name);
      toast(`Bulundu: ${r.name || r.chatId}`, 'ok');
    } catch (e: any) {
      toast(e?.message ?? 'Chat bulunamadı', 'err');
    } finally {
      setBusy(null);
    }
  };

  const testTg = async () => {
    setBusy('tg-test');
    try {
      await api.saveSettings({ telegram_token: s.telegram_token, telegram_chat: s.telegram_chat });
      await api.telegramTest();
      toast('Test mesajı gönderildi — Telegram\'ı kontrol et', 'ok');
    } catch (e: any) {
      toast(e?.message ?? 'Gönderilemedi', 'err');
    } finally {
      setBusy(null);
    }
  };

  const patchCat = async (id: number, body: Record<string, unknown>) => {
    try {
      await api.patchCategory(id, body);
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Güncellenemedi', 'err');
    }
  };

  const delCat = async (c: Category) => {
    if (!window.confirm(`"${c.name}" kategorisi silinsin mi? İçindeki ürünler silinmez, kategorisiz kalır.`)) return;
    try {
      await api.deleteCategory(c.id, 'keep');
      await load();
      toast('Kategori silindi', 'ok');
    } catch (e: any) {
      toast(e?.message ?? 'Silinemedi', 'err');
    }
  };

  const tgReady = (has.telegram_token || s.telegram_token) && s.telegram_chat;

  return (
    <div className="settings">
      <section className="set-card">
        <div className="set-head">
          <h3>
            <IconSend size={17} /> Telegram bildirimleri
          </h3>
          <span className={`pill ${tgReady ? 'pill-ok' : ''}`}>{tgReady ? 'bağlı' : 'kurulmadı'}</span>
        </div>
        <ol className="set-steps">
          <li>
            Telegram'da <b>@BotFather</b>'a yaz, <code>/newbot</code> komutuyla bot oluştur, verdiği token'ı buraya
            yapıştır.
          </li>
          <li>Oluşan botunu Telegram'da aç ve <code>/start</code> yaz.</li>
          <li>"Sohbeti Bul" düğmesine bas — chat kimliğin otomatik bulunur.</li>
        </ol>
        <div className="set-row">
          <input
            placeholder="Bot token (123456:ABC-...)"
            value={s.telegram_token}
            onChange={(e) => setS({ ...s, telegram_token: e.target.value })}
            onFocus={(e) => {
              // maskeli degeri temizle ki uzerine yeni token yazilabilsin
              if (e.target.value.includes('****')) setS({ ...s, telegram_token: '' });
            }}
            spellCheck={false}
            type="password"
          />
          <button className="btn btn-ghost" onClick={detectTg} disabled={busy === 'tg-detect' || !s.telegram_token}>
            {busy === 'tg-detect' ? <Spinner size={14} /> : null} Sohbeti Bul
          </button>
        </div>
        <div className="set-row">
          <input
            placeholder="Chat ID"
            value={s.telegram_chat}
            onChange={(e) => setS({ ...s, telegram_chat: e.target.value })}
            spellCheck={false}
          />
          <button
            className="btn btn-primary"
            onClick={testTg}
            disabled={busy === 'tg-test' || !(has.telegram_token || s.telegram_token) || !s.telegram_chat}
          >
            {busy === 'tg-test' ? <Spinner size={14} /> : <IconSend size={14} />} Kaydet ve Test Et
          </button>
        </div>
        {tgName && <p className="mut small">Bağlı sohbet: {tgName}</p>}
      </section>

      <section className="set-card">
        <div className="set-head">
          <h3>Genel</h3>
        </div>
        <div className="set-grid">
          <label>
            Varsayılan kontrol sıklığı
            <select
              value={s.default_interval}
              onChange={(e) => {
                setS({ ...s, default_interval: e.target.value });
                save({ default_interval: e.target.value });
              }}
            >
              <option value="15">15 dakikada bir</option>
              <option value="30">30 dakikada bir</option>
              <option value="60">Saatte bir</option>
              <option value="180">3 saatte bir</option>
              <option value="720">12 saatte bir</option>
            </select>
          </label>
          <Toggle
            checked={s.notify_stock === '1'}
            onChange={(v) => {
              setS({ ...s, notify_stock: v ? '1' : '0' });
              save({ notify_stock: v ? '1' : '0' });
            }}
            label="Stok değişiminde bildir"
          />
          <Toggle
            checked={s.notify_rise === '1'}
            onChange={(v) => {
              setS({ ...s, notify_rise: v ? '1' : '0' });
              save({ notify_rise: v ? '1' : '0' });
            }}
            label="Fiyat artışında da bildir"
          />
        </div>
      </section>

      {cats.length > 0 && (
        <section className="set-card">
          <div className="set-head">
            <h3>Kategoriler</h3>
          </div>
          <ul className="cat-manage">
            {cats.map((c) => (
              <li key={c.id}>
                <input
                  type="color"
                  value={c.color}
                  onChange={(e) => patchCat(c.id, { color: e.target.value })}
                  title="Renk"
                />
                <input
                  className="cat-name"
                  defaultValue={c.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && patchCat(c.id, { name: e.target.value.trim() })}
                />
                <span className="mut small">{c.product_count ?? 0} ürün</span>
                {c.source_url && (
                  <Toggle
                    checked={!!c.auto_track}
                    onChange={(v) => patchCat(c.id, { auto_track: v })}
                    label="oto keşif"
                  />
                )}
                <button className="icon-btn" onClick={() => delCat(c)} title="Kategoriyi sil">
                  <IconTrash size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="set-card">
        <div className="set-head">
          <h3>Veri</h3>
        </div>
        <div className="set-row">
          <a className="btn btn-ghost" href="/api/export/products.csv" download>
            <IconDownload size={15} /> Ürünleri CSV indir
          </a>
        </div>
      </section>

      <section className="set-card">
        <div className="set-head">
          <h3>Güvenlik</h3>
        </div>
        {!open && (
          <div className="set-row set-row-wrap">
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await api.logout().catch(() => {});
                location.reload();
              }}
            >
              Çıkış yap
            </button>
            <button
              className="btn btn-ghost danger"
              onClick={async () => {
                if (!confirm('Tüm cihazlardaki oturumlar kapatılacak. Devam edilsin mi?')) return;
                try {
                  await api.logoutAll();
                  location.reload();
                } catch {
                  toast('Oturumlar kapatılamadı', 'err');
                }
              }}
            >
              Tüm cihazlarda çıkış
            </button>
          </div>
        )}
        {open ? (
          // Acik mod uyarisi tam da acik moddayken gorunmeli; eskiden tersiydi
          // ve operator korumasiz calistigini fark edemiyordu.
          <div className="setup-warn">
            Bu kurulum <b>parolasız</b> çalışıyor: adrese ulaşan herkes ürünleri görebilir,
            silebilir ve yönetim ayarlarını değiştirebilir. Bu yalnızca yerel geliştirme için
            uygundur. Yayına almadan önce Coolify ortam değişkenlerinde <code>PASSWORD</code>{' '}
            tanımla ve <code>ALLOW_OPEN</code> değişkenini kaldır.
          </div>
        ) : (
          <p className="mut">
            Uygulama parola korumalı. Parolayı Coolify ortam değişkenlerindeki{' '}
            <code>PASSWORD</code> değeri belirler; değişiklikten sonra yeniden dağıtım gerekir.
          </p>
        )}
      </section>
    </div>
  );
}
