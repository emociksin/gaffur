// workerd (wrangler dev) uzerinden hangi siteler cekilebiliyor?
// Node ile urun linki bul → worker /api/preview'a sor.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function findLink(home, patterns) {
  try {
    const res = await fetch(home, { headers: { 'user-agent': UA, 'accept-language': 'tr-TR,tr;q=0.9' } });
    const html = await res.text();
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        let u = m[1];
        if (u.startsWith('/')) u = new URL(u, home).href;
        return u;
      }
    }
  } catch {}
  return null;
}

const sites = [
  ['vatan', 'https://www.vatanbilgisayar.com/', [/href="(\/[a-z0-9-]{10,}\.html)"/i]],
  ['itopya', 'https://www.itopya.com/', [/href="(https:\/\/www\.itopya\.com\/[a-z0-9-]{12,})"/i, /href="(\/[A-Za-z0-9-]{12,}_p[0-9]*)"/]],
  ['incehesap', 'https://www.incehesap.com/', [/href="(\/[a-z0-9-]+-fiyati-[0-9]+)\/?"/i]],
  ['mediamarkt', 'https://www.mediamarkt.com.tr/', [/href="(\/tr\/product\/[^"]+)"/i]],
  ['hepsiburada', null, ['https://www.hepsiburada.com/dexmon-airpods-4-3-2-1-pro-pro-2-uyumlu-silikon-kulaklik-tutucu-kulak-askisi-dusmeyi-onleyici-p-HBCV00007CAOMK']],
];

for (const [name, home, pats] of sites) {
  const link = home ? await findLink(home, pats) : pats[0];
  if (!link) {
    console.log(name.padEnd(13), 'link bulunamadi');
    continue;
  }
  try {
    const r = await fetch('http://127.0.0.1:8787/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: link }),
    });
    const j = await r.json();
    if (j.result?.ok) {
      console.log(name.padEnd(13), 'OK ', j.result.price, j.result.currency, '|', (j.result.title ?? '').slice(0, 45));
    } else {
      console.log(name.padEnd(13), 'FAIL', (j.error ?? '').slice(0, 70));
    }
  } catch (e) {
    console.log(name.padEnd(13), 'ERR ', String(e).slice(0, 60));
  }
}
