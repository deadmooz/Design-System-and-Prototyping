/**
 * Network layer for the URL extractor: SSRF-guarded fetch with size/time limits,
 * robots.txt check, and collection of a page's HTML plus all its CSS.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const USER_AGENT = 'DesignSystemPrototyper/0.1 (+design-token extraction; respects robots.txt)';

export interface FetchOptions {
  /** Allow localhost / private ranges (for extracting your own dev server). */
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

export class ExtractionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ExtractionError';
    this.status = status;
  }
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(url: URL, opts: FetchOptions) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ExtractionError(`Only http(s) URLs are supported, got ${url.protocol}`);
  if (url.username || url.password) throw new ExtractionError('URLs with credentials are not allowed');
  if (opts.allowPrivateNetwork) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new ExtractionError('Private network addresses are blocked (set ALLOW_PRIVATE_NETWORK=true for local dev servers)', 403);
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => {
    throw new ExtractionError(`Could not resolve host "${host}"`, 502);
  });
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new ExtractionError('Private network addresses are blocked (set ALLOW_PRIVATE_NETWORK=true for local dev servers)', 403);
  }
}

/** GET with manual redirects (each hop re-checked), timeout and a body size cap. */
export async function safeFetch(rawUrl: string, opts: FetchOptions = {}): Promise<{ url: string; status: number; contentType: string; body: string }> {
  const { timeoutMs = 15000, maxBytes = 3_000_000 } = opts;
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new ExtractionError(`Invalid URL: ${rawUrl}`); }
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url, opts);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/css,*/*;q=0.8' },
      });
    } catch (e: any) {
      throw new ExtractionError(e?.name === 'TimeoutError' ? `Timed out fetching ${url.href}` : `Network error fetching ${url.href}: ${e?.message ?? e}`, 502);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    const body = await readCapped(res, maxBytes);
    return { url: url.href, status: res.status, contentType: res.headers.get('content-type') ?? '', body };
  }
  throw new ExtractionError('Too many redirects', 502);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); break; }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

/** Minimal robots.txt evaluation for `User-agent: *` (longest-match Allow/Disallow). */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const groups: { agents: string[]; rules: [boolean, string][] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [key, val] = [m[1].toLowerCase(), m[2].trim()];
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow') && val) current.rules.push([key === 'allow', val]);
    }
  }
  const group = groups.find((g) => g.agents.some((a) => a.startsWith('designsystemprototyper'))) ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best: [boolean, string] | null = null;
  for (const rule of group.rules) {
    const pattern = new RegExp('^' + rule[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (pattern.test(path) && (!best || rule[1].length > best[1].length)) best = rule;
  }
  return best ? best[0] : true;
}

export interface FetchedPage {
  url: string;
  html: string;
  css: { href: string; text: string }[];
  warnings: string[];
}

export interface PageFetchOptions extends FetchOptions {
  respectRobots?: boolean;
  maxStylesheets?: number;
}

/** Fetches a page and every stylesheet it references (including one level of @import). */
export async function fetchPage(rawUrl: string, opts: PageFetchOptions = {}): Promise<FetchedPage> {
  const { respectRobots = true, maxStylesheets = 20 } = opts;
  const warnings: string[] = [];
  const target = new URL(rawUrl);

  if (respectRobots) {
    try {
      const robots = await safeFetch(new URL('/robots.txt', target).href, { ...opts, timeoutMs: 6000, maxBytes: 200_000 });
      if (robots.status === 200 && !robotsAllows(robots.body, target.pathname + target.search)) {
        throw new ExtractionError(`robots.txt of ${target.host} disallows ${target.pathname}. If you own this site, retry with "respect robots.txt" turned off.`, 403);
      }
    } catch (e) {
      if (e instanceof ExtractionError && e.status === 403) throw e;
      // Unreachable robots.txt is treated as "no restrictions".
    }
  }

  const page = await safeFetch(target.href, opts);
  if (page.status >= 400) throw new ExtractionError(`${target.href} responded with HTTP ${page.status}`, 502);
  if (!/html|xml|text\/plain/i.test(page.contentType) && page.contentType) {
    throw new ExtractionError(`Expected an HTML page but got "${page.contentType}"`, 415);
  }
  const html = page.body;
  const baseHref = html.match(/<base[^>]*href=["']([^"']+)/i)?.[1];
  const base = baseHref ? new URL(baseHref, page.url).href : page.url;

  const hrefs: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?[^"'>]*stylesheet/i.test(tag) && !/as=["']?style/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) try { hrefs.push(new URL(href.replace(/&amp;/g, '&'), base).href); } catch { /* skip */ }
  }
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  for (const text of inline) for (const imp of text.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/gi)) {
    try { hrefs.push(new URL(imp[1], base).href); } catch { /* skip */ }
  }

  const unique = [...new Set(hrefs)].filter((h) => !/fonts\.googleapis\.com|use\.typekit\.net/.test(h)).slice(0, maxStylesheets);
  if (hrefs.length > maxStylesheets) warnings.push(`Only the first ${maxStylesheets} stylesheets were analysed`);

  const css: FetchedPage['css'] = inline.map((text, i) => ({ href: `inline:${i}`, text }));
  const fetchCss = async (href: string) => {
    try {
      const r = await safeFetch(href, { ...opts, maxBytes: 2_000_000, timeoutMs: 10000 });
      if (r.status >= 400) { warnings.push(`Stylesheet ${href} returned HTTP ${r.status}`); return null; }
      return { href: r.url, text: r.body };
    } catch (e: any) {
      warnings.push(`Stylesheet ${href} skipped: ${e.message}`);
      return null;
    }
  };
  const sheets = (await Promise.all(unique.map(fetchCss))).filter((s): s is { href: string; text: string } => !!s);
  // One level of @import inside fetched sheets.
  const nested = sheets.flatMap((s) => [...s.text.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/gi)]
    .map((m) => { try { return new URL(m[1], s.href).href; } catch { return ''; } }))
    .filter((h) => h && !unique.includes(h) && !/fonts\.googleapis\.com/.test(h))
    .slice(0, 10);
  const nestedSheets = (await Promise.all(nested.map(fetchCss))).filter((s): s is { href: string; text: string } => !!s);

  return { url: page.url, html, css: [...css, ...sheets, ...nestedSheets], warnings };
}
