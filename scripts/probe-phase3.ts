import { crawleeScrape, scrapeUrl } from '../src/worker/scrape/engine';

const directTargets = [
  ['vatan', 'https://www.vatanbilgisayar.com/apple/apple-airpods-4.html'],
  ['apple', 'https://www.apple.com/tr/shop/buy-airpods/airpods-4/aktif-gürültü-engelleme-özelliği-olmadan'],
] as const;

const searches = [
  {
    name: 'hepsiburada', url: 'https://www.hepsiburada.com/ara?q=airpods+4',
    link: /href="([^"]*-p-[A-Za-z0-9]+)(?:\?[^"#]*)?"/i, origin: 'https://www.hepsiburada.com',
  },
  {
    name: 'incehesap', url: 'https://www.incehesap.com/gaming-kulaklik-fiyatlari/',
    link: /href="(\/[^"]+-(?:gaming|oyuncu)-kulakl[^"?#]*\/)(?:\?[^"#]*)?"/i, origin: 'https://www.incehesap.com',
  },
] as const;

for (const [name, url] of directTargets) {
  const r = await scrapeUrl(url, 'auto');
  console.log(name, JSON.stringify({ ok: r.ok, engine: r.engine, price: r.price, title: r.title, error: r.error }));
}

for (const target of searches) {
  try {
    const html = await crawleeScrape(target.url);
    const match = html.match(target.link);
    const product = match?.[1] ? new URL(match[1], target.origin).toString() : '';
    const r = product ? await scrapeUrl(product, 'auto') : null;
    console.log(target.name, JSON.stringify({
      searchBytes: html.length, product, ok: r?.ok, engine: r?.engine,
      price: r?.price, title: r?.title, error: r?.error,
    }));
  } catch (error) {
    console.log(target.name, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
