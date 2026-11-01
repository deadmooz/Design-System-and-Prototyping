/**
 * Website → DesignSystem. Pure function over already-fetched HTML + CSS, so it is
 * deterministic and unit-testable. Heuristics first (zero LLM tokens); an optional
 * LLM refinement pass lives in src/extract/refine.ts.
 */

import { normalizeColor, COLOR_RE } from '../../core/color.ts';
import { completeDesignSystem, type DesignSystemDraft } from '../../core/defaults.ts';
import {
  COMPONENT_TYPES, TYPE_STEPS,
  type ColorRole, type ColorUsage, type ComponentSpec, type ComponentState, type ComponentType, type DesignSystem,
  type Hex, type TypeStep, type TypeStyle,
} from '../../core/schema.ts';
import { ColorCollector, inferRoles, isOpaque, roleFromTokenName, toPalette } from '../roles.ts';
import { parseCss, parseDeclarations, toPx, type CssRule } from './css.ts';
import { analyzeHtml } from './html.ts';

export interface WebSource {
  url: string;
  html: string;
  css: { href: string; text: string }[];
  warnings?: string[];
}

// ---------------------------------------------------------------- helpers ---

const ROOT_SEL = /^(:root|html|body|:host)(\[[^\]]*light[^\]]*\])?$/i;
const DARK_SEL = /\.dark\b|\[data-(theme|mode|color-scheme)\s*=\s*["']?dark|\.theme-dark|dark-mode/i;
const ACTION_SEL = /\bbutton\b|\.btn|\bcta\b|primary|\[type=["']?submit|-button\b|\.button\b/i;
const LINK_SEL = /(^|[\s>+~])a(?=$|[:.[\s])/;
const HEADING_SEL = /(^|[\s>+~,])\.?h([1-6])(?=$|[:.[\s,])/i;
const ICON_FONT = /icon|awesome|material\s*symbols|glyph|fontello|ionicons|dashicons|swiper-icons|slick/i;

const componentMatchers: [ComponentType, RegExp][] = [
  ['button', /^button\b|\.btn\b|\.btn[-_]|\.button\b|\.button[-_]|[-_]btn\b|\[type=["']?(submit|button)|\.cta\b/i],
  ['input', /^(input|textarea|select)\b|\.form-control\b|\.input\b|\.input[-_]|\.text-?field|\.form-input/i],
  ['card', /\.card\b|\.card[-_][a-z]*$|[-_]card\b|\.tile\b|\.panel\b/i],
  ['badge', /\.badge\b|\.badge[-_]|\.tag\b|\.chip\b|\.pill\b/i],
  ['modal', /\.modal\b|\.modal[-_](dialog|content)|^dialog\b|\.dialog\b/i],
  ['avatar', /\.avatar\b/i],
  ['nav', /^nav\b|\.nav\b|\.navbar\b|^header\b|\.header\b|\.site-header|\.topbar/i],
  ['link', /^a(?=$|[:.[])/i],
];

const COMPONENT_PROPS = new Set([
  'background', 'background-color', 'color', 'border', 'border-color', 'border-width', 'border-style', 'border-radius',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block',
  'font-size', 'font-weight', 'font-family', 'text-transform', 'letter-spacing', 'line-height', 'box-shadow',
  'height', 'min-height', 'text-decoration', 'outline', 'transition', 'opacity', 'transform', 'gap',
]);

const STATE_OF: Record<string, ComponentState> = {
  hover: 'hover', focus: 'focus', 'focus-visible': 'focus', 'focus-within': 'focus', active: 'active', disabled: 'disabled',
};

function bump<K>(map: Map<K, number>, key: K, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}
function topKey<K>(map: Map<K, number>): K | undefined {
  let best: K | undefined, n = -Infinity;
  for (const [k, v] of map) if (v > n) { best = k; n = v; }
  return best;
}
const round = (n: number, step = 1) => Math.round(n / step) * step;

/** Replaces var(--x, fallback) using known custom properties (depth-limited). */
function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 6 || !value.includes('var(')) return value;
  let out = '', i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at < 0) { out += value.slice(i); break; }
    out += value.slice(i, at);
    let d = 0, j = at + 3;
    for (; j < value.length; j++) {
      if (value[j] === '(') d++;
      else if (value[j] === ')' && --d === 0) break;
    }
    const inner = value.slice(at + 4, j);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? '' : inner.slice(comma + 1).trim();
    const resolved = vars.get(name) ?? fallback;
    out += resolveVars(resolved, vars, depth + 1);
    i = j + 1;
  }
  return out;
}

/** shadcn/Bootstrap-style bare channels: "222 47% 11%" → hsl(), "37 99 235" → rgb(). */
function colorFromVarValue(v: string): Hex | null {
  const s = v.trim();
  if (/^\d+(\.\d+)?(deg)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(s)) return normalizeColor(`hsl(${s.replace('deg', '')})`);
  if (/^\d{1,3}\s*,?\s*\d{1,3}\s*,?\s*\d{1,3}$/.test(s)) return normalizeColor(`rgb(${s})`);
  const m = s.match(COLOR_RE);
  return m && m[0].length >= s.length - 2 ? normalizeColor(m[0]) : null;
}

// ------------------------------------------------------------- main entry ---

export function analyzeWebsite(src: WebSource): DesignSystem {
  const insights = analyzeHtml(src.html, src.url);
  const notes: string[] = [...(src.warnings ?? [])];

  const rules: CssRule[] = [];
  const mediaQueries: string[] = [];
  let keyframes = 0;
  const cssImports: string[] = [];
  const faceFamilies = new Map<string, number>(); // web fonts the site actually loads
  for (const sheet of src.css) {
    const p = parseCss(sheet.text);
    for (const f of p.fontFaces) {
      const fam = (f['font-family'] ?? '').replace(/["']/g, '').trim();
      if (fam && !ICON_FONT.test(fam) && !/noto-sans-(arabic|hebrew)|fallback/i.test(fam)) bump(faceFamilies, fam);
    }
    rules.push(...p.rules);
    mediaQueries.push(...p.mediaQueries);
    cssImports.push(...p.imports.map((i) => { try { return new URL(i, sheet.href.startsWith('inline') ? src.url : sheet.href).href; } catch { return i; } }));
    keyframes += p.keyframes;
  }
  for (const s of insights.styleAttributes) rules.push({ selector: '*[style]', decls: parseDeclarations(s) });
  const cssBytes = src.css.reduce((n, s) => n + s.text.length, 0);

  // 1. Custom properties (light/root definitions win over others).
  const vars = new Map<string, string>();
  const rootVars = new Map<string, string>();
  for (const r of rules) {
    const dark = DARK_SEL.test(r.selector) || /dark/.test(r.media ?? '');
    const root = r.selector.split(',').some((s) => ROOT_SEL.test(s.trim()));
    for (const [p, v] of r.decls) {
      if (!p.startsWith('--')) continue;
      if (dark) continue;
      if (root || !vars.has(p)) vars.set(p, v);
      if (root) rootVars.set(p, v);
    }
  }

  // 2. Walk declarations once, collecting every signal.
  const colors = new ColorCollector();
  let rootBg: Hex | null = null, rootText: Hex | null = null;

  const families = new Map<string, number>(), headingFamilies = new Map<string, number>(), monoFamilies = new Map<string, number>();
  let rootFamily: string | null = null;
  const sizeHist = new Map<number, number>();
  const headingSize: Map<number, number>[] = Array.from({ length: 7 }, () => new Map());
  const headingWeight: Map<number, number>[] = Array.from({ length: 7 }, () => new Map());
  const headingLine: Map<number, number>[] = Array.from({ length: 7 }, () => new Map());
  let bodySize: number | null = null, bodyLine: number | null = null;
  const weights = new Map<number, number>();
  const spacing = new Map<number, number>();
  const radii = new Map<number, number>();
  let fullRadius = 0;
  const shadows = new Map<string, number>();
  const containerWidths = new Map<number, number>();
  const gutters = new Map<number, number>();
  let hoverRules = 0, transitionRules = 0, focusVisible = 0, stickyNav = false;

  type Acc = Map<string, Map<string, number>>;
  const comp: Record<string, { base: Acc; states: Partial<Record<ComponentState, Acc>>; variants: Map<string, Acc>; selectors: Set<string>; rules: number }> = {};
  const accAdd = (acc: Acc, prop: string, value: string, w: number) => {
    const m = acc.get(prop) ?? new Map<string, number>();
    bump(m, value, w);
    acc.set(prop, m);
  };

  for (const rule of rules) {
    const dark = DARK_SEL.test(rule.selector) || /prefers-color-scheme:\s*dark/.test(rule.media ?? '');
    const parts = rule.selector.split(',').map((s) => s.trim()).filter(Boolean);
    const isRoot = parts.some((s) => ROOT_SEL.test(s));
    const isAction = ACTION_SEL.test(rule.selector);
    const isLink = LINK_SEL.test(rule.selector);
    const hMatch = rule.selector.match(HEADING_SEL);
    const hLevel = hMatch ? Number(hMatch[2]) : 0;
    const isBodyText = parts.some((s) => /^(body|html|p|:root)$/i.test(s));
    const isContainer = /container|wrapper|\bwrap\b|\.inner\b|content-width|max-w|\.page\b|layout/i.test(rule.selector);
    const isMono = /\b(code|pre|kbd|samp)\b|mono/i.test(rule.selector);
    if (/:hover/.test(rule.selector)) hoverRules++;
    if (/:focus-visible/.test(rule.selector)) focusVisible++;

    // Component classification per selector part (last compound decides).
    const hits: { type: ComponentType; state?: ComponentState; variant?: string; classBased: boolean; sel: string }[] = [];
    for (const part of parts) {
      const last = part.split(/\s*[>+~]\s*|\s+/).pop() ?? part;
      const pseudo = last.match(/:(hover|focus-visible|focus-within|focus|active|disabled)\b/)?.[1];
      const disabledAttr = /\[disabled\]|\.disabled\b|\.is-disabled/.test(last);
      const bare = last.replace(/::?[a-z-]+(\([^)]*\))?/gi, '');
      for (const [type, re] of componentMatchers) {
        if (!re.test(bare)) continue;
        const variant = bare.match(/(?:btn|button|badge|card|tag|chip)(?:-{1,2}|_{1,2})([a-z][a-z0-9]*)/i)?.[1]?.toLowerCase()
          ?? bare.match(/\.is-([a-z]+)/i)?.[1]?.toLowerCase();
        const sizeLike = variant && /^(xs|sm|small|md|lg|large|xl|block|icon|group|wrapper|text|label|title|body|header|footer|img|image|content)$/.test(variant);
        hits.push({
          type, state: disabledAttr ? 'disabled' : pseudo ? STATE_OF[pseudo] : undefined,
          variant: sizeLike ? undefined : variant, classBased: bare.includes('.'), sel: part,
        });
        break;
      }
    }

    for (const [prop, rawValue] of rule.decls) {
      if (prop.startsWith('--')) continue;
      const value = resolveVars(rawValue, vars).trim();
      if (!value) continue; // var() with no definition and no fallback

      // Colors
      if (!dark && COLOR_RE.test(value)) {
        COLOR_RE.lastIndex = 0;
        const usage: ColorUsage | null =
          prop === 'background' || prop === 'background-color' ? 'background'
          : prop === 'color' ? 'text'
          : prop.startsWith('border') || prop.startsWith('outline') ? 'border'
          : prop === 'fill' || prop === 'stroke' ? 'fill'
          : null;
        if (usage) {
          for (const m of value.match(COLOR_RE) ?? []) {
            colors.add(m, usage, (isAction && usage === 'background' ? 3 : 0) + (isLink && usage === 'text' ? 2 : 0));
            if (isRoot && usage === 'background' && !rootBg) rootBg = normalizeColor(m)?.slice(0, 7) ?? null;
            if (isRoot && usage === 'text' && !rootText) rootText = normalizeColor(m)?.slice(0, 7) ?? null;
          }
        }
      }
      COLOR_RE.lastIndex = 0;

      // Typography
      if (prop === 'font-family' || prop === 'font') {
        const fam = cleanFamily(prop === 'font' ? value.replace(/^.*?\d[\w%.]*(\/[\w.%]+)?\s+/, '') : value);
        if (fam && !ICON_FONT.test(fam)) {
          bump(families, fam);
          if (isRoot) rootFamily ??= fam;
          if (hLevel) bump(headingFamilies, fam, 2);
          if (isMono) bump(monoFamilies, fam, 2);
        }
      }
      if (prop === 'font-size') {
        const px = toPx(value);
        if (px && px >= 9 && px <= 120) {
          const r = round(px);
          bump(sizeHist, r);
          if (hLevel) bump(headingSize[hLevel], r, 2);
          if (isBodyText && !bodySize && r >= 12 && r <= 22) bodySize = r;
        }
      }
      if (prop === 'font-weight') {
        const w = value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value);
        if (w >= 100 && w <= 900) { bump(weights, w); if (hLevel) bump(headingWeight[hLevel], w, 2); }
      }
      if (prop === 'line-height') {
        const n = Number(value);
        if (hLevel && n > 0.8 && n < 3) bump(headingLine[hLevel], Math.round(n * 100) / 100);
        if (isBodyText && !bodyLine && n > 1 && n < 2.5) bodyLine = n;
      }

      // Spacing
      if (/^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(row-|column-)?gap$/.test(prop)) {
        for (const tok of value.split(/\s+/)) {
          const px = toPx(tok);
          if (px && px > 0 && px <= 128) bump(spacing, round(px));
        }
      }

      // Radius
      if (/^border(-[a-z]+)*-radius$/.test(prop)) {
        const first = value.split(/\s+|\//)[0];
        if (first.endsWith('%') && parseFloat(first) >= 50) fullRadius++;
        else {
          const px = toPx(first);
          if (px !== null && px >= 999) fullRadius++;
          else if (px && px > 0 && px <= 64) bump(radii, round(px));
        }
      }

      // Shadows
      if (prop === 'box-shadow' && !/^(none|0\s+0\s+0|inherit|initial|unset)/.test(value) && !/^inset\b/.test(value) && value.length < 160) {
        bump(shadows, value.replace(/\s+/g, ' '));
      }

      // Layout
      if (isContainer && prop === 'max-width') {
        const px = toPx(value);
        if (px && px >= 720 && px <= 1920) bump(containerWidths, round(px));
      }
      if (isContainer && /^padding(-(left|right|inline))?$/.test(prop)) {
        const toks = value.split(/\s+/);
        const px = toPx(toks.length > 1 ? toks[1] : toks[0]);
        if (px && px >= 8 && px <= 64) bump(gutters, round(px));
      }
      if (prop === 'transition' || prop === 'transition-property') transitionRules++;
      if (prop === 'position' && /sticky|fixed/.test(value) && /\bnav\b|navbar|header|topbar/i.test(rule.selector)) stickyNav = true;

      // Components
      if (!dark && COMPONENT_PROPS.has(prop)) {
        for (const h of hits) {
          const c = (comp[h.type] ??= { base: new Map(), states: {}, variants: new Map(), selectors: new Set(), rules: 0 });
          if (/^(inherit|initial|unset|revert)$/.test(value)) continue;
          if (!h.classBased && /^(0|none|transparent)$/.test(value)) continue; // resets like `button { padding: 0 }`
          const w = h.classBased ? 3 : 1;
          if (h.state) accAdd((c.states[h.state] ??= new Map()), prop, value, w);
          else if (h.variant) {
            const acc = c.variants.get(h.variant) ?? new Map();
            accAdd(acc, prop, value, w);
            c.variants.set(h.variant, acc);
          } else accAdd(c.base, prop, value, w);
        }
      }
    }
    for (const h of hits) {
      const c = (comp[h.type] ??= { base: new Map(), states: {}, variants: new Map(), selectors: new Set(), rules: 0 });
      c.rules++;
      if (c.selectors.size < 8) c.selectors.add(h.sel.slice(0, 80));
    }
  }

  // 3. Components (needed before color roles: the primary button is strong evidence).
  const components: DesignSystem['components'] = {};
  const flatten = (acc: Acc) => {
    const out: Record<string, string> = {};
    for (const [prop, vals] of acc) out[prop] = topKey(vals)!;
    collapsePadding(out);
    return out;
  };
  for (const type of COMPONENT_TYPES) {
    const c = comp[type];
    const htmlCount = insights.componentCounts[type] ?? 0;
    if (!c && !htmlCount) continue;
    const variants: Record<string, Record<string, string>> = {};
    if (c) {
      const ranked = [...c.variants.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8);
      for (const [name, acc] of ranked) variants[name] = flatten(acc);
    }
    const base = c ? flatten(c.base) : {};
    const states: ComponentSpec['states'] = {};
    if (c) for (const [s, acc] of Object.entries(c.states) as [ComponentState, Acc][]) states[s] = flatten(acc);
    components[type] = {
      found: (c?.rules ?? 0) > 0 || htmlCount > 0,
      count: htmlCount,
      selectors: c ? [...c.selectors] : [],
      base,
      states,
      variants,
    };
  }

  // 4. Color roles.
  const hinted: Partial<Record<ColorRole, Hex>> = {};
  for (const [name, raw] of [...rootVars, ...vars]) {
    const role = roleFromTokenName(name);
    if (!role || hinted[role]) continue;
    const hex = colorFromVarValue(resolveVars(raw, vars));
    if (hex && isOpaque(hex)) hinted[role] = hex.slice(0, 7);
  }
  const hintHits = Object.keys(hinted).length;
  const clusters = colors.clusters();
  const primaryBtn = components.button?.variants.primary;
  const roles = inferRoles({
    clusters, hinted, rootBg, rootText, themeColor: insights.themeColor,
    buttonBg: pickColor(primaryBtn?.['background-color'] ?? primaryBtn?.background ?? components.button?.base['background-color'] ?? components.button?.base.background),
    buttonText: pickColor(primaryBtn?.color ?? components.button?.base.color),
  });
  const palette = toPalette(clusters);

  // 5. Typography.
  // Prefer stacks that start with a web font the site loads (Google link or @font-face) over generic resets like `html { font-family: system-ui }`.
  const loaded = new Set([...faceFamilies.keys()].map((f) => f.toLowerCase()));
  for (const link of insights.fontLinks) for (const m of link.matchAll(/family=([^:&]+)/g)) loaded.add(decodeURIComponent(m[1]).replace(/\+/g, ' ').toLowerCase());
  const firstName = (stack: string) => stack.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  const loadedStack = (m: Map<string, number>) => [...m].filter(([f]) => loaded.has(firstName(f))).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topFace = topKey(faceFamilies);
  const sans = loadedStack(families) ?? (topFace ? `'${topFace}', system-ui, sans-serif` : undefined) ?? rootFamily ?? topKey(families);
  const heading = loadedStack(headingFamilies) ?? sans;
  const scale = buildTypeScale(bodySize ?? modeIn(sizeHist, 14, 18) ?? 16, bodyLine, headingSize, headingWeight, headingLine, sizeHist);
  const fontSources = [...insights.fontLinks, ...cssImports.filter((u) => /fonts\.googleapis\.com\/css/.test(u))];
  // Self-hosted fonts can't load in sandboxed previews; request the same family from Google Fonts (a 400 there is harmless).
  if (!fontSources.length && sans && loaded.has(firstName(sans))) {
    const fam = sans.split(',')[0].replace(/["']/g, '').trim();
    fontSources.push(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`);
  }

  // 6. Spacing / radius / shadow / breakpoints / layout.
  const spacingOut = buildSpacing(spacing);
  const radiusOut = buildRadius(radii);
  const shadowOut = buildShadows(shadows);
  const breakpoints = buildBreakpoints(mediaQueries);
  const maxWidth = topKey(containerWidths);
  const gutter = topKey(gutters);

  // 7. Patterns.
  const interactions = [...insights.features];
  if (hoverRules) interactions.push(`hover states (${hoverRules} rules)`);
  if (focusVisible) interactions.push('focus-visible styles');
  if (transitionRules) interactions.push('CSS transitions');
  if (keyframes) interactions.push(`keyframe animations (${keyframes})`);
  if (stickyNav) interactions.push('sticky header');
  if (insights.navigation.hasMobileMenu) interactions.push('mobile menu toggle');

  // 8. Confidence + notes.
  const evidence = [
    clusters.length >= 3, !!sans, sizeHist.size >= 4, spacing.size >= 5, radii.size > 0 || fullRadius > 0,
    shadows.size > 0, Object.values(components).filter((c) => c?.found).length >= 3, hintHits >= 2,
  ];
  const confidence = Math.round((evidence.filter(Boolean).length / evidence.length) * 100) / 100;
  if (cssBytes < 3000 && insights.scriptCount > 5) {
    notes.push('Little CSS was found but the page loads many scripts — it may be client-rendered (CSS-in-JS). Static analysis cannot run JavaScript; results lean on defaults.');
  }
  if (!src.css.length) notes.push('No stylesheets could be read.');
  if (hintHits) notes.push(`${hintHits} color roles came from named CSS custom properties.`);

  const draft: DesignSystemDraft = {
    meta: {
      name: insights.title,
      description: insights.description || undefined,
      source: { type: 'url', ref: src.url, extractedAt: new Date().toISOString() },
      confidence,
      notes,
    },
    color: { roles, palette },
    typography: {
      families: { sans: sans ?? '', heading: heading ?? '', mono: topKey(monoFamilies) ?? '' },
      fontSources: [...new Set(fontSources)],
      scale,
      weights: [...weights.keys()].sort((a, b) => a - b),
    },
    spacing: spacingOut,
    radius: radiusOut,
    shadow: shadowOut,
    breakpoints,
    layout: { ...(maxWidth ? { maxWidth } : {}), ...(gutter ? { gutter } : {}) },
    components,
    patterns: { navigation: { ...insights.navigation, sticky: stickyNav }, interactions },
  };
  return completeDesignSystem(draft);
}

// ------------------------------------------------------------- builders ---

function pickColor(v?: string): Hex | null {
  if (!v) return null;
  const m = v.match(COLOR_RE);
  COLOR_RE.lastIndex = 0;
  return m ? normalizeColor(m[0])?.slice(0, 7) ?? null : null;
}

function cleanFamily(v: string): string | null {
  const parts = v.split(',').map((p) => p.trim().replace(/^["']|["']$/g, '')).filter((p) => p && !/^(inherit|initial|unset|var\()/.test(p));
  if (!parts.length) return null;
  const quoted = parts.slice(0, 4).map((p) => (/\s/.test(p) && !/^(system-ui|sans-serif|serif|monospace)$/.test(p) ? `'${p}'` : p));
  if (!/sans-serif|serif|monospace|system-ui/.test(quoted.join(','))) quoted.push('sans-serif');
  return quoted.join(', ');
}

function collapsePadding(o: Record<string, string>) {
  const [t, r, b, l] = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].map((k) => o[k]);
  if (!o.padding && t && r && b && l) o.padding = t === b && r === l ? `${t} ${r}` : `${t} ${r} ${b} ${l}`;
  if (!o.padding && o['padding-block'] && o['padding-inline']) o.padding = `${o['padding-block']} ${o['padding-inline']}`;
  for (const k of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-block', 'padding-inline']) if (o.padding) delete o[k];
}

function modeIn(hist: Map<number, number>, lo: number, hi: number): number | undefined {
  let best: number | undefined, n = 0;
  for (const [k, v] of hist) if (k >= lo && k <= hi && v > n) { best = k; n = v; }
  return best;
}

function buildTypeScale(
  base: number, bodyLine: number | null,
  hSize: Map<number, number>[], hWeight: Map<number, number>[], hLine: Map<number, number>[],
  hist: Map<number, number>,
): Partial<Record<TypeStep, TypeStyle>> {
  const sizes = [...hist.keys()].sort((a, b) => a - b);
  const below = sizes.filter((s) => s < base && s >= 10).reverse();
  const out: Partial<Record<TypeStep, TypeStyle>> = {};
  const lh = (size: number, fallback: number) => Math.round(Math.max(1, Math.min(1.8, fallback - (size - 16) * 0.012)) * 100) / 100;
  out.base = { size: base, lineHeight: bodyLine ? Math.round(bodyLine * 100) / 100 : 1.5, weight: 400 };
  const closest = (cands: number[], target: number, maxGap: number) =>
    cands.filter((s) => Math.abs(s - target) <= maxGap).sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || (hist.get(b) ?? 0) - (hist.get(a) ?? 0))[0];
  const sm = closest(below, round(base * 0.875), 2) ?? round(base * 0.875);
  out.sm = { size: sm, lineHeight: 1.43, weight: 400 };
  const xs = closest(below.filter((s) => s < sm), round(base * 0.75), 2) ?? Math.max(10, round(base * 0.75));
  out.xs = { size: xs, lineHeight: 1.33, weight: 400 };
  const fromHeading = (level: number, step: TypeStep, ratio: number, weight: number) => {
    const size = topKey(hSize[level]) ?? round(base * ratio);
    out[step] = { size, lineHeight: topKey(hLine[level]) ?? lh(size, 1.5), weight: topKey(hWeight[level]) ?? weight };
  };
  fromHeading(5, 'lg', 1.125, 500);
  fromHeading(4, 'xl', 1.25, 600);
  fromHeading(3, '2xl', 1.5, 600);
  fromHeading(2, '3xl', 1.875, 700);
  fromHeading(1, '4xl', 2.25, 700);
  // Enforce a strictly increasing scale.
  let prev = 0;
  for (const step of TYPE_STEPS) {
    const t = out[step]!;
    if (t.size <= prev) t.size = round(prev * 1.12) || prev + 2;
    prev = t.size;
  }
  return out;
}

function buildSpacing(hist: Map<number, number>): { base: number; scale: number[] } | undefined {
  const total = [...hist.values()].reduce((a, b) => a + b, 0);
  if (total < 8) return undefined;
  const share = (d: number) => [...hist].reduce((n, [v, c]) => n + (v % d === 0 ? c : 0), 0) / total;
  const base = share(8) >= 0.75 ? 8 : share(4) >= 0.55 ? 4 : share(5) >= 0.55 ? 5 : 4;
  const common = [...hist].filter(([v, c]) => c >= 2 && (v % base === 0 || v < base)).sort((a, b) => b[1] - a[1]).slice(0, 13).map(([v]) => v);
  // Observed values, topped up with the standard multiples of the base unit so the scale has no holes.
  const standard = [1, 2, 3, 4, 6, 8, 10, 12, 16].map((m) => m * base);
  const scale = [...new Set([0, ...common, ...standard])].filter((v) => v <= 128).sort((a, b) => a - b);
  return { base, scale };
}

function buildRadius(hist: Map<number, number>): Partial<DesignSystem['radius']> | undefined {
  if (!hist.size) return undefined;
  const top = [...hist].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const md = top[0][0];
  const vals = top.map(([v]) => v).sort((a, b) => a - b);
  if (vals.length === 1) return { sm: Math.max(2, round(md / 2)), md, lg: round(md * 1.5), xl: md * 2 };
  const lg = vals.find((v) => v > md) ?? round(md * 1.5);
  const largest = vals[vals.length - 1];
  return {
    sm: vals[0] < md ? vals[0] : Math.max(2, round(md / 2)),
    md,
    lg,
    xl: largest > lg ? largest : round(lg * 1.5),
  };
}

function buildShadows(hist: Map<string, number>): Partial<DesignSystem['shadow']> | undefined {
  const top = [...hist].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v]) => v);
  if (!top.length) return undefined;
  const blur = (s: string) => toPx(s.split(/\s+/).filter((t) => /^-?\d/.test(t))[2] ?? '0') ?? 0;
  const sorted = top.sort((a, b) => blur(a) - blur(b));
  return { sm: sorted[0], md: sorted[Math.floor((sorted.length - 1) / 2)], lg: sorted[sorted.length - 1] };
}

function buildBreakpoints(queries: string[]): Partial<DesignSystem['breakpoints']> {
  const hist = new Map<number, number>();
  for (const q of queries) for (const m of q.matchAll(/(min|max)-width\s*:\s*([\d.]+)(px|em|rem)/g)) {
    let px = parseFloat(m[2]) * (m[3] === 'px' ? 1 : 16);
    if (m[1] === 'max') px = Math.round(px + 1);
    bump(hist, round(px));
  }
  const pick = (lo: number, hi: number, target: number) => {
    const c = [...hist].filter(([v, n]) => v >= lo && v <= hi && n >= 1).sort((a, b) => b[1] - a[1] || Math.abs(a[0] - target) - Math.abs(b[0] - target));
    return c[0]?.[0];
  };
  const out: Partial<DesignSystem['breakpoints']> = {};
  const sm = pick(480, 700, 640), md = pick(701, 900, 768), lg = pick(901, 1150, 1024), xl = pick(1151, 1600, 1280);
  if (sm) out.sm = sm; if (md) out.md = md; if (lg) out.lg = lg; if (xl) out.xl = xl;
  return out;
}
