# Architecture & decisions

## Shape

```
          ┌──────────── AI Skill (portable Markdown) ────────────┐
          │ methodology · token spec · component rules · workflow │
          └───────────────┬───────────────────────────────────────┘
                          │ same design-system.json + components.css
┌─────────────────────────▼───────────────────────────────────────────┐
│ Workspace (browser, vanilla ESM)                                    │
│  import · tokens editor · component gallery · prototype chat/preview│
│  imports src/core + src/prototype/render.ts directly (type-stripped)│
└─────────────────────────┬───────────────────────────────────────────┘
                          │ JSON over same-origin HTTP
┌─────────────────────────▼───────────────────────────────────────────┐
│ Server (node:http)  /api/extract/* · /api/refine · /api/generate    │
│   extract/web  extract/figma  prototype/generate  llm/registry      │
└──────────────┬───────────────────────────────┬──────────────────────┘
               │ fetch (SSRF-guarded)          │ provider adapters
         websites · Figma REST          Claude · OpenAI · Gemini · xAI · mock
```

## Decisions

| Decision | Why |
|---|---|
| **No runtime dependencies**; Node's native TypeScript | Smaller attack surface, nothing to keep patched, no build step. Node ≥ 22.18 runs `.ts` directly; the server type-strips shared modules for the browser with `module.stripTypeScriptTypes`. |
| **Deterministic extraction first, LLM optional** | Measuring CSS is free and reproducible; an LLM only adds value for judgement calls (role naming), so refinement is opt-in and sends ~600 tokens of statistics, never the page. |
| **Static HTML + CSS analysis, no headless browser** | Playwright/Chromium would add ~300 MB and a large attack surface. Trade-off: client-rendered sites extract less → surfaced via `meta.confidence` and notes. A headless fetcher can be added behind `fetchPage()` later without touching analysis. |
| **One component stylesheet themed by variables** | LLMs write short markup with known classes instead of bespoke CSS (fewer output tokens, consistent results), and editing a token restyles every prototype instantly. Reference-specific styling flows through optional component variables (`--ds-btn-radius` …). |
| **Provider interface + thin fetch adapters** (no vendor SDKs) | Keeps providers interchangeable and dependency-free. xAI reuses the OpenAI-compatible adapter. A mock provider makes development and tests free. |
| **Stable, cacheable system prompt** | Rules + catalog + design-system summary are identical across a project's iterations, so providers can cache the prefix (Anthropic via an explicit `cache_control` marker, OpenAI and Gemini automatically). The user turn carries only the current page and instruction. |
| **Browser storage only as convenience** | The workspace is single-user and local; projects are exported/imported as files for durability and sharing. |
| **Security layers** | SSRF guard (scheme, credentials, private ranges, each redirect hop, size/time caps), robots.txt by default, explicit authorization flag on every extraction, CSRF guard (same-origin + JSON content type), static allow-list, CSS value sanitizer, HTML sanitizer, sandboxed iframes with CSP `connect-src 'none'`, keys only in env, server bound to 127.0.0.1 by default. |

## Extending

- **New provider**: add `src/llm/providers/<name>.ts` implementing `LLMProvider`, register it in `registry.ts`, add its env key to `.env.example`, add a fake-fetch test in `test/llm.test.ts`.
- **New component type**: add it to `COMPONENT_TYPES` (`schema.ts`), a matcher in `web/analyze.ts` and `figma/analyze.ts`, variables in `emit.ts` `COMPONENT_VARS`, classes in `components.css`, the catalog in `prompts.ts`, and the skill's `component-rules.md` + schema.
- **New export format**: add a function in `emit.ts` and a case in `exportDesignSystem`.
- **JS-rendered sites**: implement an alternative `fetchPage()` (e.g. a headless browser service) returning the same `{url, html, css}` shape.
