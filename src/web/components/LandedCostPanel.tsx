import { useEffect, useState } from 'react';
import type { LandedCostInput, LandedCostResult, OfferSummary } from '../../shared/types';
import { api } from '../api';
import { money } from '../format';
import { Spinner, useToast } from '../ui';

export function LandedCostPanel({ price, currency, offers }: { price: number | null; currency: string; offers: OfferSummary[] }) {
  const toast = useToast();
  const [scenario, setScenario] = useState<LandedCostInput['scenario']>('domestic');
  const [originRegion, setOriginRegion] = useState<LandedCostInput['originRegion']>('domestic');
  const [productKind, setProductKind] = useState<LandedCostInput['productKind']>('general');
  const [itemPrice, setItemPrice] = useState(String(price ?? ''));
  const [shippingCost, setShippingCost] = useState('0');
  const [fxRateTry, setFxRateTry] = useState(currency === 'TRY' ? '1' : '');
  const [eurTryRate, setEurTryRate] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [freightDocumented, setFreightDocumented] = useState(true);
  const [hasPrescription, setHasPrescription] = useState(false);
  const [isOtvList4, setIsOtvList4] = useState(false);
  const [result, setResult] = useState<LandedCostResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setItemPrice(String(price ?? '')), [price]);

  const calculate = async () => {
    const eurRate = scenario === 'domestic' ? 1 : Number(eurTryRate.replace(',', '.'));
    setBusy(true);
    try {
      const response = await api.calculateLandedCost({
        scenario,
        originRegion: scenario === 'domestic' ? 'domestic' : originRegion,
        productKind,
        itemPrice: Number(itemPrice.replace(',', '.')),
        shippingCost: Number(shippingCost.replace(',', '.')) || 0,
        currency,
        fxRateTry: Number(fxRateTry.replace(',', '.')),
        eurTryRate: eurRate,
        weightKg: weightKg ? Number(weightKg.replace(',', '.')) : null,
        freightDocumented,
        nonCommercial: true,
        hasPrescription,
        isOtvList4,
      });
      setResult(response.result);
    } catch (error: any) {
      toast(error?.message ?? 'Maliyet hesaplanamadı', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 className="sec-title">Kapıdaki maliyet</h3>
      {offers.length > 0 && (
        <ul className="mini-notifs">
          {offers.map((offer) => (
            <li key={offer.id}>
              <span className="mini-notif-title">{offer.seller_name || offer.marketplace}</span>
              <span className="mut">
                {offer.shipping_cost == null ? 'kargo bilinmiyor' : `kargo ${money(offer.shipping_cost, offer.currency || currency)}`}
                {offer.max_installments ? ` · ${offer.max_installments} taksit` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="form-grid">
        <label>
          Senaryo
          <select value={scenario} onChange={(e) => {
            const value = e.target.value as LandedCostInput['scenario'];
            setScenario(value);
            if (value === 'domestic') setOriginRegion('domestic');
            else if (originRegion === 'domestic') setOriginRegion('eu');
            setResult(null);
          }}>
            <option value="domestic">Türkiye içi teslimat</option>
            <option value="postal">Posta / hızlı kargo</option>
            <option value="passenger">Yolcu beraberinde</option>
          </select>
        </label>
        {scenario !== 'domestic' && (
          <label>
            Çıkış bölgesi
            <select value={originRegion} onChange={(e) => setOriginRegion(e.target.value as LandedCostInput['originRegion'])}>
              <option value="eu">AB ülkesinden doğrudan</option>
              <option value="other">Diğer ülke</option>
            </select>
          </label>
        )}
        {scenario === 'postal' && (
          <label>
            Ürün türü
            <select value={productKind} onChange={(e) => setProductKind(e.target.value as LandedCostInput['productKind'])}>
              <option value="general">Genel ürün</option>
              <option value="book">Kitap / basılı yayın</option>
              <option value="health">İlaç / takviye</option>
              <option value="phone">Cep telefonu</option>
            </select>
          </label>
        )}
        <label>
          Ürün fiyatı ({currency})
          <input value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          Kargo ({currency})
          <input value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          1 {currency} kaç TL?
          <input value={fxRateTry} onChange={(e) => setFxRateTry(e.target.value)} inputMode="decimal" disabled={currency === 'TRY'} />
        </label>
        {scenario !== 'domestic' && (
          <>
            <label>
              1 Avro kaç TL?
              <input value={eurTryRate} onChange={(e) => setEurTryRate(e.target.value)} inputMode="decimal" placeholder="güncel kuru gir" />
            </label>
            <label>
              Brüt ağırlık (kg)
              <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} inputMode="decimal" placeholder="bilinmiyor" />
            </label>
          </>
        )}
      </div>
      {scenario === 'postal' && (
        <div className="det-savebar">
          <label className="pause-label"><input type="checkbox" checked={freightDocumented} onChange={(e) => setFreightDocumented(e.target.checked)} />Kargo faturada ayrı gösteriliyor</label>
          {productKind === 'health' && <label className="pause-label"><input type="checkbox" checked={hasPrescription} onChange={(e) => setHasPrescription(e.target.checked)} />Rapor / reçete var</label>}
          <label className="pause-label"><input type="checkbox" checked={isOtvList4} onChange={(e) => setIsOtvList4(e.target.checked)} />ÖTV IV listesinde</label>
        </div>
      )}
      <div className="det-savebar">
        <span className="mut">Kur ve kargo kullanıcı girdisidir; sonuç hukuki veya mali danışmanlık değildir.</span>
        <button className="btn btn-primary" onClick={calculate} disabled={busy}>{busy ? <Spinner size={14} /> : null} Hesapla</button>
      </div>
      {result && (
        <>
          <div className="det-stats">
            <div><small>Ürün</small><b>{money(result.itemTry, 'TRY')}</b></div>
            <div><small>Ödenen kargo</small><b>{money(result.shippingTry, 'TRY')}</b></div>
            {result.assumedFreightTry > 0 && <div><small>Vergi matrahına emsal navlun</small><b>{money(result.assumedFreightTry, 'TRY')}</b></div>}
            <div><small>Vergi</small><b>{result.taxTry == null ? 'belirlenemiyor' : money(result.taxTry, 'TRY')}</b></div>
            <div><small>Kapıdaki toplam</small><b className={result.totalTry != null ? 'stat-green' : ''}>{result.totalTry == null ? 'detaylı beyan gerekli' : money(result.totalTry, 'TRY')}</b></div>
          </div>
          {result.warnings.map((warning) => <div className="form-err" key={warning}>{warning}</div>)}
          <small className="mut">Kural: {result.rule.rule_code} · <a href={result.rule.source_url} target="_blank" rel="noreferrer">{result.rule.source_title}</a></small>
        </>
      )}
    </>
  );
}
