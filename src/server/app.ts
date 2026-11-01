/**
 * HTTP API + workspace host on node:http (no framework). The handler is
 * exported separately from listen() so tests can drive it in-process.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { parseDesignSystem } from '../core/defaults.ts';
import { extractFromFigma } from '../extract/figma/index.ts';
import { refineWithLLM } from '../extract/refine.ts';
import type { DesignSystem } from '../core/schema.ts';
import { aiCreate, aiExtract, cssTokenEvidence } from '../extract/ai.ts';
import { analyzeWebsite } from '../extract/web/analyze.ts';
import { ExtractionError, fetchPage } from '../extract/web/fetch.ts';
import { ProviderRegistry } from '../llm/registry.ts';
import { LLMError, type LLMProvider } from '../llm/types.ts';
import { generate } from '../prototype/generate.ts';
import type { PrototypePage, SavedComponent } from '../prototype/types.ts';
import { applySettings, describeSettings, setDefaultProvider } from './settings.ts';
import { serveStatic } from './static.ts';

export interface AppConfig {
  env: Record<string, string | undefined>;
  registry?: ProviderRegistry;
  /** Where the Settings view saves API keys. Defaults to the repository's .env. */
  envFile?: string;
}

const DEFAULT_ENV_FILE = resolve(import.meta.dirname, '../../.env');

/** Key management is only allowed from this machine, even if the server listens more widely. */
function isLoopback(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const MAX_BODY = 2_000_000;

async function readJson(req: IncomingMessage): Promise<any> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Content-Type must be application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': type.startsWith('application/json') ? 'no-store' : 'no-cache',
  });
  res.end(payload);
}

/** Small TTL cache so re-importing the same URL costs nothing. */
class TtlCache<V> {
  private map = new Map<string, { at: number; value: V }>();
  private ttlMs: number;
  private max: number;
  constructor(ttlMs: number, max: number) { this.ttlMs = ttlMs; this.max = max; }
  get(k: string) {
    const e = this.map.get(k);
    if (!e || Date.now() - e.at > this.ttlMs) { this.map.delete(k); return undefined; }
    return e.value;
  }
  set(k: string, value: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(k, { at: Date.now(), value });
  }
}

const str = (v: unknown, name: string, max = 4000): string => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `"${name}" is required`);
  if (v.length > max) throw new HttpError(400, `"${name}" is too long`);
  return v.trim();
};

function pagesFrom(v: unknown): PrototypePage[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({ id: p.id.slice(0, 64), name: p.name.slice(0, 80), html: typeof p.html === 'string' ? p.html : '' }));
}

function componentsFrom(v: unknown): SavedComponent[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).filter((c) => c && typeof c.name === 'string' && typeof c.html === 'string')
    .map((c) => ({ id: String(c.id ?? c.name).slice(0, 64), name: c.name.slice(0, 80), html: c.html.slice(0, 20000) }));
}

/**
 * The measured result is already useful, so a failed AI review (bad JSON, timeout, provider error)
 * returns it with `aiError` instead of failing the whole import.
 */
async function withAiFallback(base: DesignSystem, run: () => Promise<{ ds: DesignSystem; usage: unknown; provider: string; model: string }>, signal: AbortSignal) {
  try {
    const out = await run();
    return { designSystem: out.ds, usage: out.usage, provider: out.provider, model: out.model };
  } catch (e: any) {
    if (signal.aborted) throw e;
    const aiError = e?.message ?? String(e);
    return { designSystem: { ...base, meta: { ...base.meta, notes: [...base.meta.notes, `AI review failed, rule-based result kept: ${aiError}`] } }, aiError };
  }
}

/** Host of an Origin header; opaque origins ("null", sandboxed iframes) never match. */
function originHost(origin: string): string | null {
  try { return new URL(origin).host || null; } catch { return null; }
}

function requireAuthorization(body: any) {
  if (body.authorized !== true) {
    throw new HttpError(400, 'Confirm that you own this design or are authorized to use it ("authorized": true).');
  }
}

export function createHandler(cfg: AppConfig) {
  // Rebuilt whenever keys change in Settings, so new keys work without a restart.
  let registry = cfg.registry ?? new ProviderRegistry(cfg.env);
  const envFile = cfg.envFile ?? DEFAULT_ENV_FILE;
  const settings = () => ({ ...describeSettings(cfg.env, envFile), activeDefault: registry.defaultId });
  const settingsRoutes: Record<string, (body: any) => Promise<unknown>> = {
    'POST /api/settings': async (body) => {
      try {
        applySettings({ id: str(body.id, 'id', 40), apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined, model: body.model, remove: body.remove === true }, cfg.env, envFile);
      } catch (e: any) {
        throw new HttpError(400, e.message);
      }
      registry = new ProviderRegistry(cfg.env);
      return settings();
    },
    'POST /api/settings/default': async (body) => {
      try { setDefaultProvider(str(body.provider, 'provider', 40), cfg.env, envFile); } catch (e: any) { throw new HttpError(400, e.message); }
      registry = new ProviderRegistry(cfg.env);
      return settings();
    },
    // One tiny completion (≈20 tokens) so the user can confirm a key works.
    'POST /api/settings/test': async (body) => {
      const provider = registry.get(str(body.provider, 'provider', 40));
      const res = await provider.complete({ messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 16 });
      return { ok: true, provider: res.provider, model: res.model, reply: res.text.trim().slice(0, 40), usage: res.usage };
    },
  };
  const allowPrivateNetwork = cfg.env.ALLOW_PRIVATE_NETWORK === 'true';
  const urlCache = new TtlCache<{ ds: DesignSystem; cssTokens: [string, string][] }>(10 * 60_000, 50);
  /** `ai: { provider?, model? }` turns on AI-assisted mode; `undefined`/`false` keeps it rule-based (free). */
  const aiChoice = (v: unknown): { provider: LLMProvider; model?: string } | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as { provider?: unknown; model?: unknown };
    return { provider: registry.get(typeof o.provider === 'string' && o.provider ? o.provider : undefined), model: typeof o.model === 'string' && o.model ? o.model : undefined };
  };

  const routes: Record<string, (body: any, signal: AbortSignal) => Promise<unknown>> = {
    'POST /api/extract/url': async (body, signal) => {
      requireAuthorization(body);
      const url = str(body.url, 'url', 2048);
      const respectRobots = body.respectRobots !== false;
      const ai = aiChoice(body.ai); // validated before any network work
      const key = `${url}|${respectRobots}`;
      let cached = urlCache.get(key);
      const hit = Boolean(cached);
      if (!cached) {
        const page = await fetchPage(/^https?:\/\//i.test(url) ? url : `https://${url}`, { allowPrivateNetwork, respectRobots });
        cached = { ds: analyzeWebsite(page), cssTokens: cssTokenEvidence(page) };
        urlCache.set(key, cached);
      }
      if (!ai) return { designSystem: cached.ds, cached: hit };
      return withAiFallback(cached.ds, () => aiExtract(cached.ds, ai.provider, { cssTokens: cached.cssTokens }, { model: ai.model, signal }), signal);
    },
    'POST /api/extract/figma': async (body, signal) => {
      requireAuthorization(body);
      const ai = aiChoice(body.ai);
      const token = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : cfg.env.FIGMA_TOKEN ?? '';
      const ds = await extractFromFigma(str(body.url, 'url', 2048), token);
      if (!ai) return { designSystem: ds };
      return withAiFallback(ds, () => aiExtract(ds, ai.provider, {}, { model: ai.model, signal }), signal);
    },
    'POST /api/create': async (body, signal) => {
      const ai = aiChoice(body.ai ?? {});
      try {
        const out = await aiCreate(str(body.brief, 'brief', 2000), ai!.provider, { model: ai!.model, name: typeof body.name === 'string' ? body.name : undefined, signal });
        return { designSystem: out.ds, usage: out.usage, provider: out.provider, model: out.model };
      } catch (e: any) {
        if (e instanceof LLMError) throw e;
        throw new HttpError(422, e.message);
      }
    },
    'POST /api/refine': async (body) => {
      const ds = parseDesignSystem(body.designSystem);
      const out = await refineWithLLM(ds, registry.get(body.provider), body.model || undefined);
      return { designSystem: out.ds, usage: out.usage };
    },
    'POST /api/generate': async (body, signal) => {
      const ds = parseDesignSystem(body.designSystem);
      const kind = body.kind === 'component' ? 'component' : 'page';
      const pages = pagesFrom(body.pages);
      const page = kind === 'page' ? pagesFrom([body.page])[0] : undefined;
      if (kind === 'page' && !page) throw new HttpError(400, '"page" with id and name is required');
      const history = Array.isArray(body.history) ? body.history.filter((h: unknown) => typeof h === 'string').slice(-3) : [];
      const instruction = str(body.instruction, 'instruction');
      const provider = registry.get(body.provider);
      try {
        return await generate(provider, {
          ds, kind, pages, page, history, components: componentsFrom(body.components),
          instruction, model: typeof body.model === 'string' && body.model ? body.model : undefined, signal,
        });
      } catch (e: any) {
        if (e instanceof LLMError) throw e;
        throw new HttpError(422, e.message);
      }
    },
  };

  return async function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (url.pathname.startsWith('/api/')) {
        // CSRF guard: browsers send Origin on cross-site POSTs; only same-origin is allowed.
        const origin = req.headers.origin;
        if (req.method !== 'GET' && origin && originHost(origin) !== req.headers.host) throw new HttpError(403, 'Cross-origin requests are not allowed');
        if (route === 'GET /api/health') return send(res, 200, { ok: true });
        if (route === 'GET /api/providers') return send(res, 200, { default: registry.defaultId, providers: registry.list(), figmaTokenConfigured: Boolean(cfg.env.FIGMA_TOKEN) });
        if (url.pathname === '/api/settings' || url.pathname.startsWith('/api/settings/')) {
          if (!isLoopback(req)) throw new HttpError(403, 'API keys can only be managed from the machine running the server');
          if (route === 'GET /api/settings') return send(res, 200, settings());
          const sfn = settingsRoutes[route];
          if (!sfn) throw new HttpError(404, `No route ${route}`);
          return send(res, 200, await sfn(await readJson(req)));
        }
        const fn = routes[route];
        if (!fn) throw new HttpError(404, `No route ${route}`);
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        const result = await fn(await readJson(req), controller.signal);
        return send(res, 200, result);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      const file = await serveStatic(url.pathname);
      if (!file) throw new HttpError(404, 'Not found');
      return send(res, file.status, file.body, file.type);
    } catch (e: any) {
      const status = e instanceof HttpError || e instanceof ExtractionError || e instanceof LLMError ? e.status : 500;
      if (status === 500) console.error(e);
      // Local single-user server: show the real message (it is ours, never a secret) so failures are actionable.
      if (!res.headersSent) send(res, status >= 400 && status < 600 ? status : 500, { error: e?.message ? String(e.message).slice(0, 500) : 'Internal error' });
    }
  };
}
