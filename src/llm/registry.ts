/**
 * Builds the provider set from environment variables. Adding a provider means
 * adding one adapter file and one entry here — nothing else in the product
 * knows which vendor it is talking to.
 */

import { createAnthropicProvider } from './providers/anthropic.ts';
import { createGeminiProvider } from './providers/gemini.ts';
import { createMockProvider } from './providers/mock.ts';
import { createOpenAICompatibleProvider } from './providers/openai-compatible.ts';
import { LLMError, type LLMProvider, type ProviderId, type ProviderInfo } from './types.ts';

/** Defaults are overridable per env var; check each vendor's model list when upgrading. */
export const DEFAULT_MODELS: Record<Exclude<ProviderId, 'mock'>, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  // 2.5 models are closed to new users; flash-lite answers in ~1 s where the larger flash took 60–110 s (Nov 2026).
  gemini: 'gemini-3.5-flash-lite',
  xai: 'grok-4',
};

export class ProviderRegistry {
  private providers = new Map<ProviderId, LLMProvider>();
  readonly defaultId: ProviderId;

  constructor(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch) {
    const list: LLMProvider[] = [
      createMockProvider(),
      createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic, baseUrl: env.ANTHROPIC_BASE_URL, fetchImpl }),
      createOpenAICompatibleProvider({
        id: 'openai', label: 'OpenAI', apiKey: env.OPENAI_API_KEY, envKeyName: 'OPENAI_API_KEY',
        model: env.OPENAI_MODEL || DEFAULT_MODELS.openai, baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        tokenParam: 'max_completion_tokens', fetchImpl,
      }),
      createGeminiProvider({ apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY, model: env.GEMINI_MODEL || DEFAULT_MODELS.gemini, baseUrl: env.GEMINI_BASE_URL, fetchImpl }),
      createOpenAICompatibleProvider({
        id: 'xai', label: 'xAI Grok', apiKey: env.XAI_API_KEY, envKeyName: 'XAI_API_KEY',
        model: env.XAI_MODEL || DEFAULT_MODELS.xai, baseUrl: env.XAI_BASE_URL || 'https://api.x.ai/v1',
        tokenParam: 'max_tokens', fetchImpl,
      }),
    ];
    for (const p of list) this.providers.set(p.id, p);
    const wanted = (env.DEFAULT_PROVIDER || 'mock') as ProviderId;
    this.defaultId = this.providers.get(wanted)?.configured ? wanted : 'mock';
  }

  get(id?: string): LLMProvider {
    const p = this.providers.get((id || this.defaultId) as ProviderId);
    if (!p) throw new LLMError((id ?? 'mock') as ProviderId, `Unknown provider "${id}"`, 400);
    if (!p.configured) throw new LLMError(p.id, `${p.label} is not configured. Add its API key to .env and restart.`, 400);
    return p;
  }

  list(): ProviderInfo[] {
    return [...this.providers.values()].map(({ id, label, defaultModel, configured }) => ({ id, label, defaultModel, configured }));
  }
}
