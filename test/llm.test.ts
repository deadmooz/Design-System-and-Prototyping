/** Adapter contract tests with a fake fetch — no network, no tokens spent. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderRegistry } from '../src/llm/registry.ts';
import { LLMError } from '../src/llm/types.ts';

type Call = { url: string; headers: Record<string, string>; body: any };

function fakeFetch(responses: { status?: number; json: unknown; headers?: Record<string, string> }[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const env = { ANTHROPIC_API_KEY: 'a-key', OPENAI_API_KEY: 'o-key', GEMINI_API_KEY: 'g-key', XAI_API_KEY: 'x-key' };
const req = { system: 'SYS', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 100 };

test('anthropic adapter: request shape, cached system prompt, usage', async () => {
  const f = fakeFetch([{ json: { model: 'm', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 } } }]);
  const res = await new ProviderRegistry(env, f.impl).get('anthropic').complete(req);
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.headers['x-api-key'], 'a-key');
  assert.equal(c.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(c.body.system, [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
  assert.equal(c.body.max_tokens, 100);
  assert.equal(res.text, 'ok');
  assert.deepEqual(res.usage, { inputTokens: 15, outputTokens: 2, cachedInputTokens: 5 });
});

test('openai adapter: chat completions with system message and max_completion_tokens', async () => {
  const f = fakeFetch([{ json: { model: 'gpt', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } } }]);
  const res = await new ProviderRegistry(env, f.impl).get('openai').complete(req);
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(c.headers.authorization, 'Bearer o-key');
  assert.deepEqual(c.body.messages[0], { role: 'system', content: 'SYS' });
  assert.equal(c.body.max_completion_tokens, 100);
  assert.equal(res.usage.inputTokens, 7);
});

test('xai adapter reuses the OpenAI wire format at api.x.ai', async () => {
  const f = fakeFetch([{ json: { choices: [{ message: { content: 'ok' } }], usage: {} } }]);
  await new ProviderRegistry(env, f.impl).get('xai').complete(req);
  assert.equal(f.calls[0].url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(f.calls[0].headers.authorization, 'Bearer x-key');
  assert.equal(f.calls[0].body.max_tokens, 100);
});

test('gemini adapter: key in header (never URL), systemInstruction, role mapping', async () => {
  const f = fakeFetch([{ json: { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, thoughtsTokenCount: 2 } } }]);
  const res = await new ProviderRegistry(env, f.impl).get('gemini').complete({ ...req, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
  const c = f.calls[0];
  assert.match(c.url, /\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.ok(!c.url.includes('g-key'));
  assert.equal(c.headers['x-goog-api-key'], 'g-key');
  assert.deepEqual(c.body.systemInstruction, { parts: [{ text: 'SYS' }] });
  assert.deepEqual(c.body.contents.map((m: any) => m.role), ['user', 'model', 'user']);
  assert.equal(res.text, 'ok');
  assert.equal(res.usage.outputTokens, 3);
});

test('minimal reasoning maps to each model family, and is dropped if a model rejects it', async () => {
  const ok = { json: { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: {} } };
  const cases: [string, unknown][] = [
    ['gemini-2.5-flash', { thinkingBudget: 0 }], ['gemini-2.5-pro', { thinkingBudget: 128 }],
    ['gemini-3.5-flash-lite', { thinkingLevel: 'low' }], ['gemini-flash-latest', { thinkingLevel: 'low' }], ['gemini-1.5-flash', undefined],
  ];
  for (const [model, expected] of cases) {
    const f = fakeFetch([ok]);
    await new ProviderRegistry(env, f.impl).get('gemini').complete({ ...req, model, reasoning: 'minimal' });
    assert.deepEqual(f.calls[0].body.generationConfig.thinkingConfig, expected, model);
  }
  const rejecting = fakeFetch([{ status: 400, json: { error: { message: 'Thinking level LOW is not supported for this model.' } } }, ok]);
  const r = await new ProviderRegistry(env, rejecting.impl).get('gemini').complete({ ...req, model: 'gemini-3.9-ultra', reasoning: 'minimal' });
  assert.equal(r.text, 'ok');
  assert.equal(rejecting.calls[1].body.generationConfig.thinkingConfig, undefined, 'retried without thinking config');

  const o = fakeFetch([{ json: { choices: [{ message: { content: 'ok' } }], usage: {} } }]);
  await new ProviderRegistry(env, o.impl).get('openai').complete({ ...req, reasoning: 'minimal' });
  assert.equal(o.calls[0].body.reasoning_effort, 'low', 'gpt-5 family');
  const o2 = fakeFetch([{ json: { choices: [{ message: { content: 'ok' } }], usage: {} } }]);
  await new ProviderRegistry(env, o2.impl).get('openai').complete({ ...req, model: 'gpt-4o', reasoning: 'minimal' });
  assert.equal(o2.calls[0].body.reasoning_effort, undefined, 'non-reasoning models are left alone');
});

test('retries once on 429 then surfaces a typed error without leaking the key', async () => {
  const f = fakeFetch([
    { status: 429, json: { error: { message: 'slow down' } }, headers: { 'retry-after': '0' } },
    { status: 401, json: { error: { message: 'Incorrect API key provided' } } },
  ]);
  await assert.rejects(new ProviderRegistry(env, f.impl).get('openai').complete(req), (e: any) => {
    assert.ok(e instanceof LLMError);
    assert.equal(e.status, 401);
    assert.ok(!e.message.includes('o-key'));
    return true;
  });
  assert.equal(f.calls.length, 2);
});

test('registry: unconfigured providers are listed but refuse calls; mock is the fallback default', () => {
  const reg = new ProviderRegistry({ DEFAULT_PROVIDER: 'openai' });
  assert.equal(reg.defaultId, 'mock');
  assert.ok(reg.list().every((p) => p.configured === (p.id === 'mock')));
  assert.throws(() => reg.get('openai'), /not configured/);
  assert.throws(() => reg.get('nope'), /Unknown provider/);
  assert.equal(JSON.stringify(new ProviderRegistry(env).list()).includes('key'), false, 'keys never listed');
});
