# Extraction methodology

The same procedure the engine in `src/extract/` implements. Follow it manually when you only have a fetch tool.

## Website

### 1. Collect sources (cheap)
1. Fetch `/robots.txt`; stop if the target path is disallowed for `*` (unless the user owns the site and says so).
2. Fetch the page HTML. Keep only: `<title>`, `og:site_name`, `meta[name=theme-color]`, `<link rel=stylesheet>` hrefs, Google Fonts links, inline `<style>` blocks, and the first `<nav>`/`<header>`.
3. Fetch up to ~20 stylesheets (and one level of `@import`). Skip font CSS hosts.
4. If almost no CSS comes back but the page loads many scripts, the site is client-rendered: note it, lower confidence, and continue with what you have.

### 2. Custom properties first (highest signal)
Collect `--*` declarations from `:root`, `html`, `body` (ignore `.dark`, `[data-theme=dark]`, `prefers-color-scheme: dark`). Resolve `var(--x, fallback)` chains. Names reveal roles:

| Name pattern (after `--`, any prefix) | Role |
|---|---|
| `primary-foreground`, `on-primary`, `primary-contrast` | onPrimary |
| `muted-foreground`, `text-muted`, `text-secondary` | textMuted |
| `text-primary`, `foreground`, `body-color`, `fg` | text |
| `bg-primary`, `background`, `body-bg`, `bg` | background |
| `border`, `border-color`, `border-default` | border |
| `primary`, `brand`, `primary-500` | primary |
| `secondary`, `accent` | secondary / accent |
| `surface`, `card`, `muted`, `bg-subtle` | surface |
| `success`, `warning`, `error`/`danger`/`destructive`, `info` | semantic |

Values like `222 47% 11%` (shadcn) are bare HSL channels; `37 99 235` are bare RGB channels.

### 3. Frequency tables
Walk every declaration once and count:

- **Colors** by usage: `background(-color)` → background, `color` → text, `border*`/`outline` → border, `fill`/`stroke` → fill. Weight +3 when the selector looks interactive (`button`, `.btn`, `.cta`, `[type=submit]`, `primary`), +2 for link text colors. Ignore alpha < 0.5. Merge colors closer than ~0.025 in OKLab.
- **Font families** (drop icon fonts), with root (`html/body`) and heading (`h1–h6`) votes.
- **Font sizes** in px (rem/em × 16; `clamp()` → largest length), body size from `body/p`, per-heading-level sizes, weights, line-heights.
- **Spacing**: every length in `margin*`, `padding*`, `gap` between 1 and 128px.
- **Radius**: first value of `border-radius`; `≥999px` or `50%` counts as "full".
- **Shadows**: `box-shadow` values (skip `none`/inset-only).
- **Breakpoints**: `min-width`/`max-width` in media queries (`max` → +1px).
- **Layout**: `max-width` 720–1920px on container-like selectors; their horizontal padding is the gutter.

### 4. Roles
1. Use named custom properties where they exist.
2. background = root background, else the most-used light background.
3. text = root text color, else the most-used text color with ≥4.5:1 contrast on background.
4. primary = the primary button's background if chromatic; else the chromatic color with the highest `4×interactive + 2×background + text` score (ignore pale tints and near-blacks: lightness 0.2–0.72); else `theme-color`; monochrome sites → the darkest interactive color.
5. onPrimary = the primary button's label color (if contrast ≥ 2), else white/near-black by contrast.
6. secondary / accent = next solid chromatic colors with a clearly different hue (> 25°) from primary.
7. textMuted = a neutral text color with 2.5–9:1 contrast; surface = a neutral background near (not equal to) background; border = the most-used neutral border color.
8. Semantic colors by hue among solid colors: success 90–170°, warning 30–58°, error 345–15°, info 190–235°.

### 5. Scales
- **Type**: base = body size (else most common 14–18px). sm ≈ base×0.875, xs ≈ base×0.75 (snap to observed sizes within 2px). lg/xl/2xl/3xl/4xl = h5/h4/h3/h2/h1 sizes, else ratios 1.125/1.25/1.5/1.875/2.25. Force strictly increasing.
- **Spacing**: base = 8 if ≥75% of values are multiples of 8, else 4. Scale = frequent observed values on that grid ∪ base × {1,2,3,4,6,8,10,12,16}.
- **Radius**: md = most frequent; sm = smallest; lg = next larger; xl = largest (or lg×1.5).
- **Shadows**: sort the top values by blur radius → sm / md / lg.
- **Breakpoints**: nearest observed values to 640 / 768 / 1024 / 1280.

### 6. Components and patterns
Classify each selector by its **last compound** (`.nav .btn` is a button):
button (`button`, `.btn*`, `.button*`, `[type=submit]`, `.cta`), input (`input`, `textarea`, `select`, `.form-control`, `.input`), card (`.card`, `.tile`, `.panel`), badge (`.badge`, `.tag`, `.chip`, `.pill`), modal, avatar, nav (`nav`, `.navbar`, `header`), link (`a`).
Pseudo-classes give **states** (`:hover`, `:focus(-visible)`, `:active`, `:disabled`/`.disabled`). Class suffixes give **variants** (`.btn-primary`, `.btn--outline`, `.is-ghost`; ignore sizes like `-sm`/`-lg`). Weight class selectors above bare-element resets; skip `0`/`none` from element-only rules.
Navigation: topbar vs sidebar, sticky (`position: sticky|fixed` on nav/header), mobile menu (hamburger/toggler/`aria-controls`), search (`type=search`, `role=search`), first 8 link labels. Interactions: hover rules, transitions, keyframes, dropdowns, carousels, accordions, tabs, modals.

### 7. Confidence
Score one point each for: ≥3 colors, a font family, ≥4 font sizes, ≥5 spacing values, any radius, any shadow, ≥3 component types, ≥2 role names from custom properties. confidence = points / 8.

## Figma

1. `GET https://api.figma.com/v1/files/:key?geometry=omit` with header `X-Figma-Token` (or `/nodes?ids=<node-id>` for one frame — faster and focused). Try `GET /v1/files/:key/variables/local` (Enterprise only; 403 is normal elsewhere).
2. **Variables** (strongest): COLOR variables → roles by name (table above, `/` treated as `-`); FLOAT variables named radius/spacing → those scales.
3. **Named styles**: fill styles named "Brand/Primary", "Text/Primary", "Background/Default" map to roles; text styles named H1/Heading 1/Display, Body/Regular, Caption map to type steps.
4. **Layers** (skip `visible: false`): SOLID fills (TEXT → text usage, frames → background), strokes → border, `cornerRadius`, DROP_SHADOW effects → `x y blur spread rgba()`, auto-layout `itemSpacing` and paddings → spacing, TEXT style → families/sizes/weights/line-heights.
5. **Components**: COMPONENT_SET / COMPONENT names classify the type. Variant names `Variant=Primary, State=Hover` → `State` values become states, `Variant|Type|Style` values become variants. Read each member's fill, stroke, radius, padding, height, shadow and first text child's font.
6. Frames ≥ 1024px wide suggest the layout max-width; frames < 500px suggest a mobile layout.
