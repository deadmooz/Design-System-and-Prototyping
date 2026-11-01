/** In-process HTTP tests with the mock provider: no API keys, no LLM spend. */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { completeDesignSystem } from '../src/core/defaults.ts';
import { createHandler } from '../src/server/app.ts';

let server: Server;
let base = '';

before(async () => {
  server = createServer(createHandler({ env: { DEFAULT_PROVIDER: 'mock' } }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('GET /api/providers lists providers without secrets', async () => {
  const res = await fetch(`${base}/api/providers`);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.default, 'mock');
  assert.equal(json.providers.length, 5);
});

test('POST /api/generate creates a page with the mock provider', async () => {
  const ds = completeDesignSystem({ meta: { name: 'T' } });
  const res = await post('/api/generate', { designSystem: ds, kind: 'page', instruction: 'login page', pages: [{ id: 'home', name: 'Home' }], page: { id: 'home', name: 'Home', html: '' } });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.match(json.html, /Welcome back/);
  assert.equal(json.provider, 'mock');
});

test('generation validates input', async () => {
  const ds = completeDesignSystem({});
  assert.equal((await post('/api/generate', { designSystem: ds, instruction: 'x' })).status, 400, 'page required');
  assert.equal((await post('/api/generate', { designSystem: ds, kind: 'component', instruction: '' })).status, 400, 'instruction required');
  assert.equal((await post('/api/generate', { designSystem: ds, kind: 'component', instruction: 'x', provider: 'openai' })).status, 400, 'unconfigured provider');
});

test('extraction requires explicit authorization and blocks private hosts', async () => {
  assert.equal((await post('/api/extract/url', { url: 'https://example.com' })).status, 400);
  const res = await post('/api/extract/url', { url: 'http://127.0.0.1:1/', authorized: true });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /Private network/);
  assert.equal((await post('/api/extract/figma', { url: 'abcdefghijk1', authorized: true })).status, 401, 'figma token required');
});

test('POST /api/create builds a system with AI; AI extraction validates the provider before fetching', async () => {
  const res = await post('/api/create', { brief: 'Playful green learning app with rounded shapes', ai: { provider: 'mock' } });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.designSystem.meta.source.type, 'ai');
  assert.equal(json.designSystem.color.roles.primary, '#16A34A');
  assert.equal((await post('/api/create', { brief: 'x', ai: { provider: 'mock' } })).status, 422);
  const ext = await post('/api/extract/url', { url: 'https://example.com', authorized: true, ai: { provider: 'openai' } });
  assert.equal(ext.status, 400, 'unconfigured AI provider rejected without network');
  assert.match((await ext.json()).error, /not configured/);
});

test('CSRF and content-type guards', async () => {
  assert.equal((await post('/api/generate', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/generate', {}, { origin: 'null' })).status, 403);
  const plain = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
});

test('serves the workspace and type-stripped shared modules, but nothing else', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /DS Studio/);
  const mod = await fetch(`${base}/src/core/emit.ts`);
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type') ?? '', /javascript/);
  assert.ok(!(await mod.text()).includes(': DesignSystem'), 'types stripped');
  for (const p of ['/src/prototype/generate.ts', '/src/server/app.ts', '/../package.json', '/%2e%2e/.env', '/src/core/../../.env.example']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});
