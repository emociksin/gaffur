// Canli kesif testi: arama/kategori sayfasindan urun listesi cikar, ilk urunu tekil coz
import { directFetch, scrapeUrl } from '../src/worker/scrape/engine';
import { discoverTrendyol } from '../src/worker/scrape/sites';

const url = process.argv[2] ?? 'https://www.trendyol.com/sr?q=airpods+4';

(async () => {
  const { status, html } = await directFetch(url);
  console.log('HTTP', status, 'boyut', html.length);
  const items = discoverTrendyol(html, 8);
  console.log('kesfedilen urun:', items.length);
  for (const i of items) console.log('-', i.price, '|', i.title.slice(0, 60), '|', i.url.slice(0, 80));
  if (items.length > 0) {
    console.log('\nilk urun tekil kontrol:');
    const r = await scrapeUrl(items[0].url, 'auto', process.env.FIRECRAWL_KEY);
    console.log(JSON.stringify(r, null, 2));
  }
})();
