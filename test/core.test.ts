import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrastRatio, generateScale, normalizeColor, readableOn } from '../src/core/color.ts';
import { completeDesignSystem, parseDesignSystem } from '../src/core/defaults.ts';
import { cssVariableMap, exportDesignSystem, safeCssValue, toCssVariables } from '../src/core/emit.ts';

test('normalizeColor handles hex, rgb, hsl, oklch and named colors', () => {
  assert.equal(normalizeColor('#abc'), '#AABBCC');
  assert.equal(normalizeColor('rgb(124, 58, 237)'), '#7C3AED');
  assert.equal(normalizeColor('rgb(124 58 237 / 50%)'), '#7C3AED80');
  assert.equal(normalizeColor('hsl(0, 100%, 50%)'), '#FF0000');
  assert.equal(normalizeColor('white'), '#FFFFFF');
  assert.equal(normalizeColor('oklch(62.8% 0.2577 29.23)'), '#FF0000');
  assert.equal(normalizeColor('transparent'), null);
  assert.equal(normalizeColor('rgba(0,0,0,0)'), null);
  assert.equal(normalizeColor('var(--x)'), null);
});

test('generateScale keeps the base at 500 and runs light → dark', () => {
  const s = generateScale('#7C3AED');
  assert.equal(s['500'], '#7C3AED');
  const lum = (h: string) => contrastRatio(h, '#000000');
  assert.ok(lum(s['50']) > lum(s['300']) && lum(s['300']) > lum(s['500']) && lum(s['500']) > lum(s['900']));
});

test('readableOn picks the higher-contrast text color', () => {
  assert.equal(readableOn('#111827'), '#FFFFFF');
  assert.equal(readableOn('#FDE68A'), '#111111');
});

test('completeDesignSystem fills every field and derives scales', () => {
  const ds = completeDesignSystem({ color: { roles: { primary: '#0EA5E9' } } });
  assert.equal(ds.version, '1');
  assert.equal(ds.color.roles.primary, '#0EA5E9');
  assert.equal(ds.color.scales.primary['500'], '#0EA5E9');
  assert.ok(ds.typography.scale['4xl'].size > ds.typography.scale.base.size);
  assert.ok(ds.spacing.scale.length > 5);
});

test('parseDesignSystem rejects malformed input and drops unsafe font sources', () => {
  assert.throws(() => parseDesignSystem('nope'), /JSON object/);
  assert.throws(() => parseDesignSystem({ version: '2' }), /Unsupported/);
  assert.throws(() => parseDesignSystem({ color: 5 }), /"color" must be an object/);
  const ds = parseDesignSystem({ typography: { fontSources: ['https://fonts.googleapis.com/css2?family=Inter', 'https://evil.example/x.css'] } });
  assert.deepEqual(ds.typography.fontSources, ['https://fonts.googleapis.com/css2?family=Inter']);
});

test('emitters produce CSS variables, Tailwind and TS; unsafe values never reach CSS', () => {
  assert.equal(safeCssValue('8px'), '8px');
  for (const bad of ['red; } body { display:none', 'url(https://x)', '1px /* x */', 'expression(alert(1))', '</style><script>']) {
    assert.equal(safeCssValue(bad), null, bad);
  }
  const ds = completeDesignSystem({
    meta: { name: 'Acme */ body{}' },
    components: { button: { found: true, count: 1, selectors: [], base: { 'border-radius': '6px', padding: '1px; color: red' }, states: {}, variants: {} } },
  });
  const vars = cssVariableMap(ds);
  assert.equal(vars['--ds-btn-radius'], '6px');
  assert.equal(vars['--ds-btn-padding'], undefined);
  const css = toCssVariables(ds);
  assert.match(css, /--ds-color-primary: #/);
  assert.ok(!css.includes('*/ body'));
  assert.match(exportDesignSystem(ds, 'tailwind').content, /export default/);
  assert.match(exportDesignSystem(ds, 'ts').content, /export const tokens/);
  assert.equal(JSON.parse(exportDesignSystem(ds, 'json').content).version, '1');
});
