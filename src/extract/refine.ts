/**
 * Optional single LLM pass over heuristic results. Sends aggregated stats only
 * (roles, top palette, fonts — a few hundred tokens), never the page itself,
 * and only applies values that validate.
 */

import { normalizeColor, readableOn } from '../core/color.ts';
import { completeDesignSystem } from '../core/defaults.ts';
import { COLOR_ROLES, type ColorRole, type DesignSystem } from '../core/schema.ts';
import type { CompletionResult, LLMProvider } from '../llm/types.ts';

const SYSTEM = `You review design tokens extracted automatically from a website or Figma file and correct the semantic color roles.
Reply with ONE JSON object and nothing else: {"name": string, "roles": {<role>: "#RRGGBB"}, "notes": [string]}.
Only include roles you would change. Valid roles: ${COLOR_ROLES.join(', ')}. Choose colors from the palette provided; keep text/background contrast >= 4.5.`;

export async function refineWithLLM(ds: DesignSystem, provider: LLMProvider, model?: string): Promise<{ ds: DesignSystem; usage: CompletionResult['usage'] }> {
  const brief = {
    name: ds.meta.name,
    source: ds.meta.source.ref,
    roles: ds.color.roles,
    palette: ds.color.palette.slice(0, 16).map((p) => `${p.value} x${p.count} ${p.usage.join('/')}`),
    fonts: ds.typography.families,
    components: Object.fromEntries(Object.entries(ds.components).map(([k, c]) => [k, c?.base['background-color'] ?? c?.base.background ?? null])),
  };
  const res = await provider.complete({ system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(brief) }], model, maxTokens: 2000, json: true, reasoning: 'minimal' });
  const json = res.text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('The model did not return JSON');
  let parsed: any;
  try { parsed = JSON.parse(json); } catch { throw new Error('The model returned invalid JSON'); }

  const roles = { ...ds.color.roles };
  const changed: string[] = [];
  for (const [role, value] of Object.entries(parsed.roles ?? {})) {
    if (!(COLOR_ROLES as readonly string[]).includes(role) || typeof value !== 'string') continue;
    const hex = normalizeColor(value)?.slice(0, 7);
    if (hex && hex !== roles[role as ColorRole]) { roles[role as ColorRole] = hex; changed.push(role); }
  }
  if (changed.includes('primary') && !changed.includes('onPrimary')) roles.onPrimary = readableOn(roles.primary);
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 80) : ds.meta.name;
  const notes = [...ds.meta.notes, ...(Array.isArray(parsed.notes) ? parsed.notes.filter((n: unknown) => typeof n === 'string').slice(0, 3) : []),
    changed.length ? `AI refinement changed: ${changed.join(', ')}.` : 'AI refinement made no changes.'];
  // Regenerate scales for changed roles.
  const scales = { ...ds.color.scales };
  if (changed.includes('primary')) delete scales.primary;
  if (changed.includes('secondary')) delete scales.secondary;
  if (changed.includes('accent')) delete scales.accent;
  return { ds: completeDesignSystem({ ...ds, meta: { ...ds.meta, name, notes }, color: { ...ds.color, roles, scales } }), usage: res.usage };
}
