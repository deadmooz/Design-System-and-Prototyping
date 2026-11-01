# PROJECT_MAP — Design System & Prototyping

> Orientation file for AI agents and new contributors. Read this first. Last mapped: 2026-10-31.

## 1. What this is

A generic platform that **extracts a design system** (tokens + component evidence + patterns) from a website URL or Figma file, then **generates prototypes** from it via natural language with any LLM provider. Two deliverables share one data format:

- **Skill** — `skill/design-system-prototyper/` (Markdown instructions, JSON Schema, components.css). Portable to Claude, OpenAI, Gemini and Grok models.
- **Workspace** — `workspace/` (vanilla ES modules, no build) served by `src/server/` (node:http, no framework).

Runtime: Node ≥ 22.18 executes `.ts` directly (type stripping). Only devDependencies exist (typescript, tsup, react types/libs for the optional React package). **No runtime dependencies.**

## 2. Directory tree

```
src/
  core/                 ★ pure, browser-safe (served to the workspace type-stripped)
    schema.ts           DesignSystem type — the central contract
    color.ts            parse (hex/rgb/hsl/oklch/named), OKLab distance & mix, scales, contrast
    defaults.ts         completeDesignSystem(draft) fills gaps; parseDesignSystem(untrusted) validates
    emit.ts             → CSS variables (--ds-*), Tailwind config, TS tokens, JSON; safeCssValue()
  extract/
    roles.ts            ColorCollector + inferRoles() + token-name → role hints (shared web/Figma)
    refine.ts           optional single LLM pass correcting roles (stats only, ~600 tokens; CLI --refine)
    ai.ts               AI modes: aiExtract (rules + evidence pack → full system), aiCreate (brief → system); aiToDraft validates model JSON
    web/fetch.ts        SSRF-guarded fetch, redirects re-checked, size/time caps, robots.txt, page+CSS collection
    web/css.ts          tolerant CSS parser (media, nesting, @font-face, @import) + toPx()
    web/html.ts         regex HTML insights: title, fonts, component counts, nav pattern, features
    web/analyze.ts      analyzeWebsite(): var resolution → frequency tables → roles/scales/components
    figma/client.ts     parseFigmaUrl(), REST fetch (file or node, variables when available)
    figma/analyze.ts    analyzeFigma(): styles, variables, layers, component sets → DesignSystem
  llm/
    types.ts            LLMProvider interface, CompletionRequest/Result, LLMError
    http.ts             postJson with one retry on 429/5xx; errors never include keys
    providers/          anthropic.ts, openai-compatible.ts (OpenAI + xAI), gemini.ts, mock.ts (offline)
    registry.ts         ProviderRegistry(env): builds providers, default selection, list() without secrets
  prototype/
    types.ts            PrototypePage, SavedComponent
    context.ts          summarizeDesignSystem() — compact LLM context
    prompts.ts          system rules + component catalog; buildUserMessage()
    sanitize.ts         extractHtml / sanitizeBody (browser-safe)
    render.ts           renderDocument() preview/export with CSP + router; renderComponentGallery()
    generate.ts         generate(provider, input) — one call per instruction (server-only)
  server/
    app.ts              createHandler(): /api/* routes, CSRF/content-type guards, URL cache, registry rebuilt on key change
    settings.ts         API-key settings: read/write .env (atomic, comments kept), validation, last-4 hints only
    static.ts           serves workspace/ + type-stripped src/core & src/prototype (allow-list, no traversal)
    index.ts            loads .env, listens on HOST:PORT (default 127.0.0.1:4310)
  styles/components.css generic component layer themed only by --ds-* vars (copied into the skill)
  react/                optional React bindings (Button, Input, Card, Badge, Avatar, Spinner, Checkbox, Modal)
  cli.ts                dsp extract | figma | emit | generate | providers | serve
workspace/
  index.html, app.js    shell, hash router (#import #tokens #components #prototype #settings), provider picker
  styles.css            workspace chrome (light/dark)
  lib/                  dom.js (h() helper), api.js, store.js (state + localStorage + project import/export)
  views/                import.js, tokens.js, components.js, prototype.js, settings.js (API keys)
skill/design-system-prototyper/
  SKILL.md              entry point (front-matter name/description)
  references/           extraction-methodology, token-spec, component-rules, prototyping-workflow, implementation-guidelines
  schema/               design-system.schema.json (JSON Schema 2020-12)
  assets/components.css copy of src/styles/components.css (npm run skill:sync; test enforces equality)
  PORTABILITY.md        install per environment (Agent Skills tools, OpenAI, Gemini, others)
test/                   node:test suites + fixtures (fictional site, Figma JSON); no network, no keys
scripts/sync-skill.ts   copies components.css into the skill
docs/                   ARCHITECTURE.md (design decisions and extension points)
```

## 3. Data flow

```
URL ──fetchPage──► {html, css[]} ──analyzeWebsite──┐
Figma URL ──fetchFigmaFile──► {file, variables} ──analyzeFigma──┤──► DesignSystem (JSON) ──► workspace / CLI / skill
JSON file ───────────────────────────────parseDesignSystem──┘          │
                                                                        ├─ emit → CSS vars / Tailwind / TS
                                                                        └─ generate(provider, {ds, page, instruction})
                                                                              └─ prompts → LLMProvider.complete → sanitize → page html
                                                                                    └─ renderDocument (sandboxed iframe / export file)
```

## 4. HTTP API (all JSON; POST needs `content-type: application/json`, same-origin)

| Route | Body | Returns |
|---|---|---|
| `GET /api/providers` | — | `{default, providers:[{id,label,defaultModel,configured}], figmaTokenConfigured}` |
| `POST /api/extract/url` | `{url, authorized:true, respectRobots?, ai?:{provider?,model?}}` | `{designSystem, cached}` or with `ai`: `{designSystem, usage, provider, model}` |
| `POST /api/extract/figma` | `{url, authorized:true, token?, ai?:{provider?,model?}}` | `{designSystem}` (+ `usage…` with `ai`) |
| `POST /api/create` | `{brief, name?, ai:{provider?,model?}}` | `{designSystem (source.type 'ai'), usage, provider, model}` |
| `POST /api/refine` | `{designSystem, provider?, model?}` | `{designSystem, usage}` |
| `POST /api/generate` | `{designSystem, kind:'page'|'component', instruction, pages, page, components?, history?, provider?, model?}` | `{html, provider, model, usage, truncated}` |
| `GET /api/settings` ¹ | — | `{providers:[{id,label,configured,source,keyHint,model,defaultModel,help}], defaultProvider, activeDefault}` |
| `POST /api/settings` ¹ | `{id, apiKey?, model?, remove?}` (id: anthropic/openai/gemini/xai/figma) | same as GET |
| `POST /api/settings/default` ¹ | `{provider}` | same as GET |
| `POST /api/settings/test` ¹ | `{provider}` — one ~20-token completion | `{ok, model, reply, usage}` |

¹ Loopback clients only. Full keys are never returned.

## 5. Invariants (easy to break)

- `src/core/*` and `src/prototype/{render,sanitize,prompts,context,types}.ts` must stay **browser-safe** (no `node:` imports) — the workspace imports them. `generate.ts` is server-only (blocked in `static.ts`).
- Use only **erasable TypeScript** (no enums, namespaces, parameter properties) and `.ts` import extensions; `tsconfig` enforces `erasableSyntaxOnly`.
- Every value from a reference site, Figma or an LLM is untrusted: go through `parseDesignSystem`, `safeCssValue`, `sanitizeBody`; previews render in `sandbox="allow-scripts"` iframes with a CSP (`connect-src 'none'`).
- API keys only via env (`.env`, gitignored). Never return them, log them, or put them in URLs.
- Adding a provider = one adapter in `src/llm/providers/` + one entry in `registry.ts`. Nothing else may branch on vendor.
- After editing `src/styles/components.css`, run `npm run skill:sync`.
- CSS class prefix `ds-`, variable prefix `--ds-`; the contract is documented in `skill/.../references/token-spec.md`.

## 6. Commands

```
npm start | npm run dev | npm test | npm run typecheck | npm run skill:sync | npm run build:react
node src/cli.ts <extract|figma|emit|generate|providers|serve>
```
