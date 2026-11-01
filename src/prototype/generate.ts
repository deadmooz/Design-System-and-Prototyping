import type { DesignSystem } from '../core/schema.ts';
import type { LLMProvider } from '../llm/types.ts';
import { buildSystemPrompt, buildUserMessage, type PageRequest } from './prompts.ts';
import { cleanModelOutput } from './sanitize.ts';

export interface GenerateInput extends PageRequest {
  ds: DesignSystem;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateOutput {
  html: string;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  truncated: boolean;
}

/** One LLM call per user instruction: build compact prompt → complete → clean HTML. */
export async function generate(provider: LLMProvider, input: GenerateInput): Promise<GenerateOutput> {
  if (!input.instruction?.trim()) throw new Error('Instruction is required');
  if (input.instruction.length > 4000) throw new Error('Instruction is too long (max 4000 characters)');
  const res = await provider.complete({
    system: buildSystemPrompt(input.ds),
    messages: [{ role: 'user', content: buildUserMessage(input) }],
    model: input.model,
    maxTokens: input.maxTokens ?? (input.kind === 'component' ? 2500 : 8000),
    reasoning: 'minimal',
    signal: input.signal,
  });
  const truncated = /max_tokens|length|MAX_TOKENS/i.test(res.stopReason ?? '');
  // A reply cut off by the token limit loses its closing fence; restore it so the partial page still renders.
  const text = truncated && res.text.includes('```') && !/```\s*$/.test(res.text) ? `${res.text}\n\`\`\`` : res.text;
  const html = cleanModelOutput(text);
  return { html, provider: res.provider, model: res.model, usage: res.usage, truncated };
}
