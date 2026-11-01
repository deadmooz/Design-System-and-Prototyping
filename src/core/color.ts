/** Color parsing, conversion, clustering and scale generation. No dependencies. */

import { SCALE_STEPS, type ColorScale, type Hex } from './schema.ts';

export interface RGBA { r: number; g: number; b: number; a: number } // r,g,b 0–255, a 0–1

const NAMED: Record<string, string> = {
  white: '#FFFFFF', black: '#000000', red: '#FF0000', green: '#008000', blue: '#0000FF',
  gray: '#808080', grey: '#808080', silver: '#C0C0C0', navy: '#000080', orange: '#FFA500',
  yellow: '#FFFF00', purple: '#800080', teal: '#008080', maroon: '#800000', olive: '#808000',
  whitesmoke: '#F5F5F5', gainsboro: '#DCDCDC', lightgray: '#D3D3D3', lightgrey: '#D3D3D3',
  darkgray: '#A9A9A9', darkgrey: '#A9A9A9', dimgray: '#696969', dimgrey: '#696969',
};

/** Matches color literals inside a CSS value. */
export const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?:rgba?|hsla?|oklch|oklab)\([^)]*\)|\b(?:white|black|red|green|blue|gr[ae]y|silver|navy|orange|yellow|purple|teal|maroon|olive|whitesmoke|gainsboro|light(?:gray|grey)|dark(?:gray|grey)|dim(?:gray|grey))\b/gi;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function channel(v: string, max: number): number {
  v = v.trim();
  return v.endsWith('%') ? (parseFloat(v) / 100) * max : parseFloat(v);
}

export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return parseColor(NAMED[s]);
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const ok = s.match(/^(oklch|oklab)\((.*)\)$/);
  if (ok) return parseOk(ok[1], ok[2]);
  const m = s.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (!m) return null;
  const parts = m[2].replace(/\s*\/\s*/, ',').split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3 || parts.some((p) => p.startsWith('var'))) return null;
  const a = parts[3] !== undefined ? clamp(channel(parts[3], 1), 0, 1) : 1;
  if (m[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => clamp(channel(p, 255), 0, 255));
    return [r, g, b].some(Number.isNaN) ? null : { r, g, b, a };
  }
  const hue = parseFloat(parts[0]);
  const sat = clamp(parseFloat(parts[1]), 0, 100) / 100;
  const lig = clamp(parseFloat(parts[2]), 0, 100) / 100;
  if ([hue, sat, lig].some(Number.isNaN)) return null;
  return { ...hslToRgb(hue, sat, lig), a };
}

function parseOk(kind: string, body: string): RGBA | null {
  const parts = body.replace(/\s*\/\s*/, ' / ').split(/[\s,]+/).filter(Boolean);
  const slash = parts.indexOf('/');
  const alpha = slash >= 0 ? clamp(channel(parts[slash + 1] ?? '1', 1), 0, 1) : 1;
  const [l, x, y] = parts.slice(0, 3);
  if (!l || !x || !y || [l, x, y].some((p) => p.startsWith('var') || p === 'none')) return null;
  const L = l.endsWith('%') ? parseFloat(l) / 100 : parseFloat(l);
  let A: number, B: number;
  if (kind === 'oklch') {
    const C = x.endsWith('%') ? (parseFloat(x) / 100) * 0.4 : parseFloat(x);
    const H = (parseFloat(y) * Math.PI) / 180;
    A = C * Math.cos(H); B = C * Math.sin(H);
  } else {
    A = x.endsWith('%') ? (parseFloat(x) / 100) * 0.4 : parseFloat(x);
    B = y.endsWith('%') ? (parseFloat(y) / 100) * 0.4 : parseFloat(y);
  }
  if ([L, A, B].some(Number.isNaN)) return null;
  const c = fromOklab([L, A, B]);
  return { r: clamp(c.r, 0, 255), g: clamp(c.g, 0, 255), b: clamp(c.b, 0, 255), a: alpha };
}

function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function toHex({ r, g, b, a }: RGBA): Hex {
  const hx = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return ('#' + hx(r) + hx(g) + hx(b) + (a < 1 ? hx(a * 255) : '')).toUpperCase();
}

/** Normalizes any CSS color literal to #RRGGBB(AA); null for unparseable / fully transparent. */
export function normalizeColor(input: string): Hex | null {
  const c = parseColor(input);
  if (!c || c.a === 0) return null;
  return toHex(c);
}

export function rgbToHsl({ r, g, b }: RGBA) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

// --- OKLab: perceptual distance + nicer mixing ---------------------------------
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const delin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function toOklab({ r, g, b }: RGBA): [number, number, number] {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: [number, number, number]): RGBA {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: delin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: delin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: delin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}

/** Perceptual distance; ~0.02 is barely noticeable, >0.1 clearly different. */
export function colorDistance(a: Hex, b: Hex): number {
  const [x, y] = [parseColor(a), parseColor(b)];
  if (!x || !y) return Infinity;
  const [p, q] = [toOklab(x), toOklab(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export function mix(a: Hex, b: Hex, t: number): Hex {
  const [p, q] = [toOklab(parseColor(a)!), toOklab(parseColor(b)!)];
  return toHex(fromOklab([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]));
}

/** 50–900 scale with `base` placed at 500. */
export function generateScale(base: Hex): ColorScale {
  const solid = base.slice(0, 7);
  const toWhite = [0.92, 0.8, 0.62, 0.42, 0.2];
  const toBlack = [0.16, 0.32, 0.48, 0.64];
  const out = {} as ColorScale;
  SCALE_STEPS.forEach((step, i) => {
    out[step] = i < 5 ? mix(solid, '#FFFFFF', toWhite[i]) : i === 5 ? solid.toUpperCase() : mix(solid, '#000000', toBlack[i - 6]);
  });
  return out;
}

export function luminance(hex: Hex): number {
  const c = parseColor(hex);
  if (!c) return 0;
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrastRatio(a: Hex, b: Hex): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Best readable text color on `bg` (white or a near-black). */
export function readableOn(bg: Hex, dark: Hex = '#111111'): Hex {
  return contrastRatio(bg, '#FFFFFF') >= contrastRatio(bg, dark) ? '#FFFFFF' : dark;
}

export function saturation(hex: Hex): number {
  const c = parseColor(hex);
  return c ? rgbToHsl(c).s : 0;
}

export function lightness(hex: Hex): number {
  const c = parseColor(hex);
  return c ? rgbToHsl(c).l : 0;
}

/** A color reads as "neutral" (grey-ish) when it has little chroma. */
export function isNeutral(hex: Hex): boolean {
  const c = parseColor(hex);
  if (!c) return true;
  const [, a, b] = toOklab(c);
  return Math.hypot(a, b) < 0.03;
}
