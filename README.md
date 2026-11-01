# Design System & Prototyping

Extract a reusable design system from a **website URL** or a **Figma file** you own, then build clickable, multi-page prototypes with it by talking to the LLM of your choice: **Claude, OpenAI, Gemini or Grok**.

The product has two parts that work together or alone:

| Part | What it is | Where |
|---|---|---|
| **AI Skill** | Portable instructions + schema + component stylesheet that teach any capable model the extraction methodology, token spec, component rules and prototyping workflow. | [`skill/design-system-prototyper/`](skill/design-system-prototyper/SKILL.md) |
| **Workspace (artifact)** | Local web app: import a reference, inspect and edit tokens, browse components, generate and iterate on prototypes in a live sandboxed preview. | [`workspace/`](workspace/) served by [`src/server/`](src/server/) |

Both read and write the same `design-system.json` ([schema](skill/design-system-prototyper/schema/design-system.schema.json)), so a system extracted by the skill in any AI assistant opens in the workspace, and vice versa.

## Quick start

Requires **Node.js 22.18+** (runs TypeScript natively — no build step).

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm start
```

Open http://127.0.0.1:4310. Without any API keys the built-in **offline mock provider** is used, so you can try everything at zero cost. Add keys to `.env` to enable real models.

## Workflow

1. **Import** a website URL or a Figma file/frame URL (+ personal access token), or load a JSON file. Confirm you own it or are authorized to use it. Choose **Rule-based** (free, instant) or — once an API key is added — **AI-assisted**: the rules measure first, then your chosen model reviews a compact evidence pack (palette counts, the site's CSS tokens, fonts, component CSS; never the page itself) to fix roles and fill in component states and variants (one request, ~3–5k tokens). Or use **✦ Create with AI** to design a brand-new system from a written brief (~2–4k tokens).
2. **Design system**: review roles, scales, palette, type scale, spacing, radius, shadows, breakpoints, components and patterns. Edit anything. Export **JSON / CSS variables / Tailwind config / TypeScript**.
3. **Components**: see the shared component layer rendered in your theme, inspect extracted component evidence (base / states / variants), and generate reusable project components with AI.
4. **Prototype**: add pages, describe them in the chat, refine conversationally, preview on mobile / tablet / desktop, follow links between pages, undo, edit HTML, and export the whole prototype as one standalone HTML file.

## CLI

```bash
node src/cli.ts extract https://your-site.com --authorized --out ds.json
node src/cli.ts extract https://your-site.com --authorized --ai --provider anthropic --out ds.json
node src/cli.ts create "Calm fintech brand, deep green, rounded, Inter" --provider anthropic --out ds.json
node src/cli.ts figma "https://www.figma.com/design/<key>/…?node-id=1-2" --authorized --out ds.json
node src/cli.ts emit ds.json --format tailwind --out tailwind.config.js
node src/cli.ts generate ds.json -i "Pricing page with three tiers" --provider openai --out pricing.html
node src/cli.ts providers
```

## LLM providers

| Provider | Env key | Default model (override with `*_MODEL`) |
|---|---|---|
| Offline mock | — | `mock-1` |
| Anthropic Claude | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5` |
| Google Gemini | `GEMINI_API_KEY` | `gemini-3.5-flash-lite` |
| xAI Grok | `XAI_API_KEY` | `grok-4` |

Add keys either in the workspace (**Settings** → paste key → Save; **Test key** sends one ~20-token request) or by editing `.env`. Keys saved in Settings are written to the server's `.env`, take effect immediately, and are only ever shown as their last 4 characters; key management is accepted only from the machine running the server. Pick the provider and (optionally) model in the workspace top bar. Keys never reach the browser. Model names change often — set `*_MODEL` in `.env` to whatever your account offers.

**Token efficiency**: extraction is deterministic (zero LLM calls unless you tick *Refine with AI*, one ~600-token call); extraction results are cached; prototype prompts send a ~300-token design-system summary plus only the page being edited; the system prompt is stable per project so provider prompt caching applies.

## Develop

```bash
npm test            # 49 tests, no network or API keys needed
npm run typecheck
npm run dev         # server with --watch
npm run skill:sync  # after editing src/styles/components.css
npm run build:react # optional React component package → dist/react
```

## Limits

- The URL extractor reads HTML and CSS; it does not execute JavaScript. Client-rendered (CSS-in-JS) sites yield less and get a low confidence score — edit tokens afterwards.
- The Figma Variables API is only available on some Figma plans; without it, styles and layers are used.
- Only extract designs you own or are authorized to use. The tool copies design tokens and patterns, not content, logos or assets, and honours robots.txt by default.

See [PROJECT_MAP.md](PROJECT_MAP.md) for a file-by-file map and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions.
