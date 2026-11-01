#!/usr/bin/env node
/**
 * dsp — command-line access to the same engine the workspace uses.
 * Used directly, and by the AI skill (skill/design-system-prototyper) when an
 * agent has shell access.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseDesignSystem } from './core/defaults.ts';
import { exportDesignSystem, type ExportFormat } from './core/emit.ts';
import { extractFromFigma } from './extract/figma/index.ts';
import { refineWithLLM } from './extract/refine.ts';
import { aiCreate, aiExtract, cssTokenEvidence, type AiResult } from './extract/ai.ts';
import { analyzeWebsite } from './extract/web/analyze.ts';
import { fetchPage } from './extract/web/fetch.ts';
import { ProviderRegistry } from './llm/registry.ts';
import { generate } from './prototype/generate.ts';
import { renderDocument } from './prototype/render.ts';

const ROOT = resolve(import.meta.dirname, '..');
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const HELP = `dsp — Design System & Prototyping

  dsp extract <url>        --authorized [--out ds.json] [--no-robots] [--ai --provider <id>] [--refine --provider <id>]
  dsp figma <url|fileKey>  --authorized [--token <figma-pat>] [--out ds.json] [--ai --provider <id>]
  dsp create "<brief>"     --provider <id> [--name "My system"] [--out ds.json]   (AI builds a new system)
  dsp emit <ds.json>       --format css|tailwind|ts|json [--out file]
  dsp generate <ds.json>   --instruction "<text>" [--provider mock|anthropic|openai|gemini|xai] [--model m]
                           [--page-file current.html] [--out page.html]
  dsp providers            list providers and whether they are configured
  dsp serve                start the workspace (same as npm start)

--authorized confirms you own the reference design or are allowed to use it.
Extraction never calls an LLM unless you pass --ai (full AI review, ~3–5k tokens) or --refine (roles only, ~600 tokens).`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' }, format: { type: 'string', short: 'f' }, token: { type: 'string' },
    instruction: { type: 'string', short: 'i' }, provider: { type: 'string', short: 'p' }, model: { type: 'string', short: 'm' },
    'page-file': { type: 'string' }, authorized: { type: 'boolean' }, 'no-robots': { type: 'boolean' }, refine: { type: 'boolean' },
    ai: { type: 'boolean' }, name: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [cmd, arg] = positionals;
const write = (content: string, file?: string) => {
  if (file) { writeFileSync(file, content); console.error(`wrote ${file}`); } else process.stdout.write(content + '\n');
};
const loadDs = (file?: string) => {
  if (!file) throw new Error('Path to a design-system JSON file is required');
  return parseDesignSystem(JSON.parse(readFileSync(file, 'utf8')));
};
const report = (r: AiResult) => {
  console.error(`${r.provider}/${r.model}: ${r.usage.inputTokens} in, ${r.usage.outputTokens} out`);
  return r.ds;
};
const needAuth = () => {
  if (!o.authorized) throw new Error('Add --authorized to confirm you own this design or are allowed to use it.');
};

async function main() {
  const registry = new ProviderRegistry(process.env);
  switch (cmd) {
    case 'extract': {
      needAuth();
      if (!arg) throw new Error('URL is required');
      const page = await fetchPage(/^https?:\/\//.test(arg) ? arg : `https://${arg}`, {
        respectRobots: !o['no-robots'], allowPrivateNetwork: process.env.ALLOW_PRIVATE_NETWORK === 'true',
      });
      let ds = analyzeWebsite(page);
      if (o.ai) ds = report((await aiExtract(ds, registry.get(o.provider), { cssTokens: cssTokenEvidence(page) }, { model: o.model })));
      else if (o.refine) ds = (await refineWithLLM(ds, registry.get(o.provider), o.model)).ds;
      console.error(`${ds.meta.name}: confidence ${ds.meta.confidence}${ds.meta.notes.length ? '\n  ' + ds.meta.notes.join('\n  ') : ''}`);
      return write(JSON.stringify(ds, null, 2), o.out);
    }
    case 'figma': {
      needAuth();
      if (!arg) throw new Error('Figma URL or file key is required');
      let ds = await extractFromFigma(arg, o.token ?? process.env.FIGMA_TOKEN ?? '');
      if (o.ai) ds = report(await aiExtract(ds, registry.get(o.provider), {}, { model: o.model }));
      return write(JSON.stringify(ds, null, 2), o.out);
    }
    case 'create': {
      if (!arg) throw new Error('Describe the design system, e.g. dsp create "calm fintech brand, deep green, rounded"');
      const ds = report(await aiCreate(arg, registry.get(o.provider), { model: o.model, name: o.name }));
      return write(JSON.stringify(ds, null, 2), o.out);
    }
    case 'emit': {
      const { content } = exportDesignSystem(loadDs(arg), (o.format ?? 'css') as ExportFormat);
      return write(content, o.out);
    }
    case 'generate': {
      const ds = loadDs(arg);
      if (!o.instruction) throw new Error('--instruction is required');
      const current = o['page-file'] ? readFileSync(o['page-file'], 'utf8') : '';
      const page = { id: 'home', name: 'Home', html: current };
      const out = await generate(registry.get(o.provider), { ds, kind: 'page', instruction: o.instruction, pages: [page], page, model: o.model });
      console.error(`${out.provider}/${out.model}: ${out.usage.inputTokens} in, ${out.usage.outputTokens} out${out.truncated ? ' (truncated)' : ''}`);
      const css = readFileSync(resolve(ROOT, 'src/styles/components.css'), 'utf8');
      return write(renderDocument({ ds, pages: [{ ...page, html: out.html }], componentsCss: css, mode: 'export' }), o.out);
    }
    case 'providers':
      return console.table(registry.list());
    case 'serve':
      await import('./server/index.ts');
      return;
    default:
      console.log(HELP);
      if (cmd && cmd !== 'help' && !o.help) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
});
