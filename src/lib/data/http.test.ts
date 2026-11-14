import { afterEach, describe, expect, it, vi } from 'vitest';
import { blocked, json, mockFetch, never } from './fetch.fixture';
import { createLimiter, getJson, retryAfterMs } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getJson', () => {
  it('parses JSON and keeps third parties away from cookies and the page address', async () => {
    const calls = mockFetch(() => json({ a: 1 }));
    expect(await getJson('https://example.test/x', { service: 'onemap' })).toEqual({ ok: true, status: 200, body: { a: 1 } });
    expect(calls[0].init?.credentials).toBe('omit');
    expect(calls[0].init?.referrerPolicy).toBe('no-referrer');
  });

  it('turns a blocked network into "unavailable", never a rejection', async () => {
    mockFetch(blocked);
    const r = await getJson('https://example.test/x', { service: 'datagov' });
    expect(r).toMatchObject({ ok: false, result: { status: 'unavailable', service: 'datagov', reason: 'network' } });
  });

  it('calls an HTML page where JSON was expected a bad response', async () => {
    mockFetch(() => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await getJson('https://example.test/x', { service: 'blocks', sameOrigin: true });
    expect(r).toMatchObject({ ok: false, status: 200, result: { reason: 'bad-response' } });
  });

  it('sorts error statuses into auth and server', async () => {
    mockFetch((url) => new Response('', { status: Number(url.pathname.slice(1)) }));
    expect(await getJson('https://example.test/403', { service: 'onemap' })).toMatchObject({ ok: false, status: 403, result: { reason: 'auth' } });
    expect(await getJson('https://example.test/404', { service: 'onemap' })).toMatchObject({ ok: false, status: 404, result: { reason: 'server' } });
    expect(await getJson('https://example.test/500', { service: 'onemap' })).toMatchObject({ ok: false, status: 500, result: { reason: 'server' } });
  });

  it('gives up after its timeout', async () => {
    mockFetch(never);
    const r = await getJson('https://example.test/x', { service: 'onemap', timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, result: { reason: 'timeout' } });
  });

  it('stops at once when the caller aborts, before or during the request', async () => {
    const calls = mockFetch(never);
    const before = new AbortController();
    before.abort();
    expect(await getJson('https://example.test/x', { service: 'onemap', signal: before.signal })).toMatchObject({ result: { status: 'aborted' } });
    expect(calls).toHaveLength(0);
    const during = new AbortController();
    const pending = getJson('https://example.test/x', { service: 'onemap', signal: during.signal });
    during.abort();
    expect(await pending).toMatchObject({ result: { status: 'aborted' } });
  });

  it('waits and retries when rate-limited, as long as it is told to wait', async () => {
    let n = 0;
    const calls = mockFetch(() => (n++ === 0 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : json({ ok: true })));
    expect(await getJson('https://example.test/x', { service: 'datagov' })).toMatchObject({ ok: true, body: { ok: true } });
    expect(calls).toHaveLength(2);
  });

  it('reports "rate-limited" with the wait when the limit persists', async () => {
    const calls = mockFetch(() => new Response('', { status: 429, headers: { 'retry-after': '0' } }));
    expect(await getJson('https://example.test/x', { service: 'datagov', retries: 2 })).toMatchObject({
      ok: false,
      status: 429,
      result: { status: 'unavailable', reason: 'rate-limited', retryAfterMs: 0 }
    });
    expect(calls).toHaveLength(3);
  });

  it('does not keep someone waiting a minute: a long Retry-After ends the attempt', async () => {
    const calls = mockFetch(() => new Response('', { status: 429, headers: { 'retry-after': '60' } }));
    expect(await getJson('https://example.test/x', { service: 'datagov' })).toMatchObject({ result: { reason: 'rate-limited', retryAfterMs: 60000 } });
    expect(calls).toHaveLength(1);
  });
});

describe('retryAfterMs', () => {
  it('reads seconds and HTTP dates', () => {
    expect(retryAfterMs('5')).toBe(5000);
    expect(retryAfterMs('Fri, 13 Nov 2026 16:00:10 GMT', Date.parse('Fri, 13 Nov 2026 16:00:00 GMT'))).toBe(10000);
    expect(retryAfterMs('soon')).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });
});

describe('createLimiter', () => {
  it('lets `max` requests start per window and queues the rest', async () => {
    vi.useFakeTimers();
    const limit = createLimiter(2, 1000);
    const started: number[] = [];
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) void limit.wait().then(() => started.push(Date.now() - t0));
    await vi.advanceTimersByTimeAsync(10);
    expect(started).toEqual([0, 0]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(started).toHaveLength(3);
    expect(started[2]).toBeGreaterThanOrEqual(1000);
  });

  it('lets a queued request go when its caller gives up', async () => {
    vi.useFakeTimers();
    const limit = createLimiter(1, 1000);
    await limit.wait();
    const ctl = new AbortController();
    const waiting = limit.wait(ctl.signal);
    ctl.abort();
    await vi.advanceTimersByTimeAsync(5);
    expect(await waiting).toBe(false);
  });
});
