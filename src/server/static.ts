/**
 * Static files for the workspace. Browser-safe TypeScript modules under
 * src/core and src/prototype are served type-stripped, so the workspace runs
 * the exact same token/render code as the server and CLI with no build step.
 */

import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/** URL prefix → directory. Only these trees are reachable. */
const MOUNTS: [string, string][] = [
  ['/src/core/', join(ROOT, 'src/core')],
  ['/src/prototype/', join(ROOT, 'src/prototype')],
  ['/src/styles/', join(ROOT, 'src/styles')],
  ['/', join(ROOT, 'workspace')],
];
/** Prototype modules that touch Node or the network stay server-only. */
const SERVER_ONLY = new Set(['generate.ts']);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

const cache = new Map<string, { mtime: number; body: string | Buffer }>();

export async function serveStatic(pathname: string): Promise<{ status: number; type: string; body: string | Buffer } | null> {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const mount = MOUNTS.find(([prefix]) => decoded.startsWith(prefix));
  if (!mount) return null;
  const rel = decoded.slice(mount[0].length) || 'index.html';
  const file = normalize(join(mount[1], rel));
  if (!file.startsWith(mount[1] + sep) && file !== mount[1]) return null; // traversal
  const ext = extname(file);
  if (!TYPES[ext] || (ext === '.ts' && SERVER_ONLY.has(rel))) return null;
  let info;
  try { info = await stat(file); } catch { return null; }
  if (!info.isFile()) return null;

  const hit = cache.get(file);
  if (hit && hit.mtime === info.mtimeMs) return { status: 200, type: TYPES[ext], body: hit.body };
  let body: string | Buffer = await readFile(file);
  if (ext === '.ts') body = stripTypeScriptTypes(body.toString('utf8'), { mode: 'strip' });
  cache.set(file, { mtime: info.mtimeMs, body });
  return { status: 200, type: TYPES[ext], body };
}
