import { LLMError, type ProviderId } from './types.ts';

export interface PostOptions {
  provider: ProviderId;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST JSON with one retry on 429/5xx/network errors. Errors never include request headers (keys). */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, opts: PostOptions): Promise<any> {
  const { provider, timeoutMs = 120_000, fetchImpl = fetch } = opts;
  for (let attempt = 0; attempt < 2; attempt++) {
    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    } catch (e: any) {
      if (opts.signal?.aborted) throw new LLMError(provider, 'Request cancelled', 499);
      // Retry quick network blips only; a timed-out request would just make the user wait twice as long.
      if (attempt === 0 && e?.name !== 'TimeoutError') { await sleep(800); continue; }
      throw new LLMError(provider, e?.name === 'TimeoutError' ? 'Request timed out' : `Network error: ${e?.message ?? e}`, 504, true);
    }
    if (res.ok) return res.json();
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      message = j.error?.message ?? j.message ?? j.error ?? message;
      if (typeof message !== 'string') message = JSON.stringify(message).slice(0, 400);
    } catch { /* not JSON */ }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt === 0) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Math.min(10_000, Number.isFinite(after) && after > 0 ? after * 1000 : 1500));
      continue;
    }
    const hint = res.status === 401 || res.status === 403 ? ' (check the API key)' : res.status === 404 ? ' (check the model name)' : '';
    throw new LLMError(provider, `HTTP ${res.status}: ${message}${hint}`, res.status === 401 || res.status === 403 ? 401 : res.status >= 500 ? 502 : res.status, retryable);
  }
  throw new LLMError(provider, 'Request failed', 502, true);
}
