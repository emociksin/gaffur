// Web Push icin bir kez calistirilir. PRIVATE degeri yalnizca Coolify secret olarak sakla.
const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);
const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

console.log(`VAPID_PUBLIC_KEY=${b64url(publicBytes)}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`);
console.log('VAPID_SUBJECT=mailto:bildirim@gaffur.net');
