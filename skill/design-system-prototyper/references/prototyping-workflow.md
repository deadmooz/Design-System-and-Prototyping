# Prototyping workflow

## Context to give the model (keep it small)

Build a **design-system summary** once per project and keep it byte-identical across turns so provider prompt caches hit:

```
Design system: <name>
Colors: primary #…, onPrimary #…, … (13 roles)
Fonts: body <family>, headings <family>
Type (px/line-height/weight): xs 12/1.33/400, …, 4xl 48/1.1/800
Spacing scale px (index = --ds-space-N): 0 4 8 12 16 …
Radius px: sm 4, md 10, lg 16, xl 24, full 9999
Layout: max-width 1200px, gutter 24px, breakpoints 640/768/1024/1280
Reference component styling: button{border-radius: 10px; padding: 12px 20px; font-weight: 600} variants primary/outline | card{…}
Navigation: topbar, sticky, mobile menu
```

Put the fixed rules + component catalog + this summary in the **system prompt**. Each user turn carries only:

~~~
PAGES: home="Home", pricing="Pricing"
PAGE: pricing "Pricing"
PROJECT COMPONENTS (reuse their markup when relevant):   ← only if any, max 5, each ≤1500 chars
CURRENT HTML:                                            ← only the page being edited
```html
…
```
EARLIER REQUESTS FOR THIS PAGE:                          ← last 3 instructions, text only
- …
INSTRUCTION: <what the user asked>
~~~

This is ~800 input tokens for a new page — never include other pages' HTML or the full palette.

## Output contract

- Exactly one fenced ```html block, nothing else.
- Body markup only (no `<html>`, `<head>`, `<body>`).
- Catalog classes and `var(--ds-*)` only; optional single `<style>` at the top.
- Small inline `<script>` for interactions; no external scripts, no network requests.
- Inter-page links `href="#/<page-id>"`; other links `href="#"`.
- Images: inline SVG or CSS gradients — no external image URLs.
- Edits return the complete page, preserving unchanged parts.

## Iteration loop

1. **Create**: one instruction → one page. Suggest a starting point if the user is vague (landing, sign-in, dashboard, contact).
2. **Refine**: one change per turn works best ("make the hero two columns", "add an FAQ accordion"). Keep the page under ~40k characters; split long pages.
3. **Multi-page**: add a page per flow step; link them with `#/<id>`. A link to a missing id is a cue to create that page next.
4. **Components**: when a pattern repeats, generate it once as a project component and reference it by name.
5. **Undo** instead of re-prompting when a change goes wrong.

## Packaging

A shareable prototype is one HTML file:

```html
<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'">
<link rel="stylesheet" href="<fontSources…>">
<style>:root{ …--ds-* variables… } …contents of assets/components.css…</style>
</head><body class="ds">
<div id="app" data-home="home"></div>
<template data-page="home">…</template>
<template data-page="pricing">…</template>
<script>/* on hashchange: clone template[data-page=<id>] into #app and re-run its inline scripts */</script>
</body></html>
```

With the platform: `node src/cli.ts generate ds.json -i "<instruction>" --provider <id> --out page.html`, or use the workspace's **Export prototype** button (same renderer).
