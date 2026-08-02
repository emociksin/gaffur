// Hangi siteler dogrudan fetch'e izin veriyor? (transport testi)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HEADERS: Record<string, string> = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

const targets = [
  ['trendyol-ana', 'https://www.trendyol.com/'],
  ['trendyol-arama', 'https://www.trendyol.com/sr?q=airpods'],
  ['hepsiburada', 'https://www.hepsiburada.com/'],
  ['n11', 'https://www.n11.com/'],
  ['amazon-tr', 'https://www.amazon.com.tr/'],
  ['mediamarkt', 'https://www.mediamarkt.com.tr/'],
  ['teknosa', 'https://www.teknosa.com/'],
  ['vatan', 'https://www.vatanbilgisayar.com/'],
  ['itopya', 'https://www.itopya.com/'],
  ['incehesap', 'https://www.incehesap.com/'],
  ['decathlon', 'https://www.decathlon.com.tr/'],
];

(async () => {
  for (const [name, url] of targets) {
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      const html = await res.text();
      const blocked = /captcha|cf-chl|Access Denied|PerimeterX|_Incapsula_/i.test(html.slice(0, 6000));
      console.log(
        name.padEnd(16),
        String(res.status).padEnd(4),
        `${Math.round(html.length / 1024)}KB`.padEnd(8),
        blocked ? 'ENGEL-ISARETI' : 'ok'
      );
    } catch (e: any) {
      console.log(name.padEnd(16), 'HATA', String(e?.cause?.code ?? e?.message).slice(0, 60));
    }
    await new Promise((r) => setTimeout(r, 600));
  }
})();
