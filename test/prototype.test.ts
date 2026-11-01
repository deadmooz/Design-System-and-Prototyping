import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { completeDesignSystem } from '../src/core/defaults.ts';
import { createMockProvider } from '../src/llm/providers/mock.ts';
import { generate } from '../src/prototype/generate.ts';
import { buildSystemPrompt, buildUserMessage } from '../src/prototype/prompts.ts';
import { renderComponentGallery, renderDocument } from '../src/prototype/render.ts';
import { cleanModelOutput, extractHtml, sanitizeBody } from '../src/prototype/sanitize.ts';

const ds = completeDesignSystem({ meta: { name: 'Test DS' }, color: { roles: { primary: '#7C3AED' } } });
const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

test('system prompt is compact and stable; user turn carries only what changes', () => {
  const sys = buildSystemPrompt(ds);
  assert.equal(sys, buildSystemPrompt(ds), 'deterministic → cacheable');
  assert.match(sys, /primary #7C3AED/);
  assert.ok(sys.length < 6000, `system prompt is ${sys.length} chars`);
  const msg = buildUserMessage({
    kind: 'page', instruction: 'Add pricing', pages: [{ id: 'home', name: 'Home' }, { id: 'pricing', name: 'Pricing' }],
    page: { id: 'home', name: 'Home', html: '<main>hi</main>' }, history: ['a', 'b', 'c', 'd'],
  });
  assert.match(msg, /PAGES: home="Home", pricing="Pricing"/);
  assert.match(msg, /CURRENT HTML:\n```html\n<main>hi<\/main>/);
  assert.ok(!msg.includes('- a\n'), 'only the last 3 history items');
  assert.match(msg, /INSTRUCTION: Add pricing$/);
});

test('oversized pages are rejected instead of silently truncated', () => {
  assert.throws(() => buildUserMessage({ kind: 'page', instruction: 'x', pages: [], page: { id: 'a', name: 'A', html: 'x'.repeat(50_000) } }), /too large/);
});

test('model output is unwrapped and sanitized', () => {
  assert.equal(extractHtml('Sure!\n```html\n<html><head><title>x</title></head><body><p>a</p></body></html>\n```'), '<p>a</p>');
  const dirty = '<script src="https://evil/x.js"></script><link rel=stylesheet href=x><iframe src="https://x"></iframe><a href="javascript:alert(1)">x</a><style>@import url(x);.a{}</style><script>ok()</script>';
  const clean = sanitizeBody(dirty);
  assert.ok(!/evil|<link|<iframe|javascript:|@import/.test(clean), clean);
  assert.match(clean, /<script>ok\(\)<\/script>/, 'inline scripts stay (they run sandboxed)');
  assert.throws(() => cleanModelOutput('```html\n\n```'), /no HTML/);
});

test('generate() with the offline mock provider creates and edits pages', async () => {
  const mock = createMockProvider();
  const pages = [{ id: 'home', name: 'Home', html: '' }, { id: 'pricing', name: 'Pricing', html: '' }];
  const created = await generate(mock, { ds, kind: 'page', instruction: 'pricing page with contact form', pages, page: pages[1] });
  assert.match(created.html, /ds-btn/);
  assert.match(created.html, /href="#\/home"/);
  assert.match(created.html, /Get in touch/);
  assert.ok(created.usage.inputTokens > 0);
  const edited = await generate(mock, { ds, kind: 'page', instruction: 'add a banner', pages, page: { ...pages[1], html: created.html } });
  assert.match(edited.html, /Mock edit:<\/strong> add a banner/);
  assert.ok(edited.html.indexOf('Mock edit') < edited.html.indexOf('<footer'));
});

test('rendered documents carry tokens, CSP and routing', () => {
  const pages = [{ id: 'home', name: 'Home', html: '<a href="#/about">About</a>' }, { id: 'about', name: 'About', html: '<p>About</p>' }];
  const preview = renderDocument({ ds, pages, pageId: 'about', componentsCss: css, mode: 'preview' });
  assert.match(preview, /Content-Security-Policy" content="default-src 'none'.*connect-src 'none'/);
  assert.match(preview, /--ds-color-primary: #7C3AED/);
  assert.match(preview, /<p>About<\/p>/);
  assert.match(preview, /dsp:navigate/);
  const exported = renderDocument({ ds, pages, componentsCss: css, mode: 'export' });
  assert.match(exported, /<template data-page="home">/);
  assert.match(exported, /<template data-page="about">/);
  assert.match(exported, /hashchange/);
  assert.match(renderComponentGallery(ds, css), /ds-modal__title/);
});
