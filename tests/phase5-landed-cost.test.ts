import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalD1 } from '../src/server/d1';
import { calculateLandedCost } from '../src/worker/intelligence/landed-cost';
import { extractGeneric, extractLogistics } from '../src/worker/scrape/parse';
import { app } from '../src/worker/index';

describe('Faz 5 kapıdaki maliyet motoru', () => {
  let db: LocalD1;
  let env: any;
  const t = 1_800_000_000;

  beforeEach(() => {
    db = new LocalD1(':memory:');
    const dir = join(process.cwd(), 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.endsWith('.pg.sql')).sort()) {
      db.raw().exec(readFileSync(join(dir, file), 'utf8'));
    }
    env = { DB: db };
  });

  it('yurtiçi teslimatta ürün ve kargoyu toplar', async () => {
    const result = await calculateLandedCost(env, {
      scenario: 'domestic', originRegion: 'domestic', productKind: 'general',
      itemPrice: 100, shippingCost: 10, currency: 'TRY', fxRateTry: 1, eurTryRate: 1,
    }, t);
    expect(result).toEqual(expect.objectContaining({ status: 'calculated', taxTry: 0, totalTry: 110 }));
  });

  it('genel posta ürününde GTİP olmadan vergi uydurmaz', async () => {
    const result = await calculateLandedCost(env, {
      scenario: 'postal', originRegion: 'other', productKind: 'general',
      itemPrice: 100, shippingCost: 0, currency: 'EUR', fxRateTry: 50, eurTryRate: 50,
      freightDocumented: false, nonCommercial: true,
    }, t);
    expect(result).toEqual(expect.objectContaining({
      status: 'requires_detailed_declaration', assumedFreightTry: 150, taxableTry: 5150, knownSubtotalTry: 5000, taxTry: null, totalTry: null,
    }));
  });

  it('reçeteli AB sağlık ürününde doğrulanmış %30 oranını uygular', async () => {
    const result = await calculateLandedCost(env, {
      scenario: 'postal', originRegion: 'eu', productKind: 'health',
      itemPrice: 100, shippingCost: 10, currency: 'EUR', fxRateTry: 50, eurTryRate: 50,
      freightDocumented: true, nonCommercial: true, hasPrescription: true,
    }, t);
    expect(result).toEqual(expect.objectContaining({ status: 'calculated', taxableTry: 5500, effectiveRate: 0.3, taxTry: 1650, totalTry: 7150 }));
  });

  it('ÖTV IV seçildiğinde tek-maktu orana ilave %20 ekler', async () => {
    const result = await calculateLandedCost(env, {
      scenario: 'postal', originRegion: 'eu', productKind: 'health',
      itemPrice: 100, shippingCost: 10, currency: 'EUR', fxRateTry: 50, eurTryRate: 50,
      freightDocumented: true, nonCommercial: true, hasPrescription: true, isOtvList4: true,
    }, t);
    expect(result).toEqual(expect.objectContaining({ effectiveRate: 0.5, taxTry: 2750, totalTry: 8250 }));
  });

  it('kitapta %0 oranını, telefonda posta yasağını uygular', async () => {
    const common = { scenario: 'postal' as const, originRegion: 'other' as const, itemPrice: 20, currency: 'EUR', fxRateTry: 50, eurTryRate: 50, nonCommercial: true };
    const book = await calculateLandedCost(env, { ...common, productKind: 'book' }, t);
    const phone = await calculateLandedCost(env, { ...common, productKind: 'phone' }, t);
    expect(book).toEqual(expect.objectContaining({ status: 'calculated', taxTry: 0, totalTry: 1000 }));
    expect(phone).toEqual(expect.objectContaining({ status: 'prohibited', totalTry: null }));
  });

  it('yolcu beraberinde 430 Avro muafiyetini aşan kısma oran uygular', async () => {
    const result = await calculateLandedCost(env, {
      scenario: 'passenger', originRegion: 'other', productKind: 'general',
      itemPrice: 500, shippingCost: 0, currency: 'EUR', fxRateTry: 50, eurTryRate: 50,
      nonCommercial: true, passengerAge: 30,
    }, t);
    expect(result).toEqual(expect.objectContaining({ status: 'calculated', taxTry: 2100, totalTry: 27100, effectiveRate: 0.6 }));
  });

  it('JSON-LD kargo ücretini ve açık taksit ifadesini ayrıştırır', () => {
    const html = `<script type="application/ld+json">{
      "@type":"Product","name":"Ürün","offers":{"@type":"Offer","price":"999","priceCurrency":"TRY",
      "shippingDetails":{"shippingRate":{"@type":"MonetaryAmount","value":"49,90","currency":"TRY"}}}
    }</script><div>Peşin fiyatına 6 taksit</div>`;
    expect(extractGeneric(html)).toEqual(expect.objectContaining({ price: 999, shippingCost: 49.9, installmentCount: 6 }));
  });

  it('ücretsiz kargoyu sıfır maliyet olarak yakalar', () => {
    expect(extractLogistics('<span>Ücretsiz Kargo</span><p>12 taksit fırsatı</p>'))
      .toEqual({ shippingCost: 0, installmentCount: 12 });
  });

  it('hesaplama API ucunu ziyaretçiye kaynaklı sonuçla açar', async () => {
    const response = await app.fetch(new Request('http://localhost/api/landed-cost/calculate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: 'postal', originRegion: 'other', productKind: 'general', itemPrice: 25,
        shippingCost: 0, currency: 'EUR', fxRateTry: 50, eurTryRate: 50, nonCommercial: true,
      }),
    }), env);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.result).toEqual(expect.objectContaining({ status: 'requires_detailed_declaration', totalTry: null }));
    expect(body.result.rule.source_url).toContain('ticaret.gov.tr');
  });
});
