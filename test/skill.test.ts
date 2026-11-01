/** Keeps the portable skill consistent with the engine it documents. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { completeDesignSystem } from '../src/core/defaults.ts';
import { COLOR_ROLES, TYPE_STEPS } from '../src/core/schema.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SKILL = 'skill/design-system-prototyper';

test('SKILL.md has valid front-matter', () => {
  const md = read(`${SKILL}/SKILL.md`);
  const fm = md.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
  assert.ok(fm, 'front-matter with name and description');
  assert.equal(fm![1], 'design-system-prototyper');
  assert.ok(fm![2].length > 50 && fm![2].length <= 1024);
  for (const ref of md.matchAll(/`(references\/[\w-]+\.md|schema\/[\w.-]+|assets\/[\w.-]+|PORTABILITY\.md)`/g)) {
    assert.doesNotThrow(() => read(`${SKILL}/${ref[1]}`), `${ref[1]} exists`);
  }
});

test('bundled components.css matches the source (run npm run skill:sync)', () => {
  assert.equal(read(`${SKILL}/assets/components.css`), read('src/styles/components.css'));
});

test('JSON schema required keys match what the engine produces', () => {
  const schema = JSON.parse(read(`${SKILL}/schema/design-system.schema.json`));
  const ds = completeDesignSystem({});
  assert.deepEqual([...schema.required].sort(), Object.keys(ds).sort());
  assert.deepEqual([...schema.properties.color.properties.roles.required].sort(), [...COLOR_ROLES].sort());
  assert.deepEqual([...schema.properties.typography.properties.scale.required].sort(), [...TYPE_STEPS].sort());
  assert.deepEqual([...schema.properties.typography.required].sort(), Object.keys(ds.typography).sort());
  const hex = new RegExp(schema.$defs.hex.pattern);
  for (const v of Object.values(ds.color.roles)) assert.match(v, hex);
});
