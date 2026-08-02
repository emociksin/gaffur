// Hepsiburada canli test: aramadan urun linki bul, scrapeUrl ile coz
import { directFetch, scrapeUrl } from '../src/worker/scrape/engine';

(async () => {
  const q = process.argv[2] ?? 'airpods 4';
  const { status, html } = await directFetch('https://www.hepsiburada.com/ara?q=' + encodeURIComponent(q));
  console.log('arama HTTP', status, 'boyut', Math.round(html.length / 1024) + 'KB');
  const links = [...html.matchAll(/href="(\/[^"]*-p-[A-Za-z0-9]+)(?:\?[^"]*)?"/g)]
    .map((m) => 'https://www.hepsiburada.com' + m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5);
  console.log('bulunan urun linkleri:');
  for (const l of links) console.log('-', l.slice(0, 100));
  if (!links.length) return console.log('link bulunamadi');
  console.log('\nilk urun scrapeUrl testi:');
  const r = await scrapeUrl(links[0], 'auto', process.env.FIRECRAWL_KEY);
  console.log(JSON.stringify(r, null, 2));
})();
