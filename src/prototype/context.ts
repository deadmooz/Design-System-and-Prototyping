/**
 * Compact, LLM-facing description of a design system. Only what changes the
 * markup the model writes goes in — no palette dumps or full scales — so a
 * typical summary is ~300 tokens and stays identical across iterations
 * (provider prompt caches hit on every follow-up edit).
 */

import { COLOR_ROLES, TYPE_STEPS, type DesignSystem } from '../core/schema.ts';

const firstFamily = (stack: string) => stack.split(',')[0].replace(/['"]/g, '').trim();

export function summarizeDesignSystem(ds: DesignSystem): string {
  const r = ds.color.roles;
  const lines = [
    `Design system: ${ds.meta.name}`,
    `Colors: ${COLOR_ROLES.map((k) => `${k} ${r[k]}`).join(', ')}`,
    `Fonts: body ${firstFamily(ds.typography.families.sans)}, headings ${firstFamily(ds.typography.families.heading)}`,
    `Type (px/line-height/weight): ${TYPE_STEPS.map((s) => { const t = ds.typography.scale[s]; return `${s} ${t.size}/${t.lineHeight}/${t.weight}`; }).join(', ')}`,
    `Spacing scale px (index = --ds-space-N): ${ds.spacing.scale.join(' ')}`,
    `Radius px: ${Object.entries(ds.radius).filter(([k]) => k !== 'none').map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `Layout: max-width ${ds.layout.maxWidth}px, gutter ${ds.layout.gutter}px, breakpoints ${Object.values(ds.breakpoints).join('/')}`,
  ];
  const comp = Object.entries(ds.components)
    .filter(([, c]) => c?.found && Object.keys(c.base).length)
    .map(([name, c]) => {
      const keep = ['border-radius', 'padding', 'font-weight', 'text-transform', 'box-shadow', 'border'];
      const props = keep.filter((p) => c!.base[p]).map((p) => `${p}: ${c!.base[p]}`).join('; ');
      const variants = Object.keys(c!.variants).slice(0, 5).join('/');
      return props ? `${name}{${props}}${variants ? ` variants ${variants}` : ''}` : '';
    })
    .filter(Boolean);
  if (comp.length) lines.push(`Reference component styling: ${comp.join(' | ')}`);
  const nav = ds.patterns.navigation;
  if (nav.type !== 'unknown') lines.push(`Navigation: ${nav.type}${nav.sticky ? ', sticky' : ''}${nav.hasMobileMenu ? ', mobile menu' : ''}${nav.hasSearch ? ', search' : ''}`);
  if (ds.patterns.interactions.length) lines.push(`Interaction patterns seen: ${ds.patterns.interactions.slice(0, 6).join(', ')}`);
  return lines.join('\n');
}
