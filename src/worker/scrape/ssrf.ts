// SSRF korumasi + guvenli fetch.
//
// directFetch yoneticinin girdigi magazaya ve kuyruktaki kayitli URL'lere gider.
// Koruma olmadan ele gecirilmis bir yonetim oturumu veya zehirli eski veri sunucuya
// ic ag / bulut metadata servisi (169.254.169.254) istegi attirabilir. Uc katmanli savunma:
//   1. sema + userinfo dogrulamasi           (her runtime)
//   2. IP-literal host'larin ozel/reserved aralik kontrolu (her runtime)
//   3. hostname'in DNS ile cozulup her cozulen IP'nin kontrolu (Node)
// Ayrica safeFetch: manuel redirect takibi (her hop yeniden dogrulanir),
// timeout ve yanit govdesi boyut tavani.
//
// Bilinen artik risk: DNS rebinding (dogrulama ile baglanti arasindaki TOCTOU).
// Hostname yerine dogrulanan IP'ye baglanmak vhost/SNI'yi bozup mesru magazalari
// kirardi; bu yuzden hotfix'te kabul edildi, ilerleyen fazda daraltilacak.

export class SsrfError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SsrfError';
  }
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const BLOCKED_HOST_EXACT = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
]);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp'];

// ---- IPv4 ----

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => n > 255)) return null;
  return (parts[0] * 2 ** 24 + parts[1] * 2 ** 16 + parts[2] * 2 ** 8 + parts[3]) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return false;
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (b & mask) >>> 0;
  };
  return (
    inRange('0.0.0.0', 8) || // "bu ag"
    inRange('10.0.0.0', 8) || // ozel
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local + bulut metadata
    inRange('172.16.0.0', 12) || // ozel
    inRange('192.0.0.0', 24) || // IETF protokol tahsisi
    inRange('192.168.0.0', 16) || // ozel
    inRange('198.18.0.0', 15) || // benchmark
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved
  );
}

// ---- IPv6 ----

function isBlockedIpv6(raw: string): boolean {
  let ip = raw.toLowerCase();
  const pct = ip.indexOf('%'); // zone id
  if (pct >= 0) ip = ip.slice(0, pct);
  // IPv4-mapped/gomulu (::ffff:a.b.c.d, ::a.b.c.d)
  const v4m = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4m && isBlockedIpv4(v4m[1])) return true;
  if (ip === '::1' || ip === '::') return true; // loopback / unspecified
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(ip)) return true; // ff00::/8 multicast
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

// ---- DNS (yalnizca Node; workerd'de yoktur) ----

let dnsMod: { lookup: (h: string, o: any) => Promise<Array<{ address: string }>> } | null | undefined;

async function loadDns() {
  if (dnsMod !== undefined) return dnsMod;
  try {
    // Hesapli specifier: tsc (workers-types) statik cozmeye calismaz, workerd
    // build'i de statik gomup patlamaz. Node'da calisir; workerd'de throw → null.
    const spec = 'node:' + 'dns';
    const m: any = await import(/* @vite-ignore */ spec);
    dnsMod = (m.promises ?? m.default?.promises) as typeof dnsMod;
  } catch {
    dnsMod = null;
  }
  return dnsMod;
}

/** URL'yi SSRF acisindan dogrula; sorunluysa SsrfError firlatir. */
export async function assertPublicUrl(u: URL): Promise<void> {
  if (!ALLOWED_SCHEMES.has(u.protocol)) throw new SsrfError(`izin verilmeyen şema: ${u.protocol}`);
  if (u.username || u.password) throw new SsrfError('URL kullanıcı bilgisi içeremez');

  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); // v6 koseli parantezleri at
  if (!host) throw new SsrfError('geçersiz host');
  if (BLOCKED_HOST_EXACT.has(host)) throw new SsrfError(`engelli host: ${host}`);
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new SsrfError(`engelli host: ${host}`);

  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (isIpLiteral) {
    if (isBlockedIp(host)) throw new SsrfError(`özel/yerel IP engellendi: ${host}`);
    return; // literal public IP — DNS gerekmez
  }

  const dns = await loadDns();
  if (!dns) return; // workerd: DNS yok, kenar agi zaten ic aga yonlenemez
  let addrs: Array<{ address: string }>;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`ad çözümlenemedi: ${host}`);
  }
  if (!addrs.length) throw new SsrfError(`ad çözümlenemedi: ${host}`);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfError(`host özel/yerel IP'ye çözümlendi: ${host} → ${a.address}`);
  }
}

/**
 * SSRF-guvenli fetch: her redirect hop'unu yeniden dogrular, timeout uygular.
 * Redirect'leri manuel takip eder (redirect:'follow' dogrulamayi atlatirdi).
 */
export async function safeFetch(rawUrl: string, headers: Record<string, string>): Promise<Response> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current.toString(), {
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has('location');
    if (!isRedirect) return res;
    const loc = res.headers.get('location')!;
    try {
      await res.body?.cancel();
    } catch {
      /* yok say */
    }
    current = new URL(loc, current); // gorece adresleri coz
  }
  throw new SsrfError(`çok fazla yönlendirme (${MAX_REDIRECTS})`);
}

/** Yanit govdesini boyut tavaniyla oku (bellek tuketimini sinirla). */
export async function readCapped(res: Response): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body) return await res.text();
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (total >= MAX_BYTES) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* yok say */
    }
  }
  out += decoder.decode();
  return out;
}
