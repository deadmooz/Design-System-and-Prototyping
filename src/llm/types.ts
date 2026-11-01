/** Provider-agnostic LLM contract. Product code depends only on this file. */

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'xai' | 'mock';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  /** Stable instructions + design-system context. Kept first so providers can cache it. */
  system?: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for a JSON-only reply where it supports a native JSON mode. */
  json?: boolean;
  /**
   * 'minimal' keeps reasoning ("thinking") models fast: design JSON and page markup need little
   * deliberation, and a long think can exceed the timeout or eat the whole output budget.
   */
  reasoning?: 'minimal' | 'default';
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  provider: ProviderId;
  model: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  stopReason?: string;
}

export interface LLMProvider {
  id: ProviderId;
  label: string;
  defaultModel: string;
  /** True when credentials are present. Never exposes the credential itself. */
  configured: boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  configured: boolean;
}

export class LLMError extends Error {
  provider: ProviderId;
  status: number;
  retryable: boolean;
  constructor(provider: ProviderId, message: string, status = 502, retryable = false) {
    super(`[${provider}] ${message}`);
    this.name = 'LLMError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}
