/** Color statistics → semantic roles. Shared by the website and Figma analyzers. */

import {
  colorDistance, contrastRatio, isNeutral, lightness, normalizeColor, parseColor, rgbToHsl, saturation,
} from '../core/color.ts';
import type { ColorRole, ColorUsage, Hex, PaletteEntry } from '../core/schema.ts';

export interface ColorStat {
  hex: Hex;
  count: number;
  bg: number;
  text: number;
  border: number;
  /** Evidence the color is used on interactive elements (buttons, links). */
  action: number;
  usage: Set<ColorUsage>;
}

export class ColorCollector {
  stats = new Map<Hex, ColorStat>();

  add(raw: string | Hex, usage: ColorUsage, action = 0, weight = 1) {
    const c = parseColor(raw);
    if (!c || c.a < 0.5) return;
    const hex = normalizeColor(raw)!.slice(0, 7);
    const st = this.stats.get(hex) ?? { hex, count: 0, bg: 0, text: 0, border: 0, action: 0, usage: new Set() };
    st.count += weight; st.usage.add(usage); st.action += action;
    if (usage === 'background') st.bg += weight;
    if (usage === 'text') st.text += weight;
    if (usage === 'border') st.border += weight;
    this.stats.set(hex, st);
  }

  clusters(): ColorStat[] {
    const sorted = [...this.stats.values()].sort((a, b) => b.count - a.count);
    const out: ColorStat[] = [];
    for (const s of sorted) {
      const near = out.find((c) => colorDistance(c.hex, s.hex) < 0.025);
      if (near) {
        near.count += s.count; near.bg += s.bg; near.text += s.text; near.border += s.border; near.action += s.action;
        s.usage.forEach((u) => near.usage.add(u));
      } else out.push({ ...s, usage: new Set(s.usage) });
    }
    return out;
  }
}

/** Token names (CSS custom properties, Figma styles/variables) that reveal a role. */
const ROLE_HINTS: [RegExp, ColorRole][] = [
  // Whole-name matches only: component-scoped tokens (--tooltip-bg, --pay-text-color) must not become site roles.
  [/^(on-primary|primary-(foreground|fg|contrast|content|text|on)|on-brand(-default)?|text-on-(brand|primary)(-default)?)$/, 'onPrimary'],
  [/^(muted-foreground|text-(muted|secondary|subtle|light|tertiary)|fg-muted|body-secondary-color|content-secondary|(text-)?on-surface-(subtle|secondary|muted))$/, 'textMuted'],
  // "Text/Primary", "On surface" name the foreground, not the brand color.
  [/^(foreground|fg|text|text-(color|primary|default|base|main)|body-color|body-text|content-primary|on-background|(text-)?on-surface(-default)?)$/, 'text'],
  [/^(background|bg|body-bg|body-background|page-bg|background-(color|default|base|primary|main|page)|bg-(default|primary|base|page))$/, 'background'],
  [/^(surface|card|muted|surface-(default|primary|1)|background-surface(-default)?|bg-(subtle|muted|secondary|surface)|card-(bg|background))$/, 'surface'],
  [/^(border|border-(color|default|base|primary|main|subtle))$/, 'border'],
  [/^(primary|brand|primary-(color|500|600|default|base|main)|brand-(color|primary|default|500|600|main)|background-brand(-default)?)$/, 'primary'],
  [/^(secondary|brand-secondary)(-(color|500|default|base|main))?$/, 'secondary'],
  [/^(accent|brand-accent)(-(color|500|default|base))?$/, 'accent'],
  [/^(success|positive)(-(color|500|default|base))?$/, 'success'],
  [/^(warning|caution)(-(color|500|default|base))?$/, 'warning'],
  [/^(error|danger|destructive|negative|critical)(-(color|500|default|base))?$/, 'error'],
  [/^info(-(color|500|default|base))?$/, 'info'],
];

/** Design-system namespaces stripped before matching (Bootstrap --bs-, Tailwind v4 --color-, Material --md-sys-color-, …). */
const NAMESPACE = /^(?:md-sys-color|wp-preset-color|chakra-colors|mantine-color|colors?|clr|theme|bs|tw|ds|sys|semantic|tokens?)-/;

export function roleFromTokenName(name: string): ColorRole | undefined {
  let key = name.replace(/^--/, '').toLowerCase().replace(/[\s/._]+/g, '-').replace(/-+/g, '-');
  for (let i = 0; i < 2 && NAMESPACE.test(key); i++) key = key.replace(NAMESPACE, '');
  return ROLE_HINTS.find(([re]) => re.test(key))?.[1];
}

/** Translucent tokens (overlays, hover tints) describe effects, not a role's base color. */
export function isOpaque(hex: Hex): boolean {
  return hex.length === 7 || parseInt(hex.slice(7, 9), 16) >= 230;
}

export interface RoleEvidence {
  clusters: ColorStat[];
  hinted: Partial<Record<ColorRole, Hex>>;
  rootBg?: Hex | null;
  rootText?: Hex | null;
  buttonBg?: Hex | null;
  buttonText?: Hex | null;
  themeColor?: string | null;
}

export function inferRoles(ev: RoleEvidence): Partial<Record<ColorRole, Hex>> {
  const roles: Partial<Record<ColorRole, Hex>> = { ...ev.hinted };
  const { clusters } = ev;
  const chromatic = clusters.filter((c) => !isNeutral(c.hex) && saturation(c.hex) > 0.2);
  // Brand/semantic candidates: exclude pale tints (badge backgrounds, focus rings) and near-black shades.
  const solid = chromatic.filter((c) => { const l = lightness(c.hex); return l >= 0.2 && l <= 0.72; });
  const hue = (hex: Hex) => rgbToHsl(parseColor(hex)!).h;
  const hueGap = (a: Hex, b: Hex) => { const d = Math.abs(hue(a) - hue(b)) % 360; return Math.min(d, 360 - d); };
  const byBg = [...clusters].sort((a, b) => b.bg - a.bg);
  const byText = [...clusters].sort((a, b) => b.text - a.text);

  // The most-used background is the page background — light or dark (don't assume a light theme).
  roles.background ??= ev.rootBg ?? byBg.find((c) => c.bg > 0 && (isNeutral(c.hex) || saturation(c.hex) < 0.35))?.hex ?? byBg[0]?.hex;
  const bg = roles.background ?? '#FFFFFF';
  roles.text ??= ev.rootText ?? byText.find((c) => c.text > 0 && contrastRatio(c.hex, bg) >= 4.5)?.hex;

  if (!roles.primary) {
    const scored = (solid.length ? solid : chromatic).map((c) => ({ c, s: c.action * 4 + c.bg * 2 + c.text + c.count })).sort((a, b) => b.s - a.s);
    const theme = ev.themeColor ? normalizeColor(ev.themeColor)?.slice(0, 7) : undefined;
    roles.primary = (ev.buttonBg && !isNeutral(ev.buttonBg) ? ev.buttonBg : undefined) ?? scored[0]?.c.hex ?? theme ?? ev.buttonBg ?? undefined;
    if (!roles.primary) {
      // Monochrome sites: the darkest frequently-clicked color (e.g. black buttons).
      roles.primary = clusters.filter((c) => c.action > 0 && contrastRatio(c.hex, bg) > 4.5).sort((a, b) => b.action - a.action)[0]?.hex;
    }
  }
  // The reference's own button label color is a deliberate choice; keep it unless it is unreadable.
  if (!roles.onPrimary && ev.buttonText && roles.primary && contrastRatio(ev.buttonText, roles.primary) >= 2) roles.onPrimary = ev.buttonText;

  const distinct = (hex: Hex, others: (Hex | undefined)[]) => others.every((o) => !o || colorDistance(hex, o) > 0.12);
  const differentHue = (hex: Hex) => !roles.primary || hueGap(hex, roles.primary) > 25;
  roles.secondary ??= solid.find((c) => distinct(c.hex, [roles.primary]) && differentHue(c.hex))?.hex
    ?? clusters.find((c) => c.action > 0 && distinct(c.hex, [roles.primary, bg]))?.hex;
  roles.accent ??= solid.find((c) => distinct(c.hex, [roles.primary, roles.secondary]) && differentHue(c.hex))?.hex;
  const text = roles.text ?? '#111111';
  roles.textMuted ??= byText.find((c) => c.text > 0 && isNeutral(c.hex) && c.hex !== text && contrastRatio(c.hex, bg) > 2.5 && contrastRatio(c.hex, bg) < 9)?.hex;
  roles.surface ??= byBg.find((c) => c.bg > 0 && c.hex !== bg && isNeutral(c.hex) && colorDistance(c.hex, bg) < 0.12)?.hex;
  const borders = [...clusters].sort((a, b) => b.border - a.border).filter((c) => c.border > 0 && c.hex !== text);
  roles.border ??= (borders.find((c) => isNeutral(c.hex)) ?? borders[0])?.hex;

  const byHue = (lo: number, hi: number) => solid.find((c) => {
    if (roles.primary && colorDistance(c.hex, roles.primary) < 0.05) return false;
    const { h, s } = rgbToHsl(parseColor(c.hex)!);
    if (s < 0.35) return false;
    return lo < hi ? h >= lo && h <= hi : h >= lo || h <= hi;
  })?.hex;
  roles.success ??= byHue(90, 170);
  roles.warning ??= byHue(30, 58);
  roles.error ??= byHue(345, 15);
  roles.info ??= byHue(190, 235);

  // A hinted label color that is unreadable on the chosen primary is dropped; the completer then picks one by contrast.
  if (roles.onPrimary && roles.primary && contrastRatio(roles.onPrimary, roles.primary) < 2) delete roles.onPrimary;
  for (const k of Object.keys(roles) as ColorRole[]) if (!roles[k]) delete roles[k];
  return roles;
}

export function toPalette(clusters: ColorStat[], max = 24): PaletteEntry[] {
  return clusters.slice(0, max).map((c) => ({ value: c.hex, count: Math.round(c.count), usage: [...c.usage] }));
}
