import type { DesignSystem } from '../../core/schema.ts';
import { analyzeFigma } from './analyze.ts';
import { fetchFigmaFile, parseFigmaUrl } from './client.ts';

export { analyzeFigma } from './analyze.ts';
export { fetchFigmaFile, parseFigmaUrl } from './client.ts';

/** Read a Figma file (or a single frame via ?node-id=) and extract its design system. No LLM calls. */
export async function extractFromFigma(urlOrKey: string, token: string): Promise<DesignSystem> {
  const ref = parseFigmaUrl(urlOrKey);
  const payload = await fetchFigmaFile(ref, token);
  return analyzeFigma(payload, urlOrKey);
}
