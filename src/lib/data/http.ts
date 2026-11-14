/**
 * One way to ask an outside service for JSON. It never throws: every way a
 * request can go wrong (offline, blocked in the single-file preview, slow,
 * rate-limited, broken) comes back as a typed `Unavailable` or `Aborted`, so
 * the interface can say the right thing and nothing ends up as an unhandled
 * rejection.
 */

import type { Aborted, Service, Unavailable, UnavailableReason } from './types';

export type JsonOutcome =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number | null; result: Unavailable | Aborted };

export interface Limiter {
  /** Resolves true when a request may start now, false if `signal` fired while waiting. */
  wait(signal?: AbortSignal): Promise<boolean>;
}

export interface GetJsonOptions {
  service: Service;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Per attempt, including reading the body. */
  timeoutMs?: number;
  /** Extra attempts after a 429 or a 502/503/504. */
  retries?: number;
  limiter?: Limiter;
  /** Same-origin files (the block index) may use cookies and send a referrer like any page asset. */
  sameOrigin?: boolean;
}

const ABORTED: Aborted = { status: 'aborted' };

export function unavailable(service: Service, reason: UnavailableReason, detail?: string, retryAfterMs?: number): Unavailable {
  const u: Unavailable = { status: 'unavailable', service, reason };
  if (detail) u.detail = detail;
  if (retryAfterMs !== undefined) u.retryAfterMs = retryAfterMs;
  return u;
}

/** Waits `ms`, or less if `signal` fires. Resolves false when cut short. */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((done) => {
    if (signal?.aborted) return done(false);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      done(true);
    }, ms);
    const stop = (): void => {
      clearTimeout(timer);
      done(false);
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** Retry-After is either seconds or an HTTP date. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/**
 * Keeps request starts under `max` per `windowMs`, queueing the rest. data.gov.sg
 * allows four datastore searches per ten seconds without a key; staying under
 * that is kinder than collecting 429s and retrying.
 */
export function createLimiter(max: number, windowMs: number): Limiter {
  const starts: number[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  return {
    wait(signal) {
      const turn = queue.then(async () => {
        for (;;) {
          if (signal?.aborted) return false;
          const now = Date.now();
          while (starts.length && now - starts[0] >= windowMs) starts.shift();
          if (starts.length < max) {
            starts.push(now);
            return true;
          }
          if (!(await sleep(windowMs - (now - starts[0]) + 25, signal))) return false;
        }
      });
      queue = turn;
      return turn;
    }
  };
}

/** Polite waits after a 429 when the service does not say how long: data.gov.sg's window is ten seconds. */
const BACKOFF_MS = [3000, 7000];
/** Longer than this and we stop and tell the person rather than keep them waiting. */
const MAX_WAIT_MS = 15000;

export async function getJson(url: string, options: GetJsonOptions): Promise<JsonOutcome> {
  const { service, signal, timeoutMs = 12000, retries = 2 } = options;
  const fail = (result: Unavailable | Aborted, status: number | null = null): JsonOutcome => ({ ok: false, status, result });

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) return fail(ABORTED);
    if (options.limiter && !(await options.limiter.wait(signal))) return fail(ABORTED);

    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    const forward = (): void => ctl.abort();
    signal?.addEventListener('abort', forward, { once: true });

    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        signal: ctl.signal,
        headers: { accept: 'application/json', ...options.headers },
        // Nothing about the person or the page they are on goes to a third party.
        ...(options.sameOrigin ? {} : { credentials: 'omit' as const, referrerPolicy: 'no-referrer' as const })
      });
      text = await res.text();
    } catch (err) {
      if (signal?.aborted) return fail(ABORTED);
      if (timedOut) return fail(unavailable(service, 'timeout', `no answer in ${timeoutMs} ms`));
      return fail(unavailable(service, 'network', err instanceof Error ? err.message : String(err)));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    }

    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      const asked = retryAfterMs(res.headers.get('retry-after'));
      const wait = asked ?? (res.status === 429 ? (BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]) : 1000) + Math.random() * 500;
      if (attempt < retries && wait <= MAX_WAIT_MS) {
        if (!(await sleep(wait, signal))) return fail(ABORTED);
        continue;
      }
      return res.status === 429
        ? fail(unavailable(service, 'rate-limited', 'too many requests', asked ?? undefined), 429)
        : fail(unavailable(service, 'server', `HTTP ${res.status}`), res.status);
    }
    if (res.status === 401 || res.status === 403) return fail(unavailable(service, 'auth', `HTTP ${res.status}`), res.status);
    if (!res.ok) return fail(unavailable(service, 'server', `HTTP ${res.status}`), res.status);

    try {
      return { ok: true, status: res.status, body: JSON.parse(text) as unknown };
    } catch {
      return fail(unavailable(service, 'bad-response', 'not JSON'), res.status);
    }
  }
}

/**
 * Resolves with `promise`, or with null as soon as `signal` fires. For sharing
 * one in-flight request between callers who may each give up on their own.
 */
export function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((done) => {
    const stop = (): void => done(null);
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', stop);
        done(v);
      },
      () => {
        signal.removeEventListener('abort', stop);
        done(null);
      }
    );
  });
}
