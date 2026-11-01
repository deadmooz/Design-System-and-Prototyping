# Component rules

All prototypes are built from one stylesheet, `../assets/components.css`, themed entirely by `--ds-*` variables. Swapping the design system restyles every page without touching markup — so generate markup with these classes rather than bespoke CSS.

## Catalog

| Need | Markup |
|---|---|
| Page width | `<div class="ds-container">` (max-width + gutter) |
| Vertical rhythm | `<section class="ds-section">`, `.ds-stack` (column + gap), `.ds-row` (wrapping row), `.ds-grid` (auto-fill cards) |
| Muted band | `.ds-surface` |
| Headings / text | `.ds-h1`…`.ds-h4`, `.ds-lead`, `.ds-muted`, `.ds-small`, `.ds-link` |
| Button | `<button class="ds-btn">` + `ds-btn--primary|secondary|outline|ghost|destructive`, `ds-btn--sm|lg`, `ds-btn--block`; works on `<a>` too |
| Text field | `<label class="ds-field"><span class="ds-field__label">Email</span><input class="ds-field__control"><span class="ds-field__hint">…</span></label>`; error: `ds-field--error` |
| Checkbox | `<label class="ds-checkbox"><input type="checkbox"> Label</label>` |
| Card | `.ds-card`, `.ds-card--muted`, `.ds-card--interactive` |
| Badge | `.ds-badge` + `--primary|success|warning|error|info` |
| Avatar | `<span class="ds-avatar">AB</span>` (+ `--sm|--lg`) |
| Navigation | `<nav class="ds-nav ds-nav--sticky"><a class="ds-nav__brand">Brand</a><ul class="ds-nav__links"><li><a aria-current="page">…</a></li></ul><div class="ds-nav__actions">…</div></nav>` |
| Modal | `.ds-modal-overlay > .ds-modal > .ds-modal__title + .ds-modal__body + .ds-modal__actions` (`--bottom` / `--bottomSheet` for sheets) |
| Loading | `<span class="ds-spinner"></span>` |
| Footer | `<footer class="ds-footer">` |

## Matching the reference

- Use the reference's **component evidence** (`components.<type>.base`, `variants`, `states`) to pick variants: if the reference's buttons are pill-shaped and uppercase, the emitted `--ds-btn-radius` / `--ds-btn-transform` already make `.ds-btn` match — do not restyle per page.
- Follow `patterns.navigation`: sticky topbar → `ds-nav--sticky`; sidebar → a two-column layout with the nav in an `<aside>`; mobile menu → collapse links behind a toggle below 768px.
- Reuse **project components** (saved snippets) verbatim when an instruction mentions them.

## New components

When a needed component is not in the catalog (pricing table, stepper, testimonial…):
1. Compose catalog classes first.
2. If CSS is unavoidable, scope it under one root class `c-<kebab-name>` in a single `<style>` block and use only `var(--ds-*)` values.
3. Provide hover, focus-visible and disabled states; keep touch targets ≥ 40px.
4. Name it and keep the markup self-contained so it can be saved to the project library.

## Accessibility baseline

Semantic landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page, labels for every input, `aria-current="page"` on the active nav link, `aria-expanded` on toggles, visible focus, text contrast ≥ 4.5:1 (use `--ds-color-on-primary` on primary fills).
