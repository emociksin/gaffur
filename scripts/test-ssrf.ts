// SSRF guard birim testleri (ag gerektirmez — IP siniflandirma + URL dogrulama).
// DNS cozumlu senaryolar canli oldugu icin burada test edilmez; IP-literal,
// sema, userinfo ve hostname denylist yollari deterministik test edilir.
import { assertPublicUrl, isBlockedIp, SsrfError } from '../src/worker/scrape/ssrf';

let fail = 0;
const eq = (label: string, got: unknown, exp: unknown) => {
  if (got !== exp) {
    fail++;
    console.log('FAIL', label, '→ beklenen', exp, 'gelen', got);
  }
};

// ---- isBlockedIp ----
const blocked = [
  '127.0.0.1',
  '10.1.2.3',
  '172.16.5.5',
  '172.31.255.255',
  '192.168.0.1',
  '169.254.169.254', // bulut metadata
  '100.64.0.1', // CGNAT
  '0.0.0.0',
  '::1',
  'fe80::1',
  'fc00::1',
  'fd12:3456::1',
  '::ffff:127.0.0.1', // IPv4-mapped loopback
];
const allowed = [
  '8.8.8.8',
  '93.184.216.34',
  '1.1.1.1',
  '172.32.0.1', // 172.16/12 disi
  '100.128.0.1', // CGNAT disi
  '2606:4700:4700::1111',
  '::ffff:8.8.8.8',
];
for (const ip of blocked) eq(`isBlockedIp(${ip})`, isBlockedIp(ip), true);
for (const ip of allowed) eq(`isBlockedIp(${ip})`, isBlockedIp(ip), false);

// ---- assertPublicUrl: reddedilmeli ----
const mustReject = [
  'http://127.0.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://[::1]/',
  'http://192.168.1.1/',
  'http://10.0.0.5:6379/',
  'http://localhost/',
  'http://foo.localhost/',
  'http://db.internal/',
  'ftp://example.com/',
  'file:///etc/passwd',
  'http://user:pass@example.com/', // userinfo
  'http://metadata.google.internal/',
];
// ---- assertPublicUrl: literal public IP kabul edilmeli (DNS gerekmez) ----
const mustAllow = ['http://93.184.216.34/', 'https://1.1.1.1/'];

(async () => {
  for (const u of mustReject) {
    let threw = false;
    try {
      await assertPublicUrl(new URL(u));
    } catch (e) {
      threw = e instanceof SsrfError;
    }
    eq(`reject ${u}`, threw, true);
  }
  for (const u of mustAllow) {
    let ok = true;
    try {
      await assertPublicUrl(new URL(u));
    } catch {
      ok = false;
    }
    eq(`allow ${u}`, ok, true);
  }

  console.log(fail === 0 ? `TUM SSRF TESTLERI GECTI (${blocked.length + allowed.length + mustReject.length + mustAllow.length})` : `${fail} SSRF testi FAIL`);
  process.exit(fail ? 1 : 0);
})();
