import type { DesignSystem } from '../../core/schema.ts';
import { analyzeWebsite } from './analyze.ts';
import { fetchPage, type PageFetchOptions } from './fetch.ts';

export { analyzeWebsite } from './analyze.ts';
export { ExtractionError, fetchPage, robotsAllows, safeFetch } from './fetch.ts';

/** Fetch a public page (plus its CSS) and extract its design system. No LLM calls. */
export async function extractFromUrl(url: string, opts: PageFetchOptions = {}): Promise<DesignSystem> {
  const page = await fetchPage(url, opts);
  return analyzeWebsite(page);
}
