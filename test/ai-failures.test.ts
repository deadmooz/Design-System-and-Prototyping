/** AI failure handling: JSON mode, empty "thinking" replies, and the rule-based fallback. No network beyond localhost. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { completeDesignSystem } from '../src/core/defaults.ts';
import { aiCreate, aiExtract } from '../src/extract/ai.ts';
import { ProviderRegistry } from '../src/llm/registry.ts';
import { createHandler } from '../src/server/app.ts';

/** Gemini-shaped fake: records requests; replies with `text` (empty = all tokens spent thinking). */
function geminiFetch(text: string, finishReason = 'STOP') {
  const bodies: any[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: text ? [{ text }] : [] }, finishReason }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: text.length / 4, thoughtsTokenCount: 3000 },
    }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

test('AI calls request native JSON mode and a generous output cap', async () => {
  const g = geminiFetch(JSON.stringify({ roles: { primary: '#9146FF' } }));
  const gemini = new ProviderRegistry({ GEMINI_API_KEY: 'k' }, g.impl).get('gemini');
  await aiExtract(completeDesignSystem({}), gemini);
  assert.equal(g.bodies[0].generationConfig.responseMimeType, 'application/json');
  assert.ok(g.bodies[0].generationConfig.maxOutputTokens >= 8000);

  const calls: any[] = [];
  const openaiFetch = (async (_u: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"roles":{"primary":"#FF0000"}}' } }], usage: {} }));
  }) as unknown as typeof fetch;
  await aiExtract(completeDesignSystem({}), new ProviderRegistry({ OPENAI_API_KEY: 'k' }, openaiFetch).get('openai'));
  assert.deepEqual(calls[0].response_format, { type: 'json_object' });
});

test('an empty reply from a thinking model explains itself', async () => {
  const g = geminiFetch('', 'MAX_TOKENS');
  const gemini = new ProviderRegistry({ GEMINI_API_KEY: 'k' }, g.impl).get('gemini');
  await assert.rejects(aiCreate('A calm brand for a meditation app', gemini), /empty reply.*MAX_TOKENS.*thinking/s);
  await assert.rejects(aiExtract(completeDesignSystem({}), new ProviderRegistry({ GEMINI_API_KEY: 'k' }, geminiFetch('{"roles": {"prim', 'MAX_TOKENS').impl).get('gemini')), /cut off/);
});

// --- server: failed AI review falls back to the rule-based result ---------------------------------
let site: Server, app: Server, base = '', siteUrl = '';
before(async () => {
  const html = readFileSync(new URL('./fixtures/site/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./fixtures/site/styles.css', import.meta.url), 'utf8');
  site = createServer((req, res) => {
    if (req.url === '/styles.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(css); }
    if (req.url === '/robots.txt') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
  const registry = new ProviderRegistry({ GEMINI_API_KEY: 'k' }, geminiFetch('Sorry, I cannot do that.').impl);
  app = createServer(createHandler({ env: { ALLOW_PRIVATE_NETWORK: 'true' }, registry }));
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});
after(() => { site.close(); app.close(); });

test('a failed AI review still returns the rule-based design system with the reason', async () => {
  const res = await fetch(`${base}/api/extract/url`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: siteUrl, authorized: true, ai: { provider: 'gemini' } }),
  });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.match(json.aiError, /did not return a JSON/);
  assert.equal(json.designSystem.color.roles.primary, '#7C3AED', 'rule-based result kept');
  assert.ok(json.designSystem.meta.notes.some((n: string) => /AI review failed/.test(n)));
});
