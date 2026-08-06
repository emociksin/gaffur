import { CheerioCrawler, Configuration, LogLevel } from '@crawlee/cheerio';
import { assertPublicUrl, SsrfError } from './ssrf';

const MAX_REDIRECTS = 5;
const MAX_HTML_CHARS = 5 * 1024 * 1024;
const REDIRECT_CODES = [301, 302, 303, 307, 308];
const config = new Configuration({ persistStorage: false, logLevel: LogLevel.ERROR });

export interface CrawleeResponse {
  status: number;
  html: string;
  url: string;
}

/**
 * CheerioCrawler transport'u. Redirect takibi bilerek kapalıdır; her Location hedefi
 * mevcut SSRF doğrulamasından geçirilip ayrı istek olarak alınır.
 */
export async function crawleeFetch(rawUrl: string, headers: Record<string, string>): Promise<CrawleeResponse> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    let captured: CrawleeResponse | null = null;
    let location: string | undefined;
    let failure: Error | null = null;

    const crawler = new CheerioCrawler({
      maxConcurrency: 1,
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 0,
      navigationTimeoutSecs: 20,
      requestHandlerTimeoutSecs: 25,
      ignoreHttpErrorStatusCodes: REDIRECT_CODES,
      preNavigationHooks: [async (_ctx, gotOptions) => {
        gotOptions.followRedirect = false;
        gotOptions.headers = { ...(gotOptions.headers ?? {}), ...headers };
      }],
      async requestHandler(ctx) {
        const status = ctx.response?.statusCode ?? 0;
        const raw = typeof ctx.body === 'string' ? ctx.body : ctx.body.toString('utf8');
        const html = raw.slice(0, MAX_HTML_CHARS);
        const header = ctx.response?.headers?.location;
        location = Array.isArray(header) ? header[0] : header;
        captured = { status, html, url: current.toString() };
      },
      async failedRequestHandler({ request }, error) {
        failure = error instanceof Error ? error : new Error(String(error ?? request.errorMessages.join('; ')));
      },
    }, config);

    await crawler.run([current.toString()]);
    if (failure) throw failure;
    if (!captured) throw new Error('Crawlee yanıt üretemedi');
    const response = captured as CrawleeResponse;
    if (!REDIRECT_CODES.includes(response.status) || !location) return response;
    current = new URL(location, current);
  }
  throw new SsrfError(`çok fazla yönlendirme (${MAX_REDIRECTS})`);
}
