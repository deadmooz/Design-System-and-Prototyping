/**
 * Cleans model output before it is stored or rendered. Browser-safe (no Node APIs).
 * Rendering also happens in a sandboxed iframe with a strict CSP; this is the
 * first layer, not the only one.
 */

/** Pulls the html out of a fenced block (or takes the raw reply if the model skipped the fence). */
export function extractHtml(reply: string): string {
  const fenced = reply.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  let html = (fenced ? fenced[1] : reply).trim();
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body) html = body[1].trim();
  return html.replace(/<!doctype[^>]*>|<\/?html\b[^>]*>|<head\b[\s\S]*?<\/head>/gi, '').trim();
}

export function sanitizeBody(html: string): string {
  return html
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '')
    .replace(/<(link|meta|base)\b[^>]*>/gi, '')
    .replace(/<(iframe|object|embed|frame|frameset|portal)\b[\s\S]*?(<\/\1>|\/>|$)/gi, '')
    .replace(/\s(href|src|action|formaction)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, ' $1="#"')
    .replace(/@import\s+[^;]+;/gi, '');
}

export function cleanModelOutput(reply: string): string {
  const html = sanitizeBody(extractHtml(reply));
  if (!html) throw new Error('The model returned no HTML. Try rephrasing the instruction.');
  return html;
}
