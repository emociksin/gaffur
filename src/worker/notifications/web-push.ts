import type { Env } from '../env';
import type { DeliveryAttempt } from './email';
import { assertPublicUrl } from '../scrape/ssrf';

const encoder = new TextEncoder();
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];

export function isAllowedPushEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)));
  } catch {
    return false;
  }
}

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return new Uint8Array(Array.from(binary, (char) => char.charCodeAt(0)));
}

function concat(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey('raw', arrayBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, arrayBuffer(data)));
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return hmac(salt, ikm);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const output: Uint8Array<ArrayBuffer>[] = [];
  let previous: Uint8Array<ArrayBuffer> = new Uint8Array();
  let counter = 1;
  while (output.reduce((sum, part) => sum + part.length, 0) < length) {
    previous = await hmac(prk, concat(previous, info, Uint8Array.of(counter++)));
    output.push(previous);
  }
  return concat(...output).slice(0, length);
}

function vapidConfigured(env: Env): boolean {
  return Boolean(env.VAPID_SUBJECT?.trim() && env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim());
}

export function webPushPublicConfig(env: Env): { configured: boolean; publicKey: string | null } {
  return { configured: vapidConfigured(env), publicKey: env.VAPID_PUBLIC_KEY?.trim() || null };
}

async function vapidAuthorization(env: Env, endpoint: string, nowS: number): Promise<string> {
  const publicBytes = fromB64url(env.VAPID_PUBLIC_KEY!);
  const privateBytes = fromB64url(env.VAPID_PRIVATE_KEY!);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error('VAPID anahtar biçimi geçersiz');
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(publicBytes.slice(1, 33)),
      y: b64url(publicBytes.slice(33, 65)),
      d: b64url(privateBytes),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const header = b64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: nowS + 12 * 3600,
    sub: env.VAPID_SUBJECT,
  })));
  const unsigned = `${header}.${body}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, arrayBuffer(encoder.encode(unsigned))));
  return `vapid t=${unsigned}.${b64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

export async function createWebPushRequest(
  env: Env,
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  nowS = Math.floor(Date.now() / 1000)
): Promise<{ body: Uint8Array; headers: Record<string, string> }> {
  if (!vapidConfigured(env)) throw new Error('Web push yapılandırılmadı');
  if (!isAllowedPushEndpoint(subscription.endpoint)) throw new Error('Desteklenmeyen push servis adresi');
  const receiverPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4 || authSecret.length < 16) {
    throw new Error('Push aboneliği anahtarları geçersiz');
  }

  const receiverKey = await crypto.subtle.importKey('raw', arrayBuffer(receiverPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, ephemeral.privateKey, 256));

  const authPrk = await hkdfExtract(authSecret, sharedSecret);
  const ikm = await hkdfExpand(authPrk, concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, encoder.encode('Content-Encoding: nonce\0'), 12);
  const contentKey = await crypto.subtle.importKey('raw', arrayBuffer(cek), 'AES-GCM', false, ['encrypt']);
  const plaintext = concat(encoder.encode(payload), Uint8Array.of(2));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(nonce) }, contentKey, arrayBuffer(plaintext)));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const body = concat(salt, recordSize, Uint8Array.of(senderPublic.length), senderPublic, ciphertext);

  return {
    body,
    headers: {
      authorization: await vapidAuthorization(env, subscription.endpoint, nowS),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
    },
  };
}

export async function sendWebPush(
  env: Env,
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: Record<string, unknown>
): Promise<DeliveryAttempt> {
  if (!vapidConfigured(env)) return { ok: false, configured: false, error: 'Web push VAPID anahtarları yapılandırılmadı' };
  try {
    await assertPublicUrl(new URL(subscription.endpoint));
    const request = await createWebPushRequest(env, subscription, JSON.stringify(payload));
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: request.headers,
      body: arrayBuffer(request.body),
    });
    if (response.ok) return { ok: true, configured: true };
    if (response.status === 404 || response.status === 410) {
      return { ok: false, configured: true, expired: true, error: `Push aboneliği sona erdi (${response.status})` };
    }
    return { ok: false, configured: true, error: `Web push HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, configured: true, error: error instanceof Error ? error.message : 'Web push hatası' };
  }
}
