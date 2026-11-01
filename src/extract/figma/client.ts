/** Thin Figma REST client (personal access token). Only GET requests, no SDK. */

import { ExtractionError } from '../web/fetch.ts';

const API = 'https://api.figma.com/v1';

export interface FigmaRef {
  fileKey: string;
  nodeId?: string;
}

/** Accepts figma.com/file|design|proto/<key>/..., ?node-id=1-2, or a bare file key. */
export function parseFigmaUrl(input: string): FigmaRef {
  const s = input.trim();
  if (/^[A-Za-z0-9]{10,64}$/.test(s)) return { fileKey: s };
  let u: URL;
  try { u = new URL(s); } catch { throw new ExtractionError('Not a Figma URL or file key'); }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) throw new ExtractionError('URL must be on figma.com');
  const m = u.pathname.match(/^\/(?:file|design|proto|board|make)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/);
  if (!m) throw new ExtractionError('Could not find a file key in the Figma URL');
  const node = u.searchParams.get('node-id');
  return { fileKey: m[2] ?? m[1], nodeId: node ? node.replace(/-/g, ':') : undefined };
}

async function figmaGet(path: string, token: string, timeoutMs = 30000): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    throw new ExtractionError(`Could not reach the Figma API: ${e?.message ?? e}`, 502);
  }
  if (res.ok) return res.json();
  const detail = await res.text().catch(() => '');
  if (res.status === 403) throw new ExtractionError('Figma rejected the token or you lack access to this file (403).', 403);
  if (res.status === 404) throw new ExtractionError('Figma file not found (404). Check the URL and that the token can open it.', 404);
  if (res.status === 429) throw new ExtractionError('Figma rate limit reached (429). Wait a minute and retry.', 429);
  throw new ExtractionError(`Figma API error ${res.status}: ${detail.slice(0, 200)}`, 502);
}

export interface FigmaPayload {
  file: any;
  /** Local variables; only available on plans with the Variables REST API, else null. */
  variables: any | null;
}

export async function fetchFigmaFile(ref: FigmaRef, token: string): Promise<FigmaPayload> {
  if (!token) throw new ExtractionError('A Figma personal access token is required (FIGMA_TOKEN or the token field).', 401);
  const filePromise = ref.nodeId
    ? figmaGet(`/files/${ref.fileKey}/nodes?ids=${encodeURIComponent(ref.nodeId)}&geometry=omit`, token).then((r) => {
        const node = r.nodes?.[ref.nodeId!];
        if (!node) throw new ExtractionError(`Node ${ref.nodeId} not found in the file`, 404);
        return { name: r.name, document: node.document, styles: { ...(r.styles ?? {}), ...(node.styles ?? {}) }, components: node.components ?? {} };
      })
    : figmaGet(`/files/${ref.fileKey}?geometry=omit`, token, 60000);
  const variablesPromise = figmaGet(`/files/${ref.fileKey}/variables/local`, token).catch(() => null);
  const [file, variables] = await Promise.all([filePromise, variablesPromise]);
  return { file, variables };
}
