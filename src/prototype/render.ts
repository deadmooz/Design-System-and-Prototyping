/**
 * Turns design system + pages into a standalone HTML document. Browser-safe:
 * the workspace imports this same module for live previews, and the server
 * uses it for exports, so preview and export can never drift apart.
 */

import { isAllowedFontSource } from '../core/defaults.ts';
import { toCssVariables } from '../core/emit.ts';
import type { DesignSystem } from '../core/schema.ts';
import type { PrototypePage } from './types.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Generated markup can contain anything; the CSP blocks network access and outside navigation. */
const CSP = [
  "default-src 'none'",
  "img-src data: blob: https:",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://fonts.bunny.net https://use.typekit.net https://rsms.me",
  "font-src data: https://fonts.gstatic.com https://fonts.bunny.net https://use.typekit.net https://rsms.me",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export interface RenderOptions {
  ds: DesignSystem;
  pages: PrototypePage[];
  pageId?: string;
  componentsCss: string;
  /** preview: one page, links post a message to the workspace. export: all pages + hash router. */
  mode: 'preview' | 'export';
  title?: string;
}

const PREVIEW_ROUTER = `document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(h&&h.indexOf('#/')===0){e.preventDefault();parent.postMessage({type:'dsp:navigate',page:h.slice(2)},'*');}else if(h==='#'||!h||h.indexOf('#')!==0){e.preventDefault();}});`;

const EXPORT_ROUTER = `(function(){var app=document.getElementById('app');function show(){var id=location.hash.slice(2)||app.dataset.home;var t=document.querySelector('template[data-page="'+CSS.escape(id)+'"]')||document.querySelector('template[data-page]');app.innerHTML='';app.appendChild(t.content.cloneNode(true));app.querySelectorAll('script').forEach(function(old){var s=document.createElement('script');s.textContent=old.textContent;old.replaceWith(s);});window.scrollTo(0,0);}window.addEventListener('hashchange',show);show();})();`;

export function renderDocument(o: RenderOptions): string {
  const fonts = o.ds.typography.fontSources.filter(isAllowedFontSource).map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join('\n');
  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(o.title ?? o.ds.meta.name)}</title>
${fonts}
<style>
${toCssVariables(o.ds)}
${o.componentsCss.replace(/<\/style/gi, '<\\/style')}
html,body{margin:0}
</style>
</head>
<body class="ds">`;
  if (o.mode === 'preview') {
    const page = o.pages.find((p) => p.id === o.pageId) ?? o.pages[0];
    return `${head}\n${page?.html ?? ''}\n<script>${PREVIEW_ROUTER}</script>\n</body>\n</html>`;
  }
  const templates = o.pages.map((p) => `<template data-page="${esc(p.id)}">\n${p.html}\n</template>`).join('\n');
  return `${head}\n<div id="app" data-home="${esc(o.pages[0]?.id ?? '')}"></div>\n${templates}\n<script>${EXPORT_ROUTER}</script>\n</body>\n</html>`;
}

/** A gallery document that renders every component class in the current theme. */
export function renderComponentGallery(ds: DesignSystem, componentsCss: string): string {
  const html = `<div class="ds-container ds-stack" style="padding-block:24px">
<section class="ds-stack"><h2 class="ds-h4">Buttons</h2><div class="ds-row">
<button class="ds-btn">Primary</button><button class="ds-btn ds-btn--secondary">Secondary</button><button class="ds-btn ds-btn--outline">Outline</button><button class="ds-btn ds-btn--ghost">Ghost</button><button class="ds-btn ds-btn--destructive">Delete</button><button class="ds-btn" disabled>Disabled</button></div>
<div class="ds-row"><button class="ds-btn ds-btn--sm">Small</button><button class="ds-btn">Medium</button><button class="ds-btn ds-btn--lg">Large</button></div></section>
<section class="ds-stack"><h2 class="ds-h4">Form fields</h2><div class="ds-grid">
<label class="ds-field"><span class="ds-field__label">Email</span><input class="ds-field__control" placeholder="you@example.com"><span class="ds-field__hint">We never share it.</span></label>
<label class="ds-field ds-field--error"><span class="ds-field__label">Password</span><input class="ds-field__control" type="password" value="secret"><span class="ds-field__hint">At least 8 characters.</span></label>
<label class="ds-field"><span class="ds-field__label">Plan</span><select class="ds-field__control"><option>Starter</option><option>Pro</option></select></label></div>
<div class="ds-row"><label class="ds-checkbox"><input type="checkbox" checked> Remember me</label><label class="ds-checkbox"><input type="checkbox"> Subscribe</label></div></section>
<section class="ds-stack"><h2 class="ds-h4">Badges & avatars</h2><div class="ds-row">
<span class="ds-badge">Neutral</span><span class="ds-badge ds-badge--primary">Primary</span><span class="ds-badge ds-badge--success">Success</span><span class="ds-badge ds-badge--warning">Warning</span><span class="ds-badge ds-badge--error">Error</span><span class="ds-badge ds-badge--info">Info</span>
<span class="ds-avatar ds-avatar--sm">AB</span><span class="ds-avatar">CD</span><span class="ds-avatar ds-avatar--lg">EF</span><span class="ds-spinner"></span></div></section>
<section class="ds-stack"><h2 class="ds-h4">Cards</h2><div class="ds-grid">
<div class="ds-card ds-stack"><h3 class="ds-h4">Default card</h3><p class="ds-muted">Bordered surface with the small shadow token.</p><a class="ds-link" href="#">Learn more →</a></div>
<div class="ds-card ds-card--muted ds-stack"><h3 class="ds-h4">Muted card</h3><p class="ds-muted">Tinted surface without a shadow.</p></div>
<div class="ds-card ds-card--interactive ds-stack"><h3 class="ds-h4">Interactive card</h3><p class="ds-muted">Lifts on hover.</p></div></div></section>
<section class="ds-stack"><h2 class="ds-h4">Navigation</h2><nav class="ds-nav" style="border:1px solid var(--ds-color-border);border-radius:var(--ds-radius-md)"><a class="ds-nav__brand" href="#">Brand</a><ul class="ds-nav__links"><li><a href="#" aria-current="page">Home</a></li><li><a href="#">Features</a></li><li><a href="#">Pricing</a></li></ul><div class="ds-nav__actions"><a class="ds-btn ds-btn--ghost ds-btn--sm" href="#">Sign in</a><a class="ds-btn ds-btn--sm" href="#">Get started</a></div></nav></section>
<section class="ds-stack"><h2 class="ds-h4">Modal</h2><div style="position:relative;min-height:220px;border-radius:var(--ds-radius-md);overflow:hidden"><div class="ds-modal-overlay" style="position:absolute"><div class="ds-modal"><h3 class="ds-modal__title">Delete project?</h3><div class="ds-modal__body">This cannot be undone.</div><div class="ds-modal__actions"><button class="ds-btn ds-btn--ghost">Cancel</button><button class="ds-btn ds-btn--destructive">Delete</button></div></div></div></div></section>
<section class="ds-stack"><h2 class="ds-h4">Typography</h2><div class="ds-h1">Heading one</div><div class="ds-h2">Heading two</div><div class="ds-h3">Heading three</div><div class="ds-h4">Heading four</div><p class="ds-lead">Lead paragraph for introductions.</p><p>Body text. The quick brown fox jumps over the lazy dog.</p><p class="ds-small ds-muted">Small muted caption text.</p></section>
</div>`;
  return renderDocument({ ds, pages: [{ id: 'gallery', name: 'Gallery', html }], componentsCss, mode: 'preview', title: `${ds.meta.name} components` });
}
