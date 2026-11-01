# Implementation guidelines

For turning a prototype into production code, or extending the platform.

## Using tokens in a codebase

- **Plain CSS**: `dsp emit ds.json --format css > tokens.css`, load it before `components.css`.
- **Tailwind**: `dsp emit ds.json --format tailwind > tailwind.config.js` — colors (scales + roles), fontFamily, fontSize, spacing, borderRadius, boxShadow, screens.
- **TypeScript / React Native**: `dsp emit ds.json --format ts` → `export const tokens = {…} as const`.
- **React**: the platform ships optional components (`Button`, `Input`, `Card`, `Badge`, `Avatar`, `Checkbox`, `Modal`, `Spinner`) that render the same `ds-*` classes.

Map prototype classes to production components one-to-one (`ds-btn--outline` → `<Button variant="outline">`). Variants are props, never ad-hoc classes or inline styles.

## Engineering rules

- Tokens are the single source of truth; regenerate emitted files instead of editing them.
- Treat everything from a reference site, Figma file or LLM as **untrusted**: validate JSON, reject CSS values with `; { } < > url( /* !important`, render generated pages in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) with a CSP that blocks network access.
- Server-side fetching needs SSRF protection: http(s) only, no credentials in URLs, block private/link-local/loopback ranges, re-check every redirect hop, cap size and time.
- API keys live in server environment variables only; never in the browser, URLs, logs or error messages.
- Keep LLM providers behind one interface (`complete({system, messages, maxTokens}) → {text, usage}`); adding a vendor is one adapter.
- Minimise LLM calls: deterministic extraction, cached extraction results, stable cacheable system prompts, one call per user instruction, mock provider for development and tests.

## Accessibility and responsiveness

Mobile-first; verify at 375px, 768px and 1440px. Contrast ≥ 4.5:1 for text (3:1 for large text and UI boundaries). Keyboard: every interactive element reachable, visible focus, Escape closes dialogs.
