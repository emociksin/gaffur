import { useEffect, useState } from 'react';
import type { ComplianceAssessment } from '../../shared/types';
import { api } from '../api';
import { dateFull, money } from '../format';
import { IconDownload, IconRefresh, Spinner, useToast } from '../ui';

const statusText: Record<ComplianceAssessment['status'], string> = {
  consistent: 'Tutarlı',
  suspicious: 'Şüpheli',
  insufficient_data: 'Yetersiz kanıt',
};

export function CompliancePage({ onOpenProduct }: { onOpenProduct: (id: number) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<ComplianceAssessment[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setRows((await api.compliance()).assessments);

  useEffect(() => {
    load().catch(() => {
      setRows([]);
      toast('Uyum verisi yüklenemedi', 'err');
    });
  }, []);

  const refresh = async () => {
    setBusy(true);
    try {
      const [compliance, opportunities] = await Promise.all([api.refreshCompliance(), api.refreshOpportunities()]);
      await load();
      toast(`${compliance.result.count} ürün incelendi, ${opportunities.result.count} fırsat hesaplandı`, 'ok');
    } catch (error: any) {
      toast(error?.message ?? 'Hesaplama tamamlanamadı', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="compliance-page">
      <section className="compliance-head">
        <div>
          <span className="storefront-kicker">Yalnızca iç kullanım</span>
          <h2>10 günlük fiyat kanıtı</h2>
          <p>
            Gösterilen indirim referansını, Gaffur'un indirimden önce gözlediği 10 günlük fiyatlarla karşılaştırır.
            Sonuç hukuki karar değildir; kampanya başlangıcı ve satıcının tüm satış kanalları bilinmeyebilir.
          </p>
        </div>
        <div className="compliance-actions">
          <button className="btn btn-primary" onClick={refresh} disabled={busy}>
            {busy ? <Spinner size={14} /> : <IconRefresh size={15} />} Yeniden hesapla
          </button>
          <a className="btn btn-ghost" href="/api/export/compliance.csv" download>
            <IconDownload size={15} /> Toplu CSV
          </a>
        </div>
      </section>

      {rows == null ? (
        <div className="loading-block"><Spinner size={22} /></div>
      ) : rows.length === 0 ? (
        <div className="empty"><h2>Henüz inceleme yok</h2><p>“Yeniden hesapla” ile ilk günlük kanıt snapshot'ını oluştur.</p></div>
      ) : (
        <section className="compliance-list">
          {rows.map((row) => (
            <article className={`compliance-row compliance-${row.status}`} key={row.product_id}>
              <div className="compliance-row-title">
                <button type="button" onClick={() => onOpenProduct(row.product_id)}>{row.title}</button>
                <span className="compliance-status">{statusText[row.status]}</span>
              </div>
              <div className="compliance-prices">
                <span>Güncel <b>{money(row.observed_price, row.currency)}</b></span>
                <span>Gösterilen referans <b>{money(row.advertised_reference, row.currency)}</b></span>
                <span>Önceki 10 gün düşük <b>{money(row.low_10d_before, row.currency)}</b></span>
                <span>Kanıt <b>{row.sample_count} örnek</b></span>
              </div>
              <p>{row.reason}</p>
              <div className="compliance-meta">
                <span>{row.calculated_at ? dateFull(row.calculated_at) : '—'}</span>
                <a href={row.source_url} target="_blank" rel="noreferrer">Birincil kaynak</a>
                <a href={`/api/export/evidence/${row.product_id}.csv`} download>Kanıt CSV</a>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
