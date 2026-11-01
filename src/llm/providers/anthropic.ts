import { postJson } from '../http.ts';
import { LLMError, type CompletionRequest, type CompletionResult, type LLMProvider } from '../types.ts';

export interface AnthropicConfig {
  apiKey?: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Anthropic Messages API. The system prompt is marked cacheable, so iterative edits reuse it cheaply. */
export function createAnthropicProvider(cfg: AnthropicConfig): LLMProvider {
  const base = (cfg.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  return {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultModel: cfg.model,
    configured: Boolean(cfg.apiKey),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      if (!cfg.apiKey) throw new LLMError('anthropic', 'ANTHROPIC_API_KEY is not set', 401);
      const model = req.model || cfg.model;
      const body: Record<string, unknown> = {
        model,
        max_tokens: req.maxTokens ?? 4096,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (req.system) body.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
      if (req.temperature !== undefined) body.temperature = req.temperature;
      const json = await postJson(`${base}/v1/messages`, { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }, body, {
        provider: 'anthropic', signal: req.signal, fetchImpl: cfg.fetchImpl,
      });
      const text = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      return {
        text,
        provider: 'anthropic',
        model: json.model ?? model,
        stopReason: json.stop_reason,
        usage: {
          inputTokens: (json.usage?.input_tokens ?? 0) + (json.usage?.cache_read_input_tokens ?? 0) + (json.usage?.cache_creation_input_tokens ?? 0),
          outputTokens: json.usage?.output_tokens ?? 0,
          cachedInputTokens: json.usage?.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}
