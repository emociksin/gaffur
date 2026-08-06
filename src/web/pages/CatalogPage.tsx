import { useEffect, useState } from 'react';
import type { CatalogMatchCandidate, CatalogMatchProduct, CatalogMetrics } from '../../shared/types';
import { api } from '../api';
import { money } from '../format';
import { IconRefresh, Spinner, useToast } from '../ui';

function percent(value: number): string {
  return `%${Math.round(Number(value || 0) * 100)}`;
}

function IdentityCard({ product, onOpen }: { product: CatalogMatchProduct; onOpen: () => void }) {
  return (
    <div className="catalog-identity">
      <button type="button" onClick={onOpen}>{product.title}</button>
      <div className="catalog-identity-meta">
        <span>{product.site}</span>
        <b>{money(product.current_price, product.currency)}</b>
        <span>Kimlik %{Math.round(product.identity_quality)}</span>
      </div>
      <dl>
        <div><dt>Marka</dt><dd>{product.normalized_brand ?? '—'}</dd></div>
        <div><dt>Model</dt><dd>{product.model_key ?? '—'}</dd></div>
        <div><dt>Varyant</dt><dd>{product.variant_key ?? '—'}</dd></div>
        <div><dt>GTIN</dt><dd>{product.gtin_valid ? product.gtin_normalized : 'geçerli kod yok'}</dd></div>
        <div><dt>MPN</dt><dd>{product.mpn_reliable ? product.mpn_normalized : 'güvenilir kod yok'}</dd></div>
      </dl>
    </div>
  );
}

export function CatalogPage({ onOpenProduct }: { onOpenProduct: (id: number) => void }) {
  const toast = useToast();
  const [matches, setMatches] = useState<CatalogMatchCandidate[] | null>(null);
  const [metrics, setMetrics] = useState<CatalogMetrics | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);

  const load = async () => {
    const [queue, measurement] = await Promise.all([api.catalogMatches('pending'), api.catalogMetrics()]);
    setMatches(queue.matches);
    setMetrics(measurement.metrics);
  };

  useEffect(() => {
    load().catch((error: any) => {
      setMatches([]);
      toast(error?.message ?? 'Katalog kuyruğu yüklenemedi', 'err');
    });
  }, []);

  const refresh = async () => {
    setBusy(true);
    try {
      const result = await api.refreshCatalogMatches();
      await load();
      toast(`${result.result.products} ürün tarandı, ${result.result.candidates} aday puanlandı`, 'ok');
    } catch (error: any) {
      toast(error?.message ?? 'Eşleştirme hesaplanamadı', 'err');
    } finally {
      setBusy(false);
    }
  };

  const review = async (candidate: CatalogMatchCandidate, decision: 'approved' | 'rejected') => {
    setReviewing(candidate.id);
    try {
      await api.reviewCatalogMatch(candidate.id, decision);
      await load();
      toast(decision === 'approved' ? 'Ürünler aynı katalog grubuna alındı' : 'Yanlış eşleşme reddedildi', 'ok');
    } catch (error: any) {
      toast(error?.message ?? 'Karar kaydedilemedi', 'err');
    } finally {
      setReviewing(null);
    }
  };

  return (
    <div className="catalog-page">
      <section className="catalog-head">
        <div>
          <span className="storefront-kicker">İnsan onaylı katalog</span>
          <h2>Ürün eşleştirme kuyruğu</h2>
          <p>
            Geçerli GTIN/MPN, Türkçe başlık, model, varyant ve fiyat tutarlılığı birlikte puanlanır.
            İlk sürüm hiçbir adayı otomatik birleştirmez; doğruluk hedefi için son karar yöneticidedir.
          </p>
        </div>
        <button className="btn btn-primary" onClick={refresh} disabled={busy}>
          {busy ? <Spinner size={14} /> : <IconRefresh size={15} />} Adayları tara
        </button>
      </section>

      {metrics && (
        <section className="catalog-metrics" aria-label="Eşleştirme ölçümleri">
          <div><span>Eşleşme oranı</span><b>%{metrics.matchRate.toFixed(1)}</b><small>{metrics.matchedProducts}/{metrics.eligibleProducts} uygun ürün</small></div>
          <div><span>Bekleyen aday</span><b>{metrics.pendingCandidates}</b><small>insan incelemesi</small></div>
          <div>
            <span>İncelenen doğruluğu</span>
            <b>{metrics.reviewedPrecision == null ? '—' : `%${metrics.reviewedPrecision.toFixed(1)}`}</b>
            <small>{metrics.precisionSampleReady ? `hedef ≥ %${metrics.precisionTarget}` : `${metrics.reviewedCandidates}/${metrics.minimumReviewSample} asgari örnek`}</small>
          </div>
        </section>
      )}

      {matches == null ? (
        <div className="loading-block"><Spinner size={22} /></div>
      ) : matches.length === 0 ? (
        <div className="empty">
          <h2>Bekleyen eşleştirme yok</h2>
          <p>Yeni ürünlerden sonra “Adayları tara” ile kimlikleri ve olası eşleşmeleri yeniden hesapla.</p>
        </div>
      ) : (
        <section className="catalog-queue">
          {matches.map((candidate) => (
            <article className={`catalog-candidate catalog-${candidate.score_band}`} key={candidate.id}>
              <header>
                <div>
                  <b>{candidate.score.toFixed(1)} / 100</b>
                  <span>{candidate.exact_code_kind ? `${candidate.exact_code_kind.toUpperCase()} kesin kod adayı` : `${candidate.score_band} güven`}</span>
                </div>
                <div className="catalog-score-parts">
                  <span>Başlık {percent(candidate.title_score)}</span>
                  <span>Model {percent(candidate.model_score)}</span>
                  <span>Fiyat {percent(candidate.price_score)}</span>
                </div>
              </header>
              <div className="catalog-pair">
                <IdentityCard product={candidate.product_a} onOpen={() => onOpenProduct(candidate.product_a.id)} />
                <div className="catalog-pair-mark" aria-hidden="true">⇄</div>
                <IdentityCard product={candidate.product_b} onOpen={() => onOpenProduct(candidate.product_b.id)} />
              </div>
              <div className="catalog-reasons">{candidate.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
              <footer>
                <button className="btn btn-ghost" disabled={reviewing === candidate.id} onClick={() => review(candidate, 'rejected')}>Aynı ürün değil</button>
                <button className="btn btn-primary" disabled={reviewing === candidate.id} onClick={() => review(candidate, 'approved')}>
                  {reviewing === candidate.id ? <Spinner size={13} /> : null} Aynı ürün, onayla
                </button>
              </footer>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
