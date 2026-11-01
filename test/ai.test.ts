/** AI design-system modes with fake/mock providers — no network, no tokens. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { completeDesignSystem } from '../src/core/defaults.ts';
import { cssVariableMap } from '../src/core/emit.ts';
import { aiCreate, aiExtract, aiToDraft, cssTokenEvidence, parseJsonReply } from '../src/extract/ai.ts';
import { createMockProvider } from '../src/llm/providers/mock.ts';
import type { CompletionRequest, LLMProvider } from '../src/llm/types.ts';

const fake = (reply: unknown, seen: CompletionRequest[] = []): LLMProvider => ({
  id: 'openai', label: 'Fake', defaultModel: 'fake-1', configured: true,
  async complete(req) {
    seen.push(req);
    return { text: typeof reply === 'string' ? reply : JSON.stringify(reply), provider: 'openai', model: 'fake-1', usage: { inputTokens: 100, outputTokens: 50 } };
  },
});

test('parseJsonReply tolerates prose and code fences, rejects garbage', () => {
  assert.deepEqual(parseJsonReply('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJsonReply('no json here'), /did not return/);
  assert.throws(() => parseJsonReply('{"a":'), /did not return|malformed/);
});

test('aiToDraft keeps only values that validate', () => {
  const d = aiToDraft({
    roles: { primary: '#ff0066', background: 'rgba(255,255,255,0.3)', text: 'not a color', border: '#E5E7EB' },
    typeScale: { xs: [12, 1.3, 400], sm: [11, 1.4, 400], base: [16, 1.5, 400], '4xl': [48, 1.1, 800] },
    components: {
      button: { base: { 'border-radius': '999px', padding: 'var(--x)', color: 'red; } body {' }, states: { hover: { opacity: '.9' }, bogus: { a: 'b' } } },
      carousel: { base: { a: 'b' } },
    },
    fonts: { sans: "Inter, sans-serif; } x {", googleFonts: ['Inter', '<script>'] },
    radius: { md: 10, lg: 999 },
    navigation: { type: 'floating' },
  });
  assert.deepEqual(d.roles, { primary: '#FF0066', border: '#E5E7EB' }, 'translucent and invalid colors dropped');
  assert.deepEqual(Object.keys(d.scale), ['xs', 'base', '4xl'], 'non-increasing step dropped');
  assert.deepEqual(d.components.button?.base, { 'border-radius': '999px' }, 'var() and injection dropped');
  assert.deepEqual(Object.keys(d.components.button!.states), ['hover']);
  assert.equal(d.components['carousel' as 'button'], undefined, 'unknown component types ignored');
  assert.ok(!d.families.sans?.includes('{'));
  assert.equal(d.fontSources[0], 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  assert.deepEqual(d.radius, { md: 10 });
  assert.equal(d.navigation, undefined);
});

test('aiExtract merges validated AI corrections over the rule-based draft', async () => {
  const base = completeDesignSystem({
    meta: { name: 'Draft', source: { type: 'url', ref: 'https://x.example', extractedAt: '' }, confidence: 0.6, notes: ['rule note'] },
    color: { roles: { primary: '#FFFFFF', background: '#FFFFFF' }, palette: [{ value: '#0F1014', count: 9, usage: ['background'] }] },
    components: { button: { found: true, count: 3, selectors: ['.btn'], base: { padding: '12px 20px' }, states: {}, variants: {} } },
  });
  const seen: CompletionRequest[] = [];
  const out = await aiExtract(base, fake({
    name: 'Streamly', roles: { primary: '#1492FF', background: '#0F1014', text: '#E1E6F0' },
    components: { button: { base: { 'border-radius': '8px' }, states: { hover: { 'background-color': '#0860C4' } } } },
    notes: ['Primary taken from brand tokens'],
  }, seen), { cssTokens: [['--brand', '#1492FF']] });
  const ds = out.ds;
  assert.equal(ds.meta.name, 'Streamly');
  assert.equal(ds.color.roles.primary, '#1492FF');
  assert.equal(ds.color.roles.background, '#0F1014');
  assert.equal(ds.color.scales.primary['500'], '#1492FF', 'scale regenerated for the changed role');
  assert.deepEqual(ds.components.button?.base, { padding: '12px 20px', 'border-radius': '8px' });
  assert.equal(ds.components.button?.count, 3, 'evidence counts preserved');
  assert.equal(ds.meta.confidence, 0.6);
  assert.ok(ds.meta.notes.includes('rule note') && ds.meta.notes.some((n) => /AI-assisted/.test(n)));
  assert.equal(cssVariableMap(ds)['--ds-btn-radius'], '8px');
  const sent = seen[0].messages[0].content;
  assert.match(sent, /--brand: #1492FF/);
  assert.ok(sent.length < 12_000, `evidence pack is ${sent.length} chars`);
});

test('aiCreate builds a complete system from a brief (mock provider)', async () => {
  const { ds, usage } = await aiCreate('Calm fintech app, dark theme, rounded friendly buttons', createMockProvider(), { name: 'Ledger' });
  assert.equal(ds.meta.name, 'Ledger');
  assert.equal(ds.meta.source.type, 'ai');
  assert.equal(ds.color.roles.background, '#0B0D12');
  assert.equal(ds.components.button?.base['border-radius'], '999px');
  assert.ok(usage.inputTokens > 0);
  await assert.rejects(aiCreate('short', createMockProvider()), /sentence or two/);
  await assert.rejects(aiCreate('A proper brief for a brand', fake('I cannot help with that')), /did not return/);
  await assert.rejects(aiCreate('A proper brief for a brand', fake({ roles: {} })), /usable colors/);
});

test('cssTokenEvidence lists the site’s own tokens, root first, ignoring dark overrides', () => {
  const css = readFileSync(new URL('./fixtures/site/styles.css', import.meta.url), 'utf8');
  const tokens = cssTokenEvidence({ css: [{ href: 'x', text: css }] });
  const names = tokens.map(([k]) => k);
  assert.equal(names[0], '--brand-primary');
  assert.ok(tokens.some(([k, v]) => k === '--color-bg' && v === '#FFFFFF'), 'light value, not the .dark override');
});
