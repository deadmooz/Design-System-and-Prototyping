# Using the skill in different AI environments

The skill is plain Markdown + a JSON Schema + one CSS file, so any model that can read files (or accept long instructions) can use it. Its outputs (`design-system.json`, HTML pages) load into the DS Studio workspace.

| Environment | How to install |
|---|---|
| **Assistants that support Agent Skills** (`SKILL.md` folders) | Copy `skill/design-system-prototyper/` into the assistant's skills directory, or zip the folder and upload it as a custom skill. It triggers from its description, or ask for it by name. |
| **Anthropic API** | Attach the zipped folder through the Skills API, or send `SKILL.md` plus the reference you need as the system prompt. |
| **OpenAI — Custom GPT / Assistants / Responses** | Paste `SKILL.md` (without the front-matter) into the instructions; upload the `references/`, `schema/` and `assets/` files as knowledge/file-search files. Enable browsing or a fetch tool for website extraction. |
| **OpenAI Codex / agents reading AGENTS.md** | Add to `AGENTS.md`: "For design-system extraction or prototyping, follow `skill/design-system-prototyper/SKILL.md`." |
| **Google Gemini — Gems / AI Studio system instructions** | Paste `SKILL.md` as the Gem instructions and add the reference files as knowledge files; use URL context or a fetch tool for websites. |
| **Gemini CLI** | Reference the skill from `GEMINI.md` the same way as `AGENTS.md`. |
| **xAI Grok / other chat models** | Provide `SKILL.md` + the reference you need for the current phase as the system prompt (token-cheap: you rarely need all five references at once). |

## Phase-wise loading (saves tokens)

- Extraction: `SKILL.md` + `references/extraction-methodology.md` + `references/token-spec.md`.
- Prototyping: `SKILL.md` + `references/component-rules.md` + `references/prototyping-workflow.md`.
- Production hand-off: `references/implementation-guidelines.md`.

## Tool-less mode

If the environment cannot fetch URLs, ask the user to paste the page's stylesheet(s) or a Figma file's JSON export, then follow the same methodology.
