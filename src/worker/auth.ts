// Tek-parola oturum sistemi.
//
// Oturum cerezi:  <zamanDamgasi>.<nonce>.<HMAC(oturumAnahtari, zaman.nonce)>
//
// HMAC anahtari PAROLA DEGILDIR: veritabaninda tutulan, ilk kullanimda uretilen
// 32 baytlik rastgele bir anahtardir. Eskiden imza dogrudan parolayla
// uretiliyordu; bu, cerezi ele geciren birine parolayi cevrimdisi kirmak icin
// hazir bir oracle veriyordu (zaman damgasi acik, HMAC-SHA256 hizli).
// Anahtar dondurulunce (rotateSessionSecret) tum oturumlar dusler.
import type { Env } from './env';

const enc = new TextEncoder();
const SECRET_KEY = 'session_secret';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(nBytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(nBytes)));
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

async function sha256Hex(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/** Ayni uzunluktaki iki hex dizgiyi sabit surede karsilastirir. */
function eqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Sabit surede esitlik. Iki taraf da once hash'lenir; boylece calisma suresi
 * girdinin uzunlugunu da sizdirmaz (eski timingSafeEq uzunluk farkinda hemen donuyordu).
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return eqHex(ha, hb);
}

// Ayni isolate icinde tekrar tekrar DB'ye gitmemek icin kucuk onbellek
let cachedSecret: string | null = null;

async function readSecret(env: Env): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(SECRET_KEY)
    .first<{ value: string }>();
  return row?.value || null;
}

export async function getSessionSecret(env: Env): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const existing = await readSecret(env);
  if (existing) {
    cachedSecret = existing;
    return existing;
  }
  const fresh = randomHex(32);
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
    .bind(SECRET_KEY, fresh)
    .run();
  // Yaris durumunda baskasi yazmis olabilir; kazanan degeri oku
  cachedSecret = (await readSecret(env)) ?? fresh;
  return cachedSecret;
}

/** Tum oturumlari gecersiz kilar (baska cihazda acik kalan oturumu kapatmak icin). */
export async function rotateSessionSecret(env: Env): Promise<void> {
  const fresh = randomHex(32);
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
    .bind(SECRET_KEY, fresh)
    .run();
  cachedSecret = fresh;
}

export async function makeSession(env: Env): Promise<string> {
  const secret = await getSessionSecret(env);
  const payload = `${Date.now()}.${randomHex(8)}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function checkSession(env: Env, cookie: string | undefined | null): Promise<boolean> {
  if (!cookie) return false;
  const parts = cookie.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < -60_000 || age > MAX_AGE_MS) return false;
  const expect = await hmacHex(await getSessionSecret(env), `${ts}.${nonce}`);
  return eqHex(sig, expect);
}

export const SESSION_MAX_AGE_S = MAX_AGE_MS / 1000;

// ---- çok-kullanıcılı hesap sistemi (Faz 2) ----

export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16);
  const hash = await sha256Hex(salt + password);
  return `${salt}:${hash}`;
}

export async function verifyPassword(stored: string, given: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const attempt = await sha256Hex(salt + given);
  return eqHex(hash, attempt);
}

export function generateSessionId(): string {
  return randomHex(32);
}
