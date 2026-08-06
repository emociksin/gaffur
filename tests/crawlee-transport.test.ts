import { describe, expect, it } from 'vitest';
import { crawleeFetch } from '../src/worker/scrape/crawlee';
import { SsrfError } from '../src/worker/scrape/ssrf';

describe('Crawlee transport SSRF koruması', () => {
  const headers = { 'user-agent': 'gaffur-test' };

  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost/',
    'http://[::1]/',
  ])('%s adresini ağ isteğinden önce reddeder', async (url) => {
    await expect(crawleeFetch(url, headers)).rejects.toBeInstanceOf(SsrfError);
  });
});
