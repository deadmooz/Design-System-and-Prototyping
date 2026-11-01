/**
 * Minimal, forgiving CSS parser: enough structure for token extraction
 * (selectors, declarations, @media context, @font-face, @import, custom
 * properties) without a dependency. Malformed input never throws.
 */

export interface CssRule {
  selector: string;
  decls: [prop: string, value: string][];
  media?: string;
}

export interface ParsedCss {
  rules: CssRule[];
  fontFaces: Record<string, string>[];
  imports: string[];
  mediaQueries: string[];
  keyframes: number;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Index of the brace that closes the block opened at `open`, respecting strings. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const end = css.indexOf(c, i + 1);
      i = end < 0 ? css.length : end;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return css.length;
}

export function parseDeclarations(block: string): [string, string][] {
  const out: [string, string][] = [];
  // Split on semicolons that are not inside parentheses or strings.
  let depth = 0, quote = '', start = 0;
  const push = (end: number) => {
    const part = block.slice(start, end);
    const colon = part.indexOf(':');
    if (colon > 0) {
      const prop = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).replace(/!important/i, '').trim();
      if (prop && value && /^-{0,2}[a-z][\w-]*$/.test(prop)) out.push([prop, value]);
    }
    start = end + 1;
  };
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (quote) { if (c === quote && block[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) push(i);
  }
  push(block.length);
  return out;
}

export function parseCss(input: string): ParsedCss {
  const css = stripComments(input);
  const result: ParsedCss = { rules: [], fontFaces: [], imports: [], mediaQueries: [], keyframes: 0 };
  walk(css, undefined, result);
  return result;
}

function walk(css: string, media: string | undefined, out: ParsedCss) {
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    // Statement at-rules (@import, @charset) end with ';' before any '{'.
    if (semi >= 0 && (brace < 0 || semi < brace) && /^\s*@/.test(css.slice(i, semi))) {
      const stmt = css.slice(i, semi).trim();
      const imp = stmt.match(/^@import\s+(?:url\()?\s*['"]?([^'")\s]+)['"]?/i);
      if (imp) out.imports.push(imp[1]);
      i = semi + 1;
      continue;
    }
    if (brace < 0) break;
    const prelude = css.slice(i, brace).trim();
    const close = matchBrace(css, brace);
    const body = css.slice(brace + 1, close);
    i = close + 1;
    if (!prelude) continue;

    if (prelude[0] === '@') {
      const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
      if (name === 'media') {
        const q = prelude.slice(6).trim();
        out.mediaQueries.push(q);
        walk(body, media ? `${media} and ${q}` : q, out);
      } else if (name === 'supports' || name === 'layer' || name === 'container' || name === 'scope' || name === 'document') {
        walk(body, media, out);
      } else if (name === 'font-face') {
        out.fontFaces.push(Object.fromEntries(parseDeclarations(body)));
      } else if (name.endsWith('keyframes')) {
        out.keyframes++;
      }
      continue;
    }
    // CSS nesting: split own declarations from nested rules.
    if (body.includes('{')) {
      const own = body.replace(/[^;{}]*\{[^{}]*\}/g, '');
      const decls = parseDeclarations(own);
      if (decls.length) out.rules.push({ selector: prelude, decls, media });
      for (const m of body.matchAll(/([^;{}]+)\{([^{}]*)\}/g)) {
        const child = m[1].trim();
        const sel = child.includes('&') ? child.replace(/&/g, prelude) : `${prelude} ${child}`;
        out.rules.push({ selector: sel, decls: parseDeclarations(m[2]), media });
      }
      continue;
    }
    out.rules.push({ selector: prelude, decls: parseDeclarations(body), media });
  }
}

/** Converts a CSS length to px (rem/em assume 16px). Returns null for %, vw, auto, etc. */
export function toPx(value: string, rootPx = 16): number | null {
  const v = value.trim().toLowerCase();
  if (v === '0') return 0;
  const m = v.match(/^(-?\d*\.?\d+)(px|rem|em|pt)?$/);
  if (!m) {
    // clamp(min, preferred, max) / min() / max(): use the largest absolute length.
    const fn = v.match(/^(?:clamp|min|max)\((.*)\)$/);
    if (fn) {
      const lens = [...fn[1].matchAll(/(-?\d*\.?\d+)(px|rem|em)/g)].map((x) => toPx(x[0], rootPx)).filter((n): n is number => n !== null);
      return lens.length ? Math.max(...lens) : null;
    }
    return null;
  }
  const n = parseFloat(m[1]);
  const unit = m[2] ?? (n === 0 ? 'px' : '');
  if (unit === 'px') return n;
  if (unit === 'rem' || unit === 'em') return n * rootPx;
  if (unit === 'pt') return (n * 4) / 3;
  return null;
}
