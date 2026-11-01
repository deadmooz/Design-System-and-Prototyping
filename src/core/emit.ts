/** Turns a DesignSystem into consumable code: CSS variables, Tailwind config, TS tokens. */

import { COLOR_ROLES, TYPE_STEPS, type ComponentType, type DesignSystem } from './schema.ts';

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/** Values may come from arbitrary websites; never let them break out of a declaration. */
export function safeCssValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.length > 200 || /[;{}<>]|\/\*|!important|expression\(|url\(|javascript:/i.test(s)) return null;
  return s;
}

/** Maps observed component CSS to the component-level variables components.css reads. */
const COMPONENT_VARS: Partial<Record<ComponentType, Record<string, string>>> = {
  button: {
    'border-radius': 'btn-radius', padding: 'btn-padding', 'font-weight': 'btn-weight', 'font-size': 'btn-font-size',
    'text-transform': 'btn-transform', 'letter-spacing': 'btn-tracking', 'box-shadow': 'btn-shadow', 'min-height': 'btn-height',
  },
  input: {
    'border-radius': 'input-radius', padding: 'input-padding', 'border-width': 'input-border-width',
    'font-size': 'input-font-size', 'min-height': 'input-height', height: 'input-height',
  },
  card: { 'border-radius': 'card-radius', padding: 'card-padding', 'box-shadow': 'card-shadow', 'border-width': 'card-border-width' },
  badge: { 'border-radius': 'badge-radius', padding: 'badge-padding', 'font-size': 'badge-font-size', 'font-weight': 'badge-weight', 'text-transform': 'badge-transform' },
  link: { 'text-decoration': 'link-decoration', 'font-weight': 'link-weight' },
  nav: { height: 'nav-height', 'min-height': 'nav-height', 'box-shadow': 'nav-shadow' },
  modal: { 'border-radius': 'modal-radius', padding: 'modal-padding', 'box-shadow': 'modal-shadow' },
};

/** Reset-style values (`padding: 0`, `height: 100%`, `font-size: inherit`) say nothing about the component's look. */
function meaningful(prop: string, val: string): boolean {
  if (/^(inherit|initial|unset|revert|auto|normal)$/.test(val)) return false;
  if (/padding|height/.test(prop) && /^0(px|rem|em)?(\s+0(px|rem|em)?)*$/.test(val)) return false;
  if (/font-size|height/.test(prop) && /%|^[\d.]+em$/.test(val)) return false;
  if (prop === 'box-shadow' && /inset/.test(val)) return false; // inset shadows draw outlines (outline buttons), not elevation
  return true;
}

export function cssVariableMap(ds: DesignSystem): Record<string, string> {
  const v: Record<string, string> = {};
  for (const role of COLOR_ROLES) v[`--ds-color-${kebab(role)}`] = ds.color.roles[role];
  for (const [name, scale] of Object.entries(ds.color.scales)) {
    for (const [step, hex] of Object.entries(scale)) v[`--ds-${kebab(name)}-${step}`] = hex;
  }
  const fam = ds.typography.families;
  v['--ds-font-sans'] = safeFamily(fam.sans);
  v['--ds-font-heading'] = safeFamily(fam.heading);
  v['--ds-font-mono'] = safeFamily(fam.mono);
  for (const step of TYPE_STEPS) {
    const t = ds.typography.scale[step];
    v[`--ds-text-${step}`] = `${t.size}px`;
    v[`--ds-leading-${step}`] = String(t.lineHeight);
    v[`--ds-weight-${step}`] = String(t.weight);
  }
  ds.spacing.scale.forEach((px, i) => (v[`--ds-space-${i}`] = `${px}px`));
  for (const [k, px] of Object.entries(ds.radius)) v[`--ds-radius-${k}`] = `${px}px`;
  for (const [k, s] of Object.entries(ds.shadow)) { const c = safeCssValue(s); if (c) v[`--ds-shadow-${k}`] = c; }
  v['--ds-max-width'] = `${ds.layout.maxWidth}px`;
  v['--ds-gutter'] = `${ds.layout.gutter}px`;

  for (const [type, props] of Object.entries(COMPONENT_VARS) as [ComponentType, Record<string, string>][]) {
    const spec = ds.components[type];
    if (!spec?.found) continue;
    // The primary variant is the component's canonical look; the merged base can mix values from many selectors.
    const main = { ...spec.base, ...(spec.variants.primary ?? spec.variants.default ?? spec.variants.solid ?? spec.variants.filled ?? {}) };
    for (const [prop, name] of Object.entries(props)) {
      const val = safeCssValue(main[prop]);
      if (val && !val.includes('var(') && meaningful(prop, val)) v[`--ds-${name}`] = val;
    }
  }
  return v;
}

function safeFamily(f: string): string {
  return f.replace(/[;{}<>\\]/g, '').slice(0, 200);
}

export function toCssVariables(ds: DesignSystem, selector = ':root'): string {
  const lines = Object.entries(cssVariableMap(ds)).map(([k, val]) => `  ${k}: ${val};`);
  return `/* ${ds.meta.name.replace(/\*\//g, '')} — generated design tokens */\n${selector} {\n${lines.join('\n')}\n}\n`;
}

export function toTailwindConfig(ds: DesignSystem): string {
  const colors: Record<string, unknown> = { ...ds.color.scales };
  for (const role of COLOR_ROLES) colors[kebab(role)] = ds.color.roles[role];
  const fontSize = Object.fromEntries(TYPE_STEPS.map((s) => {
    const t = ds.typography.scale[s];
    return [s, [`${t.size}px`, { lineHeight: String(t.lineHeight), fontWeight: String(t.weight) }]];
  }));
  const theme = {
    extend: {
      colors,
      fontFamily: {
        sans: [ds.typography.families.sans], heading: [ds.typography.families.heading], mono: [ds.typography.families.mono],
      },
      fontSize,
      spacing: Object.fromEntries(ds.spacing.scale.map((px, i) => [String(i), `${px}px`])),
      borderRadius: Object.fromEntries(Object.entries(ds.radius).map(([k, px]) => [k, `${px}px`])),
      boxShadow: ds.shadow,
      maxWidth: { content: `${ds.layout.maxWidth}px` },
    },
    screens: Object.fromEntries(Object.entries(ds.breakpoints).map(([k, px]) => [k, `${px}px`])),
  };
  return `/** @type {import('tailwindcss').Config} — generated from "${ds.meta.name.replace(/"/g, '')}" */\nexport default ${JSON.stringify({ theme }, null, 2)};\n`;
}

export function toTypeScript(ds: DesignSystem): string {
  const { color, typography, spacing, radius, shadow, breakpoints, layout } = ds;
  const tokens = { color: { ...color.roles, scales: color.scales }, typography, spacing, radius, shadow, breakpoints, layout };
  return `// Generated from "${ds.meta.name.replace(/"/g, '')}"\nexport const tokens = ${JSON.stringify(tokens, null, 2)} as const;\nexport default tokens;\n`;
}

export type ExportFormat = 'json' | 'css' | 'tailwind' | 'ts';

export function exportDesignSystem(ds: DesignSystem, format: ExportFormat): { filename: string; content: string } {
  const slug = ds.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design-system';
  switch (format) {
    case 'css': return { filename: `${slug}.tokens.css`, content: toCssVariables(ds) };
    case 'tailwind': return { filename: `tailwind.config.js`, content: toTailwindConfig(ds) };
    case 'ts': return { filename: `${slug}.tokens.ts`, content: toTypeScript(ds) };
    default: return { filename: `${slug}.design-system.json`, content: JSON.stringify(ds, null, 2) };
  }
}
