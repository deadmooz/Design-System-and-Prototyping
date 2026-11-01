import { postJson } from '../http.ts';
import { LLMError, type CompletionRequest, type CompletionResult, type LLMProvider, type ProviderId } from '../types.ts';

export interface OpenAICompatibleConfig {
  id: ProviderId;
  label: string;
  apiKey?: string;
  envKeyName: string;
  model: string;
  baseUrl: string;
  /** OpenAI's newer models want `max_completion_tokens`; other compatible APIs use `max_tokens`. */
  tokenParam: 'max_completion_tokens' | 'max_tokens';
  fetchImpl?: typeof fetch;
}

/** Chat Completions API — used for OpenAI and xAI Grok (same wire format). */
export function createOpenAICompatibleProvider(cfg: OpenAICompatibleConfig): LLMProvider {
  const base = cfg.baseUrl.replace(/\/$/, '');
  return {
    id: cfg.id,
    label: cfg.label,
    defaultModel: cfg.model,
    configured: Boolean(cfg.apiKey),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      if (!cfg.apiKey) throw new LLMError(cfg.id, `${cfg.envKeyName} is not set`, 401);
      const model = req.model || cfg.model;
      const messages = [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      const body: Record<string, unknown> = { model, messages, [cfg.tokenParam]: req.maxTokens ?? 4096 };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.json) body.response_format = { type: 'json_object' };
      // Only OpenAI's reasoning models accept reasoning_effort; others would reject the request.
      if (req.reasoning === 'minimal' && cfg.id === 'openai' && /^(gpt-5|o\d)/i.test(model)) body.reasoning_effort = 'low';
      const json = await postJson(`${base}/chat/completions`, { authorization: `Bearer ${cfg.apiKey}` }, body, {
        provider: cfg.id, signal: req.signal, fetchImpl: cfg.fetchImpl,
      });
      const choice = json.choices?.[0];
      const content = choice?.message?.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p.text ?? '').join('') : '';
      return {
        text,
        provider: cfg.id,
        model: json.model ?? model,
        stopReason: choice?.finish_reason,
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
          cachedInputTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
      };
    },
  };
}
