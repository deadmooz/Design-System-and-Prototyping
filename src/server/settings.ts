/**
 * API-key settings for the workspace. Keys are written to the server's .env
 * file (gitignored) and into process.env; the browser only ever sees whether a
 * key is set and its last four characters.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DEFAULT_MODELS } from '../llm/registry.ts';
import type { ProviderId } from '../llm/types.ts';

/** Settings the workspace may change, and the env variables behind them. */
export const SETTINGS: Record<string, { label: string; keyVar: string; modelVar?: string; defaultModel?: string; help: string }> = {
  anthropic: { label: 'Anthropic Claude', keyVar: 'ANTHROPIC_API_KEY', modelVar: 'ANTHROPIC_MODEL', defaultModel: DEFAULT_MODELS.anthropic, help: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', keyVar: 'OPENAI_API_KEY', modelVar: 'OPENAI_MODEL', defaultModel: DEFAULT_MODELS.openai, help: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', keyVar: 'GEMINI_API_KEY', modelVar: 'GEMINI_MODEL', defaultModel: DEFAULT_MODELS.gemini, help: 'https://aistudio.google.com/apikey' },
  xai: { label: 'xAI Grok', keyVar: 'XAI_API_KEY', modelVar: 'XAI_MODEL', defaultModel: DEFAULT_MODELS.xai, help: 'https://console.x.ai' },
  figma: { label: 'Figma', keyVar: 'FIGMA_TOKEN', help: 'https://www.figma.com/settings (Security → Personal access tokens)' },
};

const SAFE_VALUE = /^[\x21-\x7E]{1,400}$/; // printable ASCII, no spaces, quotes are rejected below
const SAFE_MODEL = /^[A-Za-z0-9._:\/-]{1,100}$/;

export function readEnvFile(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out.set(m[1], m[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return out;
}

/** Sets (value) or removes (null) variables, keeping every other line and comment intact. Atomic write. */
export function writeEnvFile(path: string, changes: Record<string, string | null>) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(changes));
  const out: string[] = [];
  for (const line of lines) {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    if (key && pending.has(key)) {
      const v = pending.get(key);
      pending.delete(key);
      if (v !== null) out.push(`${key}=${v}`);
    } else out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of pending) if (v !== null) out.push(`${k}=${v}`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, out.join('\n') + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}

const hint = (v?: string) => (v ? `…${v.slice(-4)}` : null);

export interface SettingsView {
  id: string;
  label: string;
  help: string;
  configured: boolean;
  /** "saved" = in .env (editable here); "environment" = set outside .env (read-only here). */
  source: 'saved' | 'environment' | null;
  keyHint: string | null;
  model: string | null;
  defaultModel: string | null;
}

export function describeSettings(env: Record<string, string | undefined>, envFile: string) {
  const file = readEnvFile(envFile);
  const providers: SettingsView[] = Object.entries(SETTINGS).map(([id, s]) => {
    const value = env[s.keyVar];
    return {
      id, label: s.label, help: s.help,
      configured: Boolean(value),
      source: value ? (file.get(s.keyVar) === value ? 'saved' : 'environment') : null,
      keyHint: hint(value),
      model: s.modelVar ? env[s.modelVar] || null : null,
      defaultModel: s.defaultModel ?? null,
    };
  });
  return { providers, defaultProvider: env.DEFAULT_PROVIDER || 'mock' };
}

export interface SettingsUpdate {
  id: string;
  apiKey?: string;
  model?: string | null;
  remove?: boolean;
}

/** Validates and applies one provider's settings. Throws Error with a user-facing message. */
export function applySettings(update: SettingsUpdate, env: Record<string, string | undefined>, envFile: string) {
  const s = SETTINGS[update.id];
  if (!s) throw new Error(`Unknown setting "${update.id}"`);
  const changes: Record<string, string | null> = {};
  const file = readEnvFile(envFile);

  if (update.remove) {
    if (env[s.keyVar] && file.get(s.keyVar) !== env[s.keyVar]) {
      throw new Error(`${s.keyVar} is set in your system environment, not in .env — remove it there and restart.`);
    }
    changes[s.keyVar] = null;
  } else if (update.apiKey !== undefined) {
    const key = update.apiKey.trim();
    if (!SAFE_VALUE.test(key) || /["'`\\]/.test(key)) throw new Error('That does not look like an API key (no spaces or quotes, max 400 characters).');
    changes[s.keyVar] = key;
  }
  if (s.modelVar && update.model !== undefined) {
    const model = (update.model ?? '').trim();
    if (model && !SAFE_MODEL.test(model)) throw new Error('Model names may only contain letters, digits and . _ : / -');
    changes[s.modelVar] = model || null;
  }
  if (!Object.keys(changes).length) throw new Error('Nothing to change');

  writeEnvFile(envFile, changes);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
}

export function setDefaultProvider(id: string, env: Record<string, string | undefined>, envFile: string) {
  if (!['mock', 'anthropic', 'openai', 'gemini', 'xai'].includes(id)) throw new Error(`Unknown provider "${id}"`);
  writeEnvFile(envFile, { DEFAULT_PROVIDER: id });
  env.DEFAULT_PROVIDER = id as ProviderId;
}
