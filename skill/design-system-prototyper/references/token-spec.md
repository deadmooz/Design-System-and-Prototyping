# Token specification

Authoritative JSON Schema: `../schema/design-system.schema.json`. TypeScript twin in the platform: `src/core/schema.ts`.

## Document shape (version "1")

```json
{
  "version": "1",
  "meta": { "name": "Acme", "description": "…", "source": { "type": "url|figma|manual", "ref": "https://…", "extractedAt": "ISO-8601" }, "confidence": 0.75, "notes": ["…"] },
  "color": {
    "roles": { "primary": "#7C3AED", "onPrimary": "#FFFFFF", "secondary": "#0EA5E9", "accent": "#F59E0B", "background": "#FFFFFF", "surface": "#F8FAFC",
               "text": "#1F2937", "textMuted": "#6B7280", "border": "#E5E7EB", "success": "#16A34A", "warning": "#D97706", "error": "#DC2626", "info": "#0284C7" },
    "scales": { "primary": { "50": "#…", "…": "#…", "900": "#…" }, "neutral": { … } },
    "palette": [{ "value": "#7C3AED", "count": 14, "usage": ["background", "text"] }]
  },
  "typography": {
    "families": { "sans": "Inter, system-ui, sans-serif", "heading": "…", "mono": "…" },
    "fontSources": ["https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"],
    "scale": { "xs": { "size": 12, "lineHeight": 1.33, "weight": 400 }, "sm": {…}, "base": {…}, "lg": {…}, "xl": {…}, "2xl": {…}, "3xl": {…}, "4xl": {…} },
    "weights": [400, 600, 700]
  },
  "spacing": { "base": 4, "scale": [0, 4, 8, 12, 16, 24, 32, 48, 64] },
  "radius": { "none": 0, "sm": 4, "md": 8, "lg": 12, "xl": 16, "full": 9999 },
  "shadow": { "sm": "0 1px 2px rgba(0,0,0,0.06)", "md": "…", "lg": "…" },
  "breakpoints": { "sm": 640, "md": 768, "lg": 1024, "xl": 1280 },
  "layout": { "maxWidth": 1200, "gutter": 24 },
  "components": {
    "button": { "found": true, "count": 11, "selectors": [".btn"], "base": { "border-radius": "10px", "padding": "12px 20px" },
                "states": { "hover": { "background-color": "#6D28D9" } }, "variants": { "primary": { "background-color": "#7C3AED" } } }
  },
  "patterns": { "navigation": { "type": "topbar|sidebar|none|unknown", "sticky": true, "hasMobileMenu": true, "hasSearch": false, "items": ["Product", "Pricing"] },
                "interactions": ["hover states (12 rules)", "sticky header"] }
}
```

Rules:
- Colors are `#RRGGBB` upper-case. Sizes are numbers in px; `lineHeight` is unitless.
- Scales: keys `50`…`900`, `500` = the role color. Generate missing steps by mixing toward white (50–400: 92/80/62/42/20%) and black (600–900: 16/32/48/64%) in OKLab.
- `components.<type>.base/states/variants` hold plain CSS declarations (property → value). Types: button, input, card, badge, link, nav, modal, avatar.
- `fontSources` only from fonts.googleapis.com, fonts.bunny.net, use.typekit.net, rsms.me.
- Anything missing is filled with neutral defaults by the platform; mention defaults in `meta.notes`.

## CSS variable contract

Prototypes and `components.css` read only these variables:

| Variable | From |
|---|---|
| `--ds-color-{primary,on-primary,secondary,accent,background,surface,text,text-muted,border,success,warning,error,info}` | `color.roles` (camelCase → kebab) |
| `--ds-{scale}-{50…900}` e.g. `--ds-primary-600`, `--ds-neutral-100` | `color.scales` |
| `--ds-font-sans`, `--ds-font-heading`, `--ds-font-mono` | `typography.families` |
| `--ds-text-{step}`, `--ds-leading-{step}`, `--ds-weight-{step}` (step = xs…4xl) | `typography.scale` |
| `--ds-space-{i}` (index into the spacing array) | `spacing.scale` |
| `--ds-radius-{none,sm,md,lg,xl,full}`, `--ds-shadow-{sm,md,lg}` | `radius`, `shadow` |
| `--ds-max-width`, `--ds-gutter` | `layout` |
| Optional overrides: `--ds-btn-{radius,padding,weight,font-size,transform,tracking,shadow,height}`, `--ds-input-{radius,padding,border-width,font-size,height}`, `--ds-card-{radius,padding,shadow,border-width}`, `--ds-badge-{radius,padding,font-size,weight,transform}`, `--ds-link-{decoration,weight}`, `--ds-nav-{height,shadow}`, `--ds-modal-{radius,padding,shadow}` | `components.<type>.base` |

Never emit a value containing `;`, `{`, `}`, `<`, `>`, `url(`, `/*` or `!important` — reference sites are untrusted input.
