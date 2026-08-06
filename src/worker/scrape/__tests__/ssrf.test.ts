import { describe, it, expect } from 'vitest';
import { isBlockedIp, assertPublicUrl, SsrfError } from '../ssrf';

describe('isBlockedIp', () => {
  const blocked = [
    '127.0.0.1', '10.1.2.3', '172.16.5.5', '172.31.255.255',
    '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1',
  ];
  const allowed = [
    '8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1',
    '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8',
  ];

  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }
  for (const ip of allowed) {
    it(`allows ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }
});

describe('assertPublicUrl', () => {
  const mustReject = [
    'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/', 'http://192.168.1.1/', 'http://10.0.0.5:6379/',
    'http://localhost/', 'http://foo.localhost/', 'http://db.internal/',
    'ftp://example.com/', 'file:///etc/passwd',
    'http://user:pass@example.com/', 'http://metadata.google.internal/',
  ];
  const mustAllow = ['http://93.184.216.34/', 'https://1.1.1.1/'];

  for (const u of mustReject) {
    it(`rejects ${u}`, async () => {
      await expect(assertPublicUrl(new URL(u))).rejects.toThrow(SsrfError);
    });
  }
  for (const u of mustAllow) {
    it(`allows ${u}`, async () => {
      await expect(assertPublicUrl(new URL(u))).resolves.toBeUndefined();
    });
  }
});
