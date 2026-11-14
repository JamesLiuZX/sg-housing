/**
 * A stand-in for `fetch` in tests: routes each request to a function, records
 * what was asked, and honours AbortSignal the way the real one does.
 */

import { vi } from 'vitest';

export interface Call {
  url: URL;
  init: RequestInit | undefined;
}

export type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

export function mockFetch(route: Route): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      calls.push({ url, init });
      const signal = init?.signal;
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      return new Promise<Response>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
        Promise.resolve(route(url, init)).then(resolve, reject);
      });
    })
  );
  return calls;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A request that never answers (until aborted). */
export const never = (): Promise<Response> => new Promise<Response>(() => {});

/** What a browser does when the network is blocked, as in the single-file preview. */
export const blocked = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));

/** data.gov.sg's datastore_search envelope around some records. */
export function datastore(records: Record<string, unknown>[], total = records.length): Response {
  return json({ success: true, result: { records, total } });
}
