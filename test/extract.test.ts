import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contrastRatio } from '../src/core/color.ts';
import { cssVariableMap } from '../src/core/emit.ts';
import { analyzeFigma } from '../src/extract/figma/analyze.ts';
import { parseFigmaUrl } from '../src/extract/figma/client.ts';
import { parseCss, toPx } from '../src/extract/web/css.ts';
import { analyzeWebsite } from '../src/extract/web/analyze.ts';
import { ExtractionError, robotsAllows, safeFetch } from '../src/extract/web/fetch.ts';

const fixture = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');

test('parseCss handles comments, media, nesting, font-face and imports', () => {
  const p = parseCss(`@import url("a.css"); /* { */ a{color:red} @media (min-width: 768px){ .x{margin:4px;padding:var(--p, 2px)} }
    @font-face{font-family:Foo;src:url(x.woff2)} .p{color:blue; &:hover{color:green}} @keyframes k{from{opacity:0}}`);
  assert.deepEqual(p.imports, ['a.css']);
  assert.equal(p.mediaQueries[0], '(min-width: 768px)');
  assert.equal(p.rules.find((r) => r.selector === '.x')?.media, '(min-width: 768px)');
  assert.equal(p.fontFaces[0]['font-family'], 'Foo');
  assert.ok(p.rules.some((r) => r.selector === '.p:hover'));
  assert.equal(p.keyframes, 1);
});

test('toPx converts units and clamp()', () => {
  assert.equal(toPx('1.5rem'), 24);
  assert.equal(toPx('12px'), 12);
  assert.equal(toPx('clamp(1rem, 2vw, 3rem)'), 48);
  assert.equal(toPx('50%'), null);
});

test('website analyzer recovers the fixture design system', () => {
  const ds = analyzeWebsite({
    url: 'https://lumen.example/',
    html: fixture('site/index.html'),
    css: [{ href: 'https://lumen.example/styles.css', text: fixture('site/styles.css') }],
  });
  const r = ds.color.roles;
  assert.equal(ds.meta.name, 'Lumen Labs');
  assert.equal(r.primary, '#7C3AED');
  assert.equal(r.onPrimary, '#FFFFFF');
  assert.equal(r.secondary, '#0EA5E9');
  assert.equal(r.text, '#1F2937');
  assert.equal(r.textMuted, '#6B7280');
  assert.equal(r.background, '#FFFFFF', 'dark-theme overrides must not win');
  assert.equal(r.border, '#E5E7EB');
  assert.equal(r.success, '#16A34A');
  assert.equal(r.error, '#DC2626');
  assert.match(ds.typography.families.sans, /^Inter/);
  assert.deepEqual(ds.typography.fontSources, ['https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap']);
  assert.equal(ds.typography.scale.base.size, 16);
  assert.equal(ds.typography.scale['4xl'].size, 48, 'unconditional h1 rule wins over the media-query clamp()');
  assert.equal(ds.typography.scale['3xl'].size, 36);
  assert.equal(ds.radius.md, 10);
  assert.equal(ds.layout.maxWidth, 1200);
  assert.deepEqual(ds.breakpoints, { sm: 640, md: 768, lg: 1024, xl: 1280 });
  assert.equal(ds.shadow.md, '0 4px 12px rgba(0, 0, 0, 0.08)');

  const btn = ds.components.button!;
  assert.equal(btn.base['border-radius'], '10px');
  assert.equal(btn.base.padding, '12px 20px');
  assert.equal(btn.variants.primary['background-color'], '#7C3AED');
  assert.equal(btn.states.hover?.['background-color'], '#6D28D9');
  assert.ok(btn.variants.outline);
  assert.equal(ds.components.card?.base['border-radius'], '16px');
  assert.equal(ds.components.input?.base['border-radius'], '8px');
  assert.ok(ds.components.badge?.found);

  const nav = ds.patterns.navigation;
  assert.equal(nav.type, 'topbar');
  assert.ok(nav.sticky && nav.hasMobileMenu && nav.hasSearch);
  assert.ok(nav.items.includes('Pricing'));
  assert.ok(ds.meta.confidence >= 0.75);
});

test('dark sites: translucent and component-scoped tokens never become site roles; loaded web fonts win', () => {
  const css = `
    @font-face { font-family: "Inter"; src: url(/inter.woff2) }
    html { font-family: system-ui, -apple-system, sans-serif }
    .tokens { --translucent-hover-bg: hsla(0,0%,100%,.3); --tooltip-bg: #FFFFFF; --pay-text-color: #252833;
      --on-surface-default: #E1E6F0; --background-surface-default: #16181F; --border-default: #202228; --text-on-brand-default: #fff; }
    .page { background-color: #0F1014; color: var(--on-surface-default); font-family: var(--app-font, "Inter", sans-serif) }
    .shell, .main, .grid, .row { background: #0F1014 }
    .tile { background: #16181F; color: #E1E6F0 }
    .cta { background-color: #FAB132; color: #0F1014; padding: 0; height: 100% }
    .cta, .btn-x { padding: 12px 24px }`;
  const ds = analyzeWebsite({ url: 'https://dark.example/', html: '<html><body><div class="page"></div></body></html>', css: [{ href: 'https://dark.example/a.css', text: css }] });
  const r = ds.color.roles;
  assert.equal(r.background, '#0F1014');
  assert.equal(r.text, '#E1E6F0', '"on-surface" names a text color');
  assert.equal(r.surface, '#16181F');
  assert.equal(r.border, '#202228');
  assert.notEqual(r.background, '#FFFFFF', 'translucent / tooltip tokens ignored');
  assert.ok(contrastRatio(r.onPrimary, r.primary) >= 2, 'label color readable on primary');
  assert.match(ds.typography.families.sans, /^'?Inter/);
  assert.match(ds.typography.fontSources[0], /family=Inter/);
  assert.equal(cssVariableMap(ds)['--ds-btn-height'], undefined, 'reset values are not emitted');
});

test('website analyzer degrades gracefully on empty input', () => {
  const ds = analyzeWebsite({ url: 'https://empty.example/', html: '<html><body></body></html>', css: [] });
  assert.equal(ds.version, '1');
  assert.ok(ds.meta.confidence < 0.3);
  assert.ok(ds.meta.notes.some((n) => /No stylesheets/.test(n)));
});

test('figma analyzer reads styles, text, layout and component sets', () => {
  const ds = analyzeFigma({ file: JSON.parse(fixture('figma-file.json')), variables: null }, 'https://www.figma.com/design/abc/Orbit');
  assert.equal(ds.meta.name, 'Orbit UI Kit');
  assert.equal(ds.meta.source.type, 'figma');
  assert.equal(ds.color.roles.primary, '#10B981', '"Brand/Primary" style');
  assert.equal(ds.color.roles.text, '#121726', '"Text/Primary" is text, not brand');
  assert.equal(ds.color.roles.onPrimary, '#FFFFFF');
  assert.ok(!ds.color.palette.some((p) => p.value === '#FF0000'), 'hidden layers are ignored');
  assert.match(ds.typography.families.sans, /Manrope/);
  assert.equal(ds.typography.scale['4xl'].size, 44);
  assert.equal(ds.typography.scale.base.size, 16);
  const sizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'].map((s) => ds.typography.scale[s as 'xs'].size);
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes, 'type scale increases');
  assert.ok(ds.spacing.scale.includes(24) && ds.spacing.scale.includes(32));
  const btn = ds.components.button!;
  assert.equal(btn.base['background-color'], '#10B981');
  assert.equal(btn.base.padding, '10px 18px');
  assert.equal(btn.states.hover?.['background-color'], '#059669');
  assert.ok(btn.variants.secondary);
  assert.equal(ds.components.input?.base['border-radius'], '6px');
});

test('figma analyzer prefers Variables API names when present', () => {
  const file = JSON.parse(fixture('figma-file.json'));
  const variables = { meta: { variableCollections: { c: { defaultModeId: 'm' } }, variables: {
    v1: { name: 'color/primary', resolvedType: 'COLOR', variableCollectionId: 'c', valuesByMode: { m: { r: 1, g: 0.4, b: 0, a: 1 } } },
    v2: { name: 'radius/md', resolvedType: 'FLOAT', variableCollectionId: 'c', valuesByMode: { m: 14 } },
  } } };
  const ds = analyzeFigma({ file, variables }, 'x');
  assert.equal(ds.color.roles.primary, '#FF6600');
});

test('parseFigmaUrl extracts file key, branch and node id', () => {
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/AbC123def456/Kit?node-id=12-34'), { fileKey: 'AbC123def456', nodeId: '12:34' });
  assert.equal(parseFigmaUrl('https://www.figma.com/file/AbC123def456/branch/Br4nchKey99/Kit').fileKey, 'Br4nchKey99');
  assert.equal(parseFigmaUrl('AbC123def456').fileKey, 'AbC123def456');
  assert.throws(() => parseFigmaUrl('https://evil.example/design/abc'), ExtractionError);
});

test('robots.txt evaluation', () => {
  const txt = 'User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: OtherBot\nDisallow: /';
  assert.equal(robotsAllows(txt, '/'), true);
  assert.equal(robotsAllows(txt, '/private/x'), false);
  assert.equal(robotsAllows(txt, '/private/ok/page'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/anything'), false);
  assert.equal(robotsAllows('', '/x'), true);
});

test('safeFetch blocks private networks and non-http schemes (SSRF guard)', async () => {
  for (const url of ['http://127.0.0.1/', 'http://localhost:4310/api', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'file:///etc/passwd', 'http://user:pw@example.com/']) {
    await assert.rejects(safeFetch(url), ExtractionError, url);
  }
});
