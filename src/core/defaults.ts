/** Neutral fallback values and the function that turns partial findings into a complete DesignSystem. */

import { generateScale, isNeutral, mix, normalizeColor, readableOn } from './color.ts';
import {
  COLOR_ROLES, TYPE_STEPS,
  type ColorRole, type DesignSystem, type Hex, type TypeStep, type TypeStyle,
} from './schema.ts';

export const DEFAULT_ROLES: Record<ColorRole, Hex> = {
  primary: '#2563EB', onPrimary: '#FFFFFF', secondary: '#0F172A', accent: '#F59E0B',
  background: '#FFFFFF', surface: '#F8FAFC', text: '#0F172A', textMuted: '#64748B',
  border: '#E2E8F0', success: '#16A34A', warning: '#D97706', error: '#DC2626', info: '#0284C7',
};

export const DEFAULT_TYPE_SCALE: Record<TypeStep, TypeStyle> = {
  xs: { size: 12, lineHeight: 1.33, weight: 400 },
  sm: { size: 14, lineHeight: 1.43, weight: 400 },
  base: { size: 16, lineHeight: 1.5, weight: 400 },
  lg: { size: 18, lineHeight: 1.56, weight: 400 },
  xl: { size: 20, lineHeight: 1.4, weight: 600 },
  '2xl': { size: 24, lineHeight: 1.33, weight: 600 },
  '3xl': { size: 30, lineHeight: 1.2, weight: 700 },
  '4xl': { size: 36, lineHeight: 1.11, weight: 700 },
};

export const SYSTEM_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const SYSTEM_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Only well-known font CDNs may be injected into previews. */
export function isAllowedFontSource(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^(fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|rsms\.me)$/.test(u.hostname);
  } catch {
    return false;
  }
}

export type DesignSystemDraft = {
  [K in keyof DesignSystem]?: K extends 'meta' ? Partial<DesignSystem['meta']> : any;
};

/**
 * Fills every gap in a draft with sensible values derived from what *was* found
 * (e.g. scales from roles, onPrimary from contrast). Safe to call on any input.
 */
export function completeDesignSystem(draft: DesignSystemDraft = {}): DesignSystem {
  const rolesIn: Partial<Record<ColorRole, string>> = draft.color?.roles ?? {};
  const roles = {} as Record<ColorRole, Hex>;
  for (const r of COLOR_ROLES) roles[r] = (rolesIn[r] && normalizeColor(rolesIn[r]!)?.slice(0, 7)) || DEFAULT_ROLES[r];
  if (!rolesIn.onPrimary) roles.onPrimary = readableOn(roles.primary);
  if (!rolesIn.surface && rolesIn.background) roles.surface = mix(roles.background, roles.text, 0.03);
  if (!rolesIn.border && rolesIn.background) roles.border = mix(roles.background, roles.text, 0.12);
  if (!rolesIn.textMuted && rolesIn.text) roles.textMuted = mix(roles.text, roles.background, 0.4);

  const scales: Record<string, any> = { ...(draft.color?.scales ?? {}) };
  scales.primary ??= generateScale(roles.primary);
  if (!isNeutral(roles.secondary)) scales.secondary ??= generateScale(roles.secondary);
  scales.accent ??= generateScale(roles.accent);
  scales.neutral ??= generateScale(isNeutral(roles.text) ? mix(roles.text, roles.background, 0.45) : '#737373');

  const scaleIn = draft.typography?.scale ?? {};
  const scale = {} as Record<TypeStep, TypeStyle>;
  for (const s of TYPE_STEPS) scale[s] = { ...DEFAULT_TYPE_SCALE[s], ...(scaleIn[s] ?? {}) };
  const fam = draft.typography?.families ?? {};

  const meta = draft.meta ?? {};
  return {
    version: '1',
    meta: {
      name: meta.name || 'Untitled design system',
      description: meta.description,
      source: meta.source ?? { type: 'manual', ref: '', extractedAt: new Date().toISOString() },
      confidence: typeof meta.confidence === 'number' ? meta.confidence : 0,
      notes: meta.notes ?? [],
    },
    color: { roles, scales, palette: draft.color?.palette ?? [] },
    typography: {
      families: { sans: fam.sans || SYSTEM_SANS, heading: fam.heading || fam.sans || SYSTEM_SANS, mono: fam.mono || SYSTEM_MONO },
      fontSources: (draft.typography?.fontSources ?? []).filter((u: unknown) => typeof u === 'string' && isAllowedFontSource(u)),
      scale,
      weights: draft.typography?.weights?.length ? draft.typography.weights : [400, 500, 600, 700],
    },
    spacing: draft.spacing?.scale?.length ? draft.spacing : { base: 4, scale: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80] },
    radius: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999, ...(draft.radius ?? {}) },
    shadow: {
      sm: '0 1px 2px rgba(0,0,0,0.06)',
      md: '0 4px 12px rgba(0,0,0,0.08)',
      lg: '0 12px 32px rgba(0,0,0,0.12)',
      ...(draft.shadow ?? {}),
    },
    breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280, ...(draft.breakpoints ?? {}) },
    layout: { maxWidth: 1200, gutter: 24, ...(draft.layout ?? {}) },
    components: draft.components ?? {},
    patterns: {
      navigation: { type: 'unknown', sticky: false, hasMobileMenu: false, hasSearch: false, items: [], ...(draft.patterns?.navigation ?? {}) },
      interactions: draft.patterns?.interactions ?? [],
    },
  };
}

/**
 * Validates untrusted JSON (uploads, LLM output, API bodies) and returns a complete
 * DesignSystem. Throws with a readable message when the input is not usable at all.
 */
export function parseDesignSystem(input: unknown): DesignSystem {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Design system must be a JSON object');
  const d = input as Record<string, any>;
  if (d.version !== undefined && String(d.version) !== '1') throw new Error(`Unsupported design system version "${d.version}"`);
  for (const key of ['color', 'typography', 'spacing', 'radius', 'shadow', 'breakpoints', 'layout', 'components', 'patterns', 'meta']) {
    if (d[key] !== undefined && (typeof d[key] !== 'object' || d[key] === null)) throw new Error(`"${key}" must be an object`);
  }
  return completeDesignSystem(d as DesignSystemDraft);
}
