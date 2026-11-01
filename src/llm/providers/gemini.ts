import { postJson } from '../http.ts';
import { LLMError, type CompletionRequest, type CompletionResult, type LLMProvider } from '../types.ts';

export interface GeminiConfig {
  apiKey?: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Smallest thinking setting each Gemini family accepts: 2.5 Flash / Flash-Lite can turn thinking
 * off, 2.5 Pro needs at least 128 tokens, Gemini 3 uses `thinkingLevel`. Older models have none.
 */
function minimalThinking(model: string): Record<string, unknown> | null {
  const m = model.toLowerCase();
  // `-latest` aliases (gemini-flash-latest, gemini-pro-latest) currently point at Gemini 3 models.
  if (/gemini-[3-9]|gemini-(flash|pro|flash-lite)-latest/.test(m)) return { thinkingLevel: 'low' };
  if (/gemini-2\.5-.*pro/.test(m)) return { thinkingBudget: 128 };
  if (/gemini-2\.5-.*flash/.test(m)) return { thinkingBudget: 0 };
  return null;
}

/** Google Gemini generateContent API (API key in header, never in the URL). */
export function createGeminiProvider(cfg: GeminiConfig): LLMProvider {
  const base = (cfg.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  return {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: cfg.model,
    configured: Boolean(cfg.apiKey),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      if (!cfg.apiKey) throw new LLMError('gemini', 'GEMINI_API_KEY is not set', 401);
      const model = req.model || cfg.model;
      const body: Record<string, unknown> = {
        contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: {
          maxOutputTokens: req.maxTokens ?? 4096,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
        },
      };
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
      const thinking = req.reasoning === 'minimal' ? minimalThinking(model) : null;
      if (thinking) (body.generationConfig as Record<string, unknown>).thinkingConfig = thinking;
      const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
      const post = () => postJson(url, { 'x-goog-api-key': cfg.apiKey! }, body, { provider: 'gemini', signal: req.signal, fetchImpl: cfg.fetchImpl });
      let json: any;
      try {
        json = await post();
      } catch (e) {
        // A model that rejects the thinking setting still gets the request, just without it.
        if (!thinking || !(e instanceof LLMError) || e.status !== 400 || !/think/i.test(e.message)) throw e;
        delete (body.generationConfig as Record<string, unknown>).thinkingConfig;
        json = await post();
      }
      const cand = json.candidates?.[0];
      if (!cand && json.promptFeedback?.blockReason) throw new LLMError('gemini', `Prompt blocked: ${json.promptFeedback.blockReason}`, 422);
      const text = (cand?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('');
      return {
        text,
        provider: 'gemini',
        model: json.modelVersion ?? model,
        stopReason: cand?.finishReason,
        usage: {
          inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0),
          cachedInputTokens: json.usageMetadata?.cachedContentTokenCount ?? 0,
        },
      };
    },
  };
}
