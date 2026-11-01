/**
 * Prompt construction. The system prompt = fixed rules + design-system summary:
 * stable across a project's iterations so providers can cache it. The user turn
 * carries only what changes: page list, the current page, and the instruction.
 */

import type { DesignSystem } from '../core/schema.ts';
import { summarizeDesignSystem } from './context.ts';
import type { PrototypePage, SavedComponent } from './types.ts';

export const COMPONENT_CATALOG = `Available CSS classes (already loaded; prefer them over custom CSS):
layout: ds-container, ds-section, ds-stack (vertical gap), ds-row (wrap, gap), ds-grid (responsive cards), ds-surface (muted bg)
text: ds-h1..ds-h4, ds-lead, ds-muted, ds-small, ds-link
button: ds-btn + ds-btn--primary|secondary|outline|ghost|destructive, ds-btn--sm|lg, ds-btn--block (use <button> or <a>)
form: label.ds-field > span.ds-field__label + input/textarea/select.ds-field__control + span.ds-field__hint; ds-field--error; label.ds-checkbox > input[type=checkbox]
card: ds-card, ds-card--muted, ds-card--interactive
badge: ds-badge + ds-badge--primary|success|warning|error|info
avatar: ds-avatar (+ --sm|--lg), contains initials or <img>
nav: nav.ds-nav(.ds-nav--sticky) > a.ds-nav__brand + ul.ds-nav__links > li > a + div.ds-nav__actions
modal: div.ds-modal-overlay > div.ds-modal > h3.ds-modal__title + div.ds-modal__body + div.ds-modal__actions
misc: ds-spinner, footer.ds-footer
CSS variables: --ds-color-{primary,on-primary,secondary,accent,background,surface,text,text-muted,border,success,warning,error,info}, --ds-primary-50..900, --ds-neutral-50..900, --ds-font-sans|heading|mono, --ds-text-{xs..4xl}, --ds-space-N, --ds-radius-{sm,md,lg,xl,full}, --ds-shadow-{sm,md,lg}, --ds-max-width`;

const RULES = `You are a senior product designer and front-end engineer generating clickable HTML prototypes that must look native to the design system below.

Output contract:
- Reply with exactly ONE fenced \`\`\`html block and nothing else (no explanation).
- The block contains BODY markup only: no <!doctype>, <html>, <head> or <body> tags.
- Use the provided classes and CSS variables; never hard-code colors, fonts or radii that a token covers.
- Extra CSS goes in one <style> element at the top, using only var(--ds-*) values.
- Interactivity: small inline <script> only (no external scripts, no network requests, no frameworks).
- Links between prototype pages use href="#/<page-id>" with ids from PAGES. Other links use href="#".
- Images: use inline SVG or CSS gradient placeholders; no external image URLs.
- Responsive by default (mobile-first, works at 375px and 1440px); semantic HTML; labels on inputs; visible focus.
- Realistic but generic copy. Never use real brand names, logos or trademarks.
- When editing, return the COMPLETE updated markup, preserving everything the instruction does not change.`;

export function buildSystemPrompt(ds: DesignSystem): string {
  return `${RULES}\n\n${COMPONENT_CATALOG}\n\n${summarizeDesignSystem(ds)}`;
}

export interface PageRequest {
  kind: 'page' | 'component';
  instruction: string;
  pages: Pick<PrototypePage, 'id' | 'name'>[];
  page?: PrototypePage; // target page (edit when it has html)
  components?: SavedComponent[];
  history?: string[]; // previous instructions for this page, newest last
}

const MAX_CURRENT_HTML = 40_000; // ~10k tokens; larger pages are rejected rather than silently truncated
const MAX_COMPONENT_CHARS = 1500;

export function buildUserMessage(req: PageRequest): string {
  const parts: string[] = [];
  if (req.kind === 'component') {
    parts.push('TASK: Create ONE reusable UI component (a snippet, not a full page). If it needs CSS, scope it under a single root class named c-<kebab-name>.');
  } else {
    parts.push(`PAGES: ${req.pages.map((p) => `${p.id}="${p.name.replace(/"/g, "'")}"`).join(', ')}`);
    if (req.page) parts.push(`PAGE: ${req.page.id} "${req.page.name.replace(/"/g, "'")}"`);
  }
  const comps = (req.components ?? []).slice(0, 5);
  if (comps.length) {
    parts.push('PROJECT COMPONENTS (reuse their markup when relevant):');
    for (const c of comps) parts.push(`- ${c.name}:\n${c.html.slice(0, MAX_COMPONENT_CHARS)}`);
  }
  if (req.page?.html?.trim()) {
    if (req.page.html.length > MAX_CURRENT_HTML) throw new Error('The current page is too large to edit in one request; split it into more pages.');
    parts.push(`CURRENT HTML:\n\`\`\`html\n${req.page.html.trim()}\n\`\`\``);
  } else if (req.kind === 'page') {
    parts.push('CURRENT HTML: (none — create the page)');
  }
  const history = (req.history ?? []).slice(-3).map((h) => h.slice(0, 200));
  if (history.length) parts.push(`EARLIER REQUESTS FOR THIS PAGE:\n${history.map((h) => `- ${h}`).join('\n')}`);
  parts.push(`INSTRUCTION: ${req.instruction.trim()}`);
  return parts.join('\n\n');
}
