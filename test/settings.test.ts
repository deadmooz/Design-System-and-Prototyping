/** Settings API: keys are written to a temp .env, never echoed back, and take effect without a restart. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createHandler } from '../src/server/app.ts';
import { readEnvFile, writeEnvFile } from '../src/server/settings.ts';

const dir = mkdtempSync(join(tmpdir(), 'dsp-settings-'));
const envFile = join(dir, '.env');
const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'sk-from-system-env-1234' };
let server: Server;
let base = '';

before(async () => {
  writeFileSync(envFile, '# my settings\nPORT=4310\n');
  server = createServer(createHandler({ env, envFile }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('writeEnvFile keeps comments and other lines, replaces and removes keys', () => {
  const f = join(dir, 'sample.env');
  writeFileSync(f, '# keep\nA=1\nB=2\n');
  writeEnvFile(f, { A: '9', B: null, C: '3' });
  assert.equal(readFileSync(f, 'utf8'), '# keep\nA=9\nC=3\n');
  assert.deepEqual([...readEnvFile(f)], [['A', '9'], ['C', '3']]);
});

test('saving a key stores it in .env, enables the provider, and never echoes it', async () => {
  const res = await post('/api/settings', { id: 'xai', apiKey: 'xai-secret-ABCD', model: 'grok-test-1' });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  assert.ok(!text.includes('xai-secret'), 'full key never returned');
  const xai = JSON.parse(text).providers.find((p: any) => p.id === 'xai');
  assert.deepEqual([xai.configured, xai.source, xai.keyHint, xai.model], [true, 'saved', '…ABCD', 'grok-test-1']);
  assert.match(readFileSync(envFile, 'utf8'), /^# my settings\nPORT=4310\nXAI_API_KEY=xai-secret-ABCD\nXAI_MODEL=grok-test-1\n$/);
  const providers = await (await fetch(`${base}/api/providers`)).json();
  const p = providers.providers.find((x: any) => x.id === 'xai');
  assert.equal(p.configured, true, 'registry rebuilt without restart');
  assert.equal(p.defaultModel, 'grok-test-1');
});

test('keys from the system environment are reported but cannot be removed here', async () => {
  const s = await (await fetch(`${base}/api/settings`)).json();
  const openai = s.providers.find((p: any) => p.id === 'openai');
  assert.equal(openai.source, 'environment');
  assert.equal(openai.keyHint, '…1234');
  const res = await post('/api/settings', { id: 'openai', remove: true });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /system environment/);
});

test('removing a saved key disables the provider', async () => {
  const res = await post('/api/settings', { id: 'xai', remove: true });
  assert.equal(res.status, 200);
  assert.ok(!readFileSync(envFile, 'utf8').includes('XAI_API_KEY'));
  const providers = await (await fetch(`${base}/api/providers`)).json();
  assert.equal(providers.providers.find((x: any) => x.id === 'xai').configured, false);
});

test('invalid input is rejected before anything is written', async () => {
  const before = readFileSync(envFile, 'utf8');
  for (const body of [
    { id: 'xai', apiKey: 'has space' },
    { id: 'xai', apiKey: 'x\nEVIL=1' },
    { id: 'xai', apiKey: 'quote"d' },
    { id: 'xai', model: 'bad model;' },
    { id: 'nope', apiKey: 'abc' },
    { id: 'xai' },
  ]) {
    assert.equal((await post('/api/settings', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(readFileSync(envFile, 'utf8'), before);
});

test('default provider can only be a configured provider', async () => {
  assert.equal((await post('/api/settings/default', { provider: 'bogus' })).status, 400);
  const s = await (await post('/api/settings/default', { provider: 'openai' })).json();
  assert.equal(s.defaultProvider, 'openai');
  assert.equal(s.activeDefault, 'openai');
  assert.match(readFileSync(envFile, 'utf8'), /DEFAULT_PROVIDER=openai/);
  const s2 = await (await post('/api/settings/default', { provider: 'gemini' })).json();
  assert.equal(s2.activeDefault, 'mock', 'unconfigured default falls back to mock');
});

test('testing an unconfigured provider fails without any network call', async () => {
  const res = await post('/api/settings/test', { provider: 'xai' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not configured/);
});
