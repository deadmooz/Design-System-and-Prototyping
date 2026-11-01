/**
 * Figma file JSON → DesignSystem. Pure function, so it is testable from a saved
 * `GET /v1/files/:key` response. Reads named styles, local variables (when the
 * plan exposes them), and the node tree: fills, strokes, text, radii, effects,
 * auto-layout spacing and component sets with their variant properties.
 */

import { toHex } from '../../core/color.ts';
import { completeDesignSystem } from '../../core/defaults.ts';
import type {
  ColorRole, ComponentSpec, ComponentState, ComponentType, DesignSystem, Hex, TypeStep, TypeStyle,
} from '../../core/schema.ts';
import { ColorCollector, inferRoles, isOpaque, roleFromTokenName, toPalette } from '../roles.ts';
import type { FigmaPayload } from './client.ts';

const MAX_NODES = 60000;
const round = (n: number) => Math.round(n);

const figmaColor = (c: { r: number; g: number; b: number; a?: number }, opacity = 1): Hex =>
  toHex({ r: c.r * 255, g: c.g * 255, b: c.b * 255, a: (c.a ?? 1) * opacity });

const COMPONENT_NAME: [ComponentType, RegExp][] = [
  ['button', /\b(button|btn|cta)\b/i],
  ['input', /\b(input|text ?field|textfield|text ?area|select|dropdown|search ?field|form field)\b/i],
  ['card', /\bcard\b|\btile\b/i],
  ['badge', /\b(badge|tag|chip|pill|label)\b/i],
  ['modal', /\b(modal|dialog|sheet|popup)\b/i],
  ['avatar', /\bavatar\b/i],
  ['nav', /\b(nav|navbar|navigation|header|top ?bar|app ?bar|menu)\b/i],
  ['link', /\blink\b/i],
];

function bump<K>(m: Map<K, number>, k: K, by = 1) { m.set(k, (m.get(k) ?? 0) + by); }
function top<K>(m: Map<K, number>): K | undefined {
  let best: K | undefined, n = -Infinity;
  for (const [k, v] of m) if (v > n) { best = k; n = v; }
  return best;
}

function shadowCss(e: any): string {
  const c = e.color ? figmaColor(e.color) : '#00000026';
  const rgba = (() => {
    const h = c.length === 9 ? c : c + 'FF';
    const [r, g, b, a] = [1, 3, 5, 7].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${Math.round((a / 255) * 100) / 100})`;
  })();
  return `${round(e.offset?.x ?? 0)}px ${round(e.offset?.y ?? 0)}px ${round(e.radius ?? 0)}px ${round(e.spread ?? 0)}px ${rgba}`;
}

function solidFill(paints: any[] | undefined): Hex | null {
  const p = paints?.find((f) => f?.type === 'SOLID' && f.visible !== false && f.color);
  return p ? figmaColor(p.color, p.opacity ?? 1) : null;
}

/** CSS-ish description of one Figma node (used for component specs). */
function nodeStyle(node: any): Record<string, string> {
  const css: Record<string, string> = {};
  const fill = solidFill(node.fills);
  if (fill && node.type !== 'TEXT') css['background-color'] = fill.slice(0, 7);
  const stroke = solidFill(node.strokes);
  if (stroke && node.strokeWeight) css.border = `${node.strokeWeight}px solid ${stroke.slice(0, 7)}`;
  if (typeof node.cornerRadius === 'number') css['border-radius'] = `${round(node.cornerRadius)}px`;
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    const [t, r, b, l] = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map((n) => round(n ?? 0));
    if (t || r || b || l) css.padding = t === b && r === l ? `${t}px ${r}px` : `${t}px ${r}px ${b}px ${l}px`;
    if (node.itemSpacing) css.gap = `${round(node.itemSpacing)}px`;
  }
  if (node.absoluteBoundingBox?.height && node.type !== 'TEXT') css['min-height'] = `${round(node.absoluteBoundingBox.height)}px`;
  const shadow = node.effects?.find((e: any) => e.type === 'DROP_SHADOW' && e.visible !== false);
  if (shadow) css['box-shadow'] = shadowCss(shadow);
  // First text descendant gives the label typography.
  const text = findFirst(node, (n) => n.type === 'TEXT');
  if (text?.style) {
    css['font-size'] = `${round(text.style.fontSize)}px`;
    css['font-weight'] = String(text.style.fontWeight ?? 400);
    if (text.style.textCase === 'UPPER') css['text-transform'] = 'uppercase';
    if (text.style.letterSpacing) css['letter-spacing'] = `${Math.round((text.style.letterSpacing / text.style.fontSize) * 1000) / 1000}em`;
    const color = solidFill(text.fills);
    if (color) css.color = color.slice(0, 7);
  }
  return css;
}

function findFirst(node: any, pred: (n: any) => boolean, depth = 0): any {
  if (depth > 6 || !node?.children) return null;
  for (const c of node.children) {
    if (c.visible === false) continue;
    if (pred(c)) return c;
    const f = findFirst(c, pred, depth + 1);
    if (f) return f;
  }
  return null;
}

/** "Variant=Primary, Size=Large, State=Hover" → { variant: 'primary', size: 'large', state: 'hover' } */
function variantProps(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of name.split(',')) {
    const [k, v] = part.split('=').map((s) => s?.trim().toLowerCase());
    if (k && v) out[k] = v;
  }
  return out;
}

export function analyzeFigma(payload: FigmaPayload, ref: string): DesignSystem {
  const { file, variables } = payload;
  const notes: string[] = [];
  const colors = new ColorCollector();
  const hinted: Partial<Record<ColorRole, Hex>> = {};
  const styles: Record<string, { name: string; styleType: string }> = file.styles ?? {};

  const families = new Map<string, number>(), headingFamilies = new Map<string, number>();
  const sizes = new Map<number, number>(), weights = new Map<number, number>();
  const namedText = new Map<string, TypeStyle & { family: string }>();
  const lineBySize = new Map<number, number>();
  const spacing = new Map<number, number>(), radii = new Map<number, number>(), shadows = new Map<string, number>();
  const frameWidths = new Map<number, number>();
  const components: Partial<Record<ComponentType, ComponentSpec>> = {};
  let visited = 0;

  // Variables API (Enterprise): strongest naming signal.
  const varMeta = variables?.meta;
  if (varMeta?.variables) {
    const collections = varMeta.variableCollections ?? {};
    for (const v of Object.values<any>(varMeta.variables)) {
      if (v.remote) continue;
      const modeId = collections[v.variableCollectionId]?.defaultModeId ?? Object.keys(v.valuesByMode ?? {})[0];
      const val = v.valuesByMode?.[modeId];
      if (v.resolvedType === 'COLOR' && val && typeof val.r === 'number') {
        const full = figmaColor(val);
        const hex = full.slice(0, 7);
        colors.add(full, 'other', 0, 2);
        const role = roleFromTokenName(v.name);
        if (role && !hinted[role] && isOpaque(full)) hinted[role] = hex;
      } else if (v.resolvedType === 'FLOAT' && typeof val === 'number') {
        if (/radius|corner|rounded/i.test(v.name) && val > 0 && val < 999) bump(radii, round(val), 3);
        if (/spac|gap|padding|space/i.test(v.name) && val > 0 && val <= 128) bump(spacing, round(val), 3);
      }
    }
    notes.push(`${Object.keys(varMeta.variables).length} Figma variables read.`);
  } else {
    notes.push('Figma Variables API not available for this file/plan; used styles and layers instead.');
  }

  const walk = (node: any, depth: number, inComponent: boolean) => {
    if (!node || node.visible === false || ++visited > MAX_NODES) return;
    const isContainer = /^(FRAME|COMPONENT|COMPONENT_SET|INSTANCE|RECTANGLE|GROUP|SECTION)$/.test(node.type);

    // Colors (+ names from attached styles).
    const fill = solidFill(node.fills);
    if (fill) {
      const usage = node.type === 'TEXT' ? 'text' : 'background';
      colors.add(fill, usage, inComponent && /button|btn|cta/i.test(node.name ?? '') ? 3 : 0);
      const styleId = node.styles?.fill ?? node.styles?.fills;
      const sname = styleId && styles[styleId]?.name;
      if (sname) { const role = roleFromTokenName(sname); if (role && !hinted[role]) hinted[role] = fill.slice(0, 7); }
    }
    const stroke = solidFill(node.strokes);
    if (stroke && node.strokeWeight) colors.add(stroke, 'border');

    if (node.type === 'TEXT' && node.style) {
      const s = node.style;
      if (s.fontFamily) bump(families, s.fontFamily);
      const size = round(s.fontSize ?? 0);
      if (size >= 8 && size <= 160) {
        bump(sizes, size);
        if (s.lineHeightPx) lineBySize.set(size, Math.round((s.lineHeightPx / s.fontSize) * 100) / 100);
        if (size >= 24 && s.fontFamily) bump(headingFamilies, s.fontFamily);
      }
      if (s.fontWeight) bump(weights, s.fontWeight);
      const sname = node.styles?.text && styles[node.styles.text]?.name;
      if (sname && !namedText.has(sname)) {
        namedText.set(sname, { size, weight: s.fontWeight ?? 400, lineHeight: s.lineHeightPx ? Math.round((s.lineHeightPx / s.fontSize) * 100) / 100 : 1.4, family: s.fontFamily });
      }
    }
    if (isContainer) {
      if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
        if (node.cornerRadius >= 999 || (node.absoluteBoundingBox && node.cornerRadius >= node.absoluteBoundingBox.height / 2)) bump(radii, 9999);
        else if (node.cornerRadius <= 64) bump(radii, round(node.cornerRadius));
      }
      if (node.layoutMode && node.layoutMode !== 'NONE') {
        for (const n of [node.itemSpacing, node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]) {
          if (typeof n === 'number' && n > 0 && n <= 128) bump(spacing, round(n));
        }
      }
      for (const e of node.effects ?? []) if (e.type === 'DROP_SHADOW' && e.visible !== false) bump(shadows, shadowCss(e));
      if (depth === 2 && node.type === 'FRAME' && node.absoluteBoundingBox?.width) bump(frameWidths, round(node.absoluteBoundingBox.width));
    }

    // Components and component sets.
    if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && !inComponent)) {
      const type = COMPONENT_NAME.find(([, re]) => re.test(node.name ?? ''))?.[0];
      if (type) {
        const spec = (components[type] ??= { found: true, count: 0, selectors: [], base: {}, states: {}, variants: {} });
        spec.count++;
        if (spec.selectors.length < 8) spec.selectors.push(`Figma: ${node.name}`);
        const members = node.type === 'COMPONENT_SET' ? (node.children ?? []).filter((c: any) => c.type === 'COMPONENT') : [node];
        for (const member of members.slice(0, 40)) {
          const props = variantProps(member.name ?? '');
          const css = nodeStyle(member);
          const state = (props.state ?? props.status ?? '').replace('focused', 'focus').replace('pressed', 'active').replace('hovered', 'hover');
          const variant = props.variant ?? props.type ?? props.style ?? props.hierarchy ?? props.kind;
          const isDefaultState = !state || /^(default|enabled|rest|normal|idle)$/.test(state);
          if (!isDefaultState && /^(hover|focus|active|disabled)$/.test(state)) {
            spec.states[state as ComponentState] ??= css;
          } else if (variant && isDefaultState) {
            spec.variants[variant] ??= css;
            if (!Object.keys(spec.base).length && /primary|default|filled|solid|main/.test(variant)) spec.base = css;
          } else if (!Object.keys(spec.base).length) spec.base = css;
        }
        if (!Object.keys(spec.base).length) spec.base = Object.values(spec.variants)[0] ?? {};
      }
    }
    const nextIn = inComponent || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
    for (const c of node.children ?? []) walk(c, depth + 1, nextIn);
  };
  walk(file.document, 0, false);
  if (visited > MAX_NODES) notes.push(`File is large; analysed the first ${MAX_NODES} layers. Link to a specific frame (node-id) for focused results.`);

  // Roles: style/variable names first, then statistics.
  const clusters = colors.clusters();
  const btn = components.button;
  const btnBase = btn ? btn.variants.primary ?? btn.base : undefined;
  const roles = inferRoles({
    clusters, hinted,
    buttonBg: btnBase?.['background-color'] ?? null,
    buttonText: btnBase?.color ?? null,
  });

  // Typography: named text styles ("Heading/H1", "Body/Regular") beat raw stats.
  const scale: Partial<Record<TypeStep, TypeStyle>> = {};
  const fromName = (re: RegExp) => [...namedText].find(([n]) => re.test(n))?.[1];
  const named: [TypeStep, RegExp][] = [
    ['4xl', /\b(h1|display|heading ?1|title ?xl|hero)\b/i], ['3xl', /\b(h2|heading ?2|title ?l(arge)?)\b/i],
    ['2xl', /\b(h3|heading ?3|title)\b/i], ['xl', /\b(h4|heading ?4|subtitle)\b/i], ['lg', /\b(h5|large|body ?l(arge)?|lead)\b/i],
    ['base', /\b(body|paragraph|regular|text ?m(edium)?|default)\b/i], ['sm', /\b(small|body ?s(mall)?|caption ?l)\b/i],
    ['xs', /\b(caption|overline|tiny|micro|xs)\b/i],
  ];
  for (const [step, re] of named) {
    const t = fromName(re);
    if (t && t.size) scale[step] = { size: t.size, lineHeight: t.lineHeight, weight: t.weight };
  }
  const sortedSizes = [...sizes].sort((a, b) => b[1] - a[1]);
  const base = scale.base?.size ?? sortedSizes.find(([s]) => s >= 14 && s <= 18)?.[0] ?? 16;
  scale.base ??= { size: base, lineHeight: lineBySize.get(base) ?? 1.5, weight: 400 };
  // Unnamed larger sizes fill the free steps from the top (largest → 4xl), so a lone heading size never lands in `lg`.
  const steps: TypeStep[] = ['lg', 'xl', '2xl', '3xl', '4xl'];
  const used = new Set(Object.values(scale).map((t) => t!.size));
  const larger = [...sizes.keys()].filter((s) => s > base && !used.has(s)).sort((a, b) => b - a);
  const free = steps.filter((s) => !scale[s]).reverse();
  larger.slice(0, free.length).forEach((size, i) => {
    scale[free[i]] = { size, lineHeight: lineBySize.get(size) ?? 1.25, weight: steps.indexOf(free[i]) >= 2 ? 700 : 600 };
  });
  const ratios: Record<string, number> = { lg: 1.125, xl: 1.25, '2xl': 1.5, '3xl': 1.875, '4xl': 2.25 };
  let prev = base;
  for (const step of steps) {
    const t = scale[step];
    if (!t || t.size <= prev) scale[step] = { size: Math.max(Math.round(base * ratios[step]), prev + 2), lineHeight: t?.lineHeight ?? 1.3, weight: t?.weight ?? (step === 'lg' ? 500 : 700) };
    prev = scale[step]!.size;
  }
  const smaller = [...sizes.keys()].filter((s) => s < base).sort((a, b) => b - a);
  if (!scale.sm && smaller[0]) scale.sm = { size: smaller[0], lineHeight: lineBySize.get(smaller[0]) ?? 1.43, weight: 400 };
  if (!scale.xs && smaller[1]) scale.xs = { size: smaller[1], lineHeight: lineBySize.get(smaller[1]) ?? 1.33, weight: 400 };

  // Spacing / radius / shadows.
  const spacingVals = [...spacing].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 13).map(([v]) => v);
  const spacingBase = spacingVals.filter((v) => v % 8 === 0).length / Math.max(1, spacingVals.length) > 0.7 ? 8 : 4;
  const radiusVals = [...radii].filter(([v]) => v < 9999).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v]) => v);
  const md = radiusVals[0];
  const asc = [...radiusVals].sort((a, b) => a - b);
  const shadowVals = [...shadows].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v]) => v);
  const blur = (s: string) => parseFloat(s.split(' ')[2]) || 0;
  shadowVals.sort((a, b) => blur(a) - blur(b));

  const widths = [...frameWidths.keys()].sort((a, b) => a - b);
  const desktop = widths.filter((w) => w >= 1024);
  const sans = top(families);
  const heading = top(headingFamilies) ?? sans;
  const stack = (f?: string) => (f ? `'${f.replace(/'/g, '')}', system-ui, sans-serif` : '');
  const googleFonts = [...new Set([sans, heading].filter(Boolean))] as string[];

  const evidence = [clusters.length >= 3, !!sans, sizes.size >= 4, spacing.size >= 4, radii.size > 0, shadows.size > 0, Object.keys(components).length >= 2, Object.keys(hinted).length >= 2];
  return completeDesignSystem({
    meta: {
      name: file.name || 'Figma design system',
      source: { type: 'figma', ref, extractedAt: new Date().toISOString() },
      confidence: Math.round((evidence.filter(Boolean).length / evidence.length) * 100) / 100,
      notes,
    },
    color: { roles, palette: toPalette(clusters) },
    typography: {
      families: { sans: stack(sans), heading: stack(heading), mono: '' },
      // Figma fonts are usually Google Fonts; the URL is harmless if one is not.
      fontSources: googleFonts.length ? [`https://fonts.googleapis.com/css2?${googleFonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&')}&display=swap`] : [],
      scale,
      weights: [...weights.keys()].sort((a, b) => a - b),
    },
    spacing: spacingVals.length >= 5 ? { base: spacingBase, scale: [0, ...spacingVals.sort((a, b) => a - b)] } : undefined,
    radius: md ? { sm: asc[0] < md ? asc[0] : Math.max(2, round(md / 2)), md, lg: asc.find((v) => v > md) ?? round(md * 1.5), xl: Math.max(asc[asc.length - 1], md * 2) } : undefined,
    shadow: shadowVals.length ? { sm: shadowVals[0], md: shadowVals[Math.floor((shadowVals.length - 1) / 2)], lg: shadowVals[shadowVals.length - 1] } : undefined,
    layout: desktop.length ? { maxWidth: Math.min(1440, desktop[0]) } : undefined,
    components,
    patterns: {
      navigation: { type: components.nav ? 'topbar' : 'unknown', sticky: false, hasMobileMenu: widths.some((w) => w < 500), hasSearch: false, items: [] },
      interactions: Object.values(components).some((c) => c && Object.keys(c.states).length) ? ['component states defined as Figma variants'] : [],
    },
  });
}
