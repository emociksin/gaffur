// Canli parser testi: npm run probe -- <url> [auto|direct|firecrawl]
// Firecrawl denemek icin: FIRECRAWL_KEY ortam degiskeni
import { scrapeUrl } from '../src/worker/scrape/engine';

const url = process.argv[2];
const engine = (process.argv[3] as 'auto' | 'direct' | 'firecrawl') ?? 'auto';

if (!url) {
  console.log('kullanim: npm run probe -- <url> [auto|direct|firecrawl]');
  process.exit(1);
}

scrapeUrl(url, engine, process.env.FIRECRAWL_KEY).then((r) => {
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 2);
});
