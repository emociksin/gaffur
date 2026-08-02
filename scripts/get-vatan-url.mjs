const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const h = await (await fetch('https://www.vatanbilgisayar.com/', { headers: { 'user-agent': UA } })).text();
const m = h.match(/href="(\/[a-z0-9-]{10,}\.html)"/i);
console.log(m ? 'https://www.vatanbilgisayar.com' + m[1] : 'yok');
