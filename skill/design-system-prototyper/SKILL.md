---
name: design-system-prototyper
description: Extract a reusable design system (colors, typography, spacing, radii, shadows, components, navigation and interaction patterns) from a website URL or a Figma file the user owns or is authorized to use, then build multi-page HTML prototypes from it through conversational instructions. Use when the user wants to replicate a site's or Figma file's look as design tokens, generate pages or components "in the style of" a reference, or iterate on a prototype with an existing design system.
---

# Design System Prototyper

Two phases. **Extract** turns a reference into a `design-system.json` (schema: `schema/design-system.schema.json`). **Prototype** turns that JSON plus natural-language instructions into HTML pages built on one shared component stylesheet (`assets/components.css`). Both phases produce files the DS Studio workspace imports directly (Import → JSON file).

## Ground rules

1. **Authorization first.** Before extracting, confirm the user owns the reference or is authorized to use it. Extract design *tokens and patterns* only — never copy logos, trademarks, copy text, images, or proprietary assets. If the user declines or is unsure, stop.
2. **Respect robots.txt** and site terms; never bypass logins, paywalls or bot protection.
3. **Heuristics before LLM reasoning.** Count and measure first; only use judgement for what numbers cannot settle (which color is "primary"). Never guess values you could measure.
4. **Spend tokens carefully.** Read stylesheets, not whole pages of markup. When prototyping, send the compact design-system summary, the page list and the *current* page only — never the full palette or other pages' HTML.
5. **Say what is inferred.** Record a `meta.confidence` (0–1) and `meta.notes` for anything defaulted or uncertain.

## Phase 1 — Extract

Choose the path that matches your tools:

- **This repo is available** (shell access): run the deterministic engine, no LLM cost:
  `node src/cli.ts extract <url> --authorized --out ds.json` or `node src/cli.ts figma <figma-url> --authorized --token $FIGMA_TOKEN --out ds.json`.
  Then review `meta.notes`, fix anything implausible, and continue to Phase 2.
- **Web fetch only**: follow `references/extraction-methodology.md` step by step (HTML → stylesheets → custom properties → frequency tables → roles) and write JSON matching `references/token-spec.md`.
- **Figma**: use the Figma REST API or a Figma MCP/tool if available; methodology section "Figma" covers styles, variables, auto-layout and component sets.

Validate before handing over: every color is `#RRGGBB`, text/background contrast ≥ 4.5:1 (note it if the reference itself fails), the type scale strictly increases, spacing is sorted.

## Phase 2 — Prototype

Follow `references/prototyping-workflow.md`. In short:

1. Emit tokens as CSS variables (`--ds-*`, see `references/token-spec.md` → "CSS variable contract"), or run `node src/cli.ts emit ds.json --format css`.
2. Build pages from the classes in `references/component-rules.md` (`ds-btn`, `ds-card`, `ds-field`, `ds-nav`, …). Never hard-code a value a token covers.
3. One page per request; links between pages use `href="#/<page-id>"`.
4. For edits, return the complete updated page and preserve everything not mentioned.
5. Package: one standalone HTML file with tokens + `assets/components.css` inlined (see workflow → "Packaging"), or hand the JSON and pages to the workspace.

## Output checklist

- [ ] Authorization confirmed and recorded in the conversation
- [ ] `design-system.json` validates against the schema; notes explain defaults
- [ ] Pages use only `ds-*` classes / `var(--ds-*)`; responsive at 375px and 1440px
- [ ] No external scripts, trackers, fonts outside Google Fonts / Bunny / Typekit, or copied brand assets
- [ ] Interactive bits (tabs, modals, menus) work with small inline scripts

References: `references/extraction-methodology.md`, `references/token-spec.md`, `references/component-rules.md`, `references/prototyping-workflow.md`, `references/implementation-guidelines.md`. Installing it in different AI tools: `PORTABILITY.md`.
