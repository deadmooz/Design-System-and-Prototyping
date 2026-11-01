/**
 * AI design-system builder. Two modes:
 *  - extract: rule-based results + a compact evidence pack (palette counts, the
 *    site's own custom properties, fonts, component CSS) → the model returns a
 *    complete, coherent system. The page itself is never sent.
 *  - create:  a written brief → a new system from scratch.
 * Output is untrusted: every value is validated before it is merged.
 */

import { normalizeColor } from '../core/color.ts';
import { completeDesignSystem, isAllowedFontSource } from '../core/defaults.ts';
import { safeCssValue } from '../core/emit.ts';
import {
  COLOR_ROLES, COMPONENT_TYPES, TYPE_STEPS,
  type ColorRole, type ComponentSpec, type ComponentState, type ComponentType, type DesignSystem, type TypeStep, type TypeStyle,
} from '../core/schema.ts';
import type { CompletionResult, LLMProvider } from '../llm/types.ts';
import { parseCss } from './web/css.ts';
import type { WebSource } from './web/analyze.ts';

const OUTPUT_SHAPE = `{
 "name": string, "description": string,
 "roles": {${COLOR_ROLES.map((r) => `"${r}"`).join(',')}: "#RRGGBB"},
 "fonts": {"sans": css font stack, "heading": css font stack, "mono": css font stack, "googleFonts": [family names available on Google Fonts]},
 "typeScale": {"xs"|"sm"|"base"|"lg"|"xl"|"2xl"|"3xl"|"4xl": [sizePx, lineHeight, weight]},
 "spacing": {"base": px, "scale": [px ascending, starting 0]},
 "radius": {"sm": px, "md": px, "lg": px, "xl": px},
 "shadow": {"sm": css box-shadow, "md": ..., "lg": ...},
 "breakpoints": {"sm": px, "md": px, "lg": px, "xl": px},
 "layout": {"maxWidth": px, "gutter": px},
 "components": {"button"|"input"|"card"|"badge"|"link"|"nav"|"modal"|"avatar": {"base": {css-property: value}, "states": {"hover"|"focus"|"active"|"disabled": {...}}, "variants": {name: {...}}}},
 "navigation": {"type": "topbar"|"sidebar"|"none", "sticky": bool, "hasMobileMenu": bool, "hasSearch": bool},
 "interactions": [short strings],
 "notes": [short strings: assumptions and uncertainties]
}`;

const RULES = `Rules: reply with ONE JSON object only (no prose, no code fence). Colors are opaque #RRGGBB.
Text on background and onPrimary on primary need contrast >= 4.5. Type scale strictly increases. Spacing ascending.
Component CSS uses plain values (px/rem/hex), never var(). Keep it to the components that matter.`;

const EXTRACT_SYSTEM = `You are a senior design-systems engineer. You receive machine-measured evidence from a reference website or Figma file plus a rule-based first draft. Produce the reference's real design system: choose the true brand colors and semantic roles (the draft can be wrong — e.g. it may confuse overlays, component-specific tokens, or light/dark themes), coherent type/spacing/radius scales, and component specs with states and variants. Prefer values that appear in the evidence; do not invent brand colors that are absent.
${RULES}
Output shape:
${OUTPUT_SHAPE}`;

const CREATE_SYSTEM = `You are a senior brand and design-systems designer. Create an original, production-quality design system from the user's brief: accessible color roles, a harmonious type scale, a 4px or 8px spacing scale, radii, shadows and component specs (button with primary/secondary/outline variants and hover/focus/disabled states, input with focus/error, card, badge, nav). Do not imitate a specific existing company's brand.
${RULES}
Output shape:
${OUTPUT_SHAPE}`;

export interface AiOptions {
  model?: string;
  signal?: AbortSignal;
}

export interface AiResult {
  ds: DesignSystem;
  usage: CompletionResult['usage'];
  provider: string;
  model: string;
}

// ------------------------------------------------------------- evidence ---

/** The site's own custom properties (colors and lengths), root-level first, capped for token cost. */
export function cssTokenEvidence(src: Pick<WebSource, 'css'>, max = 80): [string, string][] {
  const seen = new Map<string, { v: string; root: boolean }>();
  for (const sheet of src.css) {
    for (const r of parseCss(sheet.text).rules) {
      if (/dark/i.test(r.selector) || /dark/.test(r.media ?? '')) continue;
      const root = /(^|,)\s*(:root|html|body)\s*(,|$)/i.test(r.selector);
      for (const [k, v] of r.decls) {
        if (!k.startsWith('--') || k.length > 48 || v.length > 60) continue;
        if (!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|^\d+(\.\d+)?(px|rem)$|var\(/i.test(v)) continue;
        if (!seen.has(k) || (root && !seen.get(k)!.root)) seen.set(k, { v, root });
      }
    }
  }
  return [...seen].sort((a, b) => Number(b[1].root) - Number(a[1].root)).slice(0, max).map(([k, { v }]) => [k, v]);
}

function evidencePack(ds: DesignSystem, tokens: [string, string][]): string {
  const trim = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).slice(0, 12));
  const components = Object.fromEntries(Object.entries(ds.components).filter(([, c]) => c?.found).map(([k, c]) => [k, {
    count: c!.count,
    base: trim(c!.base),
    states: Object.fromEntries(Object.entries(c!.states).map(([s, v]) => [s, trim(v!)])),
    variants: Object.fromEntries(Object.entries(c!.variants).slice(0, 5).map(([n, v]) => [n, trim(v)])),
  }]));
  return JSON.stringify({
    source: ds.meta.source.ref,
    title: ds.meta.name,
    description: ds.meta.description,
    draft: {
      roles: ds.color.roles,
      fonts: ds.typography.families,
      typeScale: Object.fromEntries(TYPE_STEPS.map((s) => { const t = ds.typography.scale[s]; return [s, [t.size, t.lineHeight, t.weight]]; })),
      spacing: ds.spacing, radius: ds.radius, shadow: ds.shadow, breakpoints: ds.breakpoints, layout: ds.layout,
    },
    palette: ds.color.palette.slice(0, 20).map((p) => `${p.value} x${p.count} ${p.usage.join('/')}`),
    cssTokens: tokens.map(([k, v]) => `${k}: ${v}`),
    fontSources: ds.typography.fontSources,
    components,
    navigation: ds.patterns.navigation,
    interactions: ds.patterns.interactions,
    notes: ds.meta.notes,
  });
}

// ----------------------------------------------------------- validation ---

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : undefined;
const hex = (v: unknown) => {
  if (typeof v !== 'string') return undefined;
  const n = normalizeColor(v);
  return n && (n.length === 7 || parseInt(n.slice(7), 16) >= 230) ? n.slice(0, 7) : undefined;
};
const cssMap = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (!/^[a-z-]{2,30}$/.test(k)) continue;
    const s = safeCssValue(val);
    if (s && !s.includes('var(')) out[k] = s;
  }
  return out;
};
const fontStack = (v: unknown) => (typeof v === 'string' && v.length < 200 ? v.replace(/[;{}<>\\]/g, '').trim() || undefined : undefined);

export function parseJsonReply(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return a JSON design system');
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('The model returned malformed JSON — try again or use another model'); }
}

/**
 * One JSON-mode completion with failure messages a user can act on. The cap is generous because
 * "thinking" models (e.g. Gemini 2.5) spend part of it reasoning; only tokens actually used are billed.
 */
async function completeJson(provider: LLMProvider, system: string, content: string, opts: AiOptions) {
  const res = await provider.complete({ system, messages: [{ role: 'user', content }], model: opts.model, maxTokens: 12000, json: true, reasoning: 'minimal', signal: opts.signal });
  const cutOff = /max_tokens|length|MAX_TOKENS/i.test(res.stopReason ?? '');
  if (!res.text.trim()) {
    throw new Error(`${provider.label} returned an empty reply${res.stopReason ? ` (finish reason: ${res.stopReason})` : ''}.${cutOff ? ' It used its whole token budget thinking — try again, or pick a non-thinking model in the top bar.' : ' Try again or use another model.'}`);
  }
  try {
    return { json: parseJsonReply(res.text), res };
  } catch (e: any) {
    throw new Error(cutOff ? `${provider.label}'s reply was cut off before the JSON was complete — try again or use another model.` : e.message);
  }
}

/** Untrusted model JSON → validated partial draft (only fields that passed checks). */
export function aiToDraft(j: any) {
  const roles: Partial<Record<ColorRole, string>> = {};
  for (const r of COLOR_ROLES) { const h = hex(j.roles?.[r]); if (h) roles[r] = h; }

  const scale: Partial<Record<TypeStep, TypeStyle>> = {};
  let prev = 0;
  for (const s of TYPE_STEPS) {
    const t = j.typeScale?.[s];
    const [size, lineHeight, weight] = Array.isArray(t) ? t : [t?.size, t?.lineHeight, t?.weight];
    const sz = num(size, 8, 160);
    if (sz === undefined || sz <= prev) continue;
    prev = sz;
    scale[s] = { size: sz, lineHeight: num(lineHeight, 0.9, 2.5) ?? 1.4, weight: num(weight, 100, 900) ?? 400 };
  }

  const google = Array.isArray(j.fonts?.googleFonts) ? j.fonts.googleFonts.filter((f: unknown) => typeof f === 'string' && /^[A-Za-z0-9 ]{2,40}$/.test(f)).slice(0, 3) : [];
  const fontSources = google.length
    ? [`https://fonts.googleapis.com/css2?${google.map((f: string) => `family=${f.trim().replace(/ /g, '+')}:wght@400;500;600;700`).join('&')}&display=swap`].filter(isAllowedFontSource)
    : [];

  const spacingScale = Array.isArray(j.spacing?.scale) ? j.spacing.scale.map((v: unknown) => num(v, 0, 256)).filter((v: number | undefined) => v !== undefined) : [];
  const sizes = (o: any, keys: string[], lo: number, hi: number) => {
    const out: Record<string, number> = {};
    for (const k of keys) { const v = num(o?.[k], lo, hi); if (v !== undefined) out[k] = v; }
    return Object.keys(out).length ? out : undefined;
  };
  const shadow: Record<string, string> = {};
  for (const k of ['sm', 'md', 'lg']) { const s = safeCssValue(j.shadow?.[k]); if (s) shadow[k] = s; }

  const components: Partial<Record<ComponentType, ComponentSpec>> = {};
  for (const type of COMPONENT_TYPES) {
    const c = j.components?.[type];
    if (!c || typeof c !== 'object') continue;
    const states: ComponentSpec['states'] = {};
    for (const s of ['hover', 'focus', 'active', 'disabled'] as ComponentState[]) { const m = cssMap(c.states?.[s]); if (Object.keys(m).length) states[s] = m; }
    const variants: Record<string, Record<string, string>> = {};
    for (const [name, v] of Object.entries(c.variants ?? {}).slice(0, 8)) if (/^[a-z][a-z0-9-]{0,20}$/i.test(name)) variants[name.toLowerCase()] = cssMap(v);
    components[type] = { found: true, count: 0, selectors: [], base: cssMap(c.base), states, variants };
  }

  const nav = j.navigation ?? {};
  return {
    name: typeof j.name === 'string' ? j.name.trim().slice(0, 80) : undefined,
    description: typeof j.description === 'string' ? j.description.trim().slice(0, 300) : undefined,
    roles, scale, fontSources, components,
    families: { sans: fontStack(j.fonts?.sans), heading: fontStack(j.fonts?.heading), mono: fontStack(j.fonts?.mono) },
    spacing: spacingScale.length >= 4 ? { base: num(j.spacing?.base, 1, 16) ?? 4, scale: [...new Set<number>(spacingScale)].sort((a, b) => a - b) } : undefined,
    radius: sizes(j.radius, ['sm', 'md', 'lg', 'xl'], 0, 64),
    shadow: Object.keys(shadow).length ? shadow : undefined,
    breakpoints: sizes(j.breakpoints, ['sm', 'md', 'lg', 'xl'], 320, 2560),
    layout: sizes(j.layout, ['maxWidth', 'gutter'], 8, 2560),
    navigation: ['topbar', 'sidebar', 'none'].includes(nav.type)
      ? { type: nav.type, sticky: !!nav.sticky, hasMobileMenu: !!nav.hasMobileMenu, hasSearch: !!nav.hasSearch } : undefined,
    interactions: Array.isArray(j.interactions) ? j.interactions.filter((s: unknown) => typeof s === 'string').map((s: string) => s.slice(0, 80)).slice(0, 10) : [],
    notes: Array.isArray(j.notes) ? j.notes.filter((s: unknown) => typeof s === 'string').map((s: string) => s.slice(0, 200)).slice(0, 6) : [],
  };
}

// ---------------------------------------------------------------- modes ---

/** Rule-based draft + evidence → AI-reviewed full system. AI values win where they validate. */
export async function aiExtract(base: DesignSystem, provider: LLMProvider, evidence: { cssTokens?: [string, string][] } = {}, opts: AiOptions = {}): Promise<AiResult> {
  const { json, res } = await completeJson(provider, EXTRACT_SYSTEM, evidencePack(base, evidence.cssTokens ?? []), opts);
  const d = aiToDraft(json);
  const roles = { ...base.color.roles, ...d.roles };
  const changedScales = Object.fromEntries(Object.entries(base.color.scales).filter(([name]) => !(name in d.roles) || d.roles[name as ColorRole] === base.color.roles[name as ColorRole]));
  const components = { ...base.components };
  for (const [type, c] of Object.entries(d.components) as [ComponentType, ComponentSpec][]) {
    const prev = base.components[type];
    components[type] = {
      found: true, count: prev?.count ?? 0, selectors: prev?.selectors ?? [],
      base: { ...prev?.base, ...c.base }, states: { ...prev?.states, ...c.states }, variants: { ...prev?.variants, ...c.variants },
    };
  }
  const ds = completeDesignSystem({
    ...base,
    meta: {
      ...base.meta,
      name: d.name || base.meta.name,
      description: d.description || base.meta.description,
      notes: [...base.meta.notes, `AI-assisted extraction (${res.provider}/${res.model}).`, ...d.notes],
    },
    color: { roles, scales: changedScales, palette: base.color.palette },
    typography: {
      families: { ...base.typography.families, ...strip(d.families) },
      fontSources: base.typography.fontSources.length ? base.typography.fontSources : d.fontSources,
      scale: { ...base.typography.scale, ...d.scale },
      weights: base.typography.weights,
    },
    spacing: d.spacing ?? base.spacing,
    radius: { ...base.radius, ...d.radius },
    shadow: { ...base.shadow, ...d.shadow },
    breakpoints: { ...base.breakpoints, ...d.breakpoints },
    layout: { ...base.layout, ...d.layout },
    components,
    patterns: {
      navigation: { ...base.patterns.navigation, ...d.navigation },
      interactions: [...new Set([...base.patterns.interactions, ...d.interactions])],
    },
  });
  return { ds: enforceScale(ds), usage: res.usage, provider: res.provider, model: res.model };
}

/** A written brief → a brand-new design system. */
export async function aiCreate(brief: string, provider: LLMProvider, opts: AiOptions & { name?: string } = {}): Promise<AiResult> {
  const text = brief.trim();
  if (text.length < 8) throw new Error('Describe the design system in a sentence or two');
  if (text.length > 2000) throw new Error('The description is too long (max 2000 characters)');
  const { json, res } = await completeJson(provider, CREATE_SYSTEM, `Brief: ${text}${opts.name ? `\nName: ${opts.name}` : ''}`, opts);
  const d = aiToDraft(json);
  if (Object.keys(d.roles).length < 3) throw new Error('The model did not return usable colors — try again or use another model');
  const ds = completeDesignSystem({
    meta: {
      name: opts.name?.trim().slice(0, 80) || d.name || 'AI design system',
      description: d.description,
      source: { type: 'ai', ref: text.slice(0, 200), extractedAt: new Date().toISOString() },
      confidence: 0,
      notes: [`Generated by AI (${res.provider}/${res.model}) from a description.`, ...d.notes],
    },
    color: { roles: d.roles },
    typography: { families: strip(d.families), fontSources: d.fontSources, scale: d.scale },
    spacing: d.spacing, radius: d.radius, shadow: d.shadow, breakpoints: d.breakpoints, layout: d.layout,
    components: d.components,
    patterns: { navigation: d.navigation, interactions: d.interactions },
  });
  return { ds: enforceScale(ds), usage: res.usage, provider: res.provider, model: res.model };
}

function strip<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Merging AI and rule-based steps can break monotonicity; repair it. */
function enforceScale(ds: DesignSystem): DesignSystem {
  let prev = 0;
  for (const s of TYPE_STEPS) {
    const t = ds.typography.scale[s];
    if (t.size <= prev) t.size = Math.round(prev * 1.12) || prev + 2;
    prev = t.size;
  }
  return ds;
}
