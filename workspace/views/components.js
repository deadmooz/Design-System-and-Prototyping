import { renderComponentGallery, renderDocument } from '/src/prototype/render.ts';
import { api } from '../lib/api.js';
import { copy, h, previewFrame, slug, toast } from '../lib/dom.js';
import { state, update } from '../lib/store.js';
import { emptyState } from './tokens.js';

export function ComponentsView({ go, componentsCss }) {
  const ds = state.ds;
  if (!ds) return emptyState(go);

  const gallery = previewFrame('Component gallery');
  gallery.classList.add('preview--tall');
  gallery.srcdoc = renderComponentGallery(ds, componentsCss);

  const specs = Object.entries(ds.components).filter(([, c]) => c?.found).map(([name, c]) => {
    const rows = (obj) => Object.entries(obj).map(([k, v]) => h('tr', h('td.mono', k), h('td.mono', v)));
    return h('details.spec',
      h('summary', h('strong', name), h('span.muted', ` ${c.count ? `${c.count} in markup · ` : ''}${Object.keys(c.variants).length} variants · ${Object.keys(c.states).length} states`)),
      c.selectors.length ? h('p.hint.mono', c.selectors.join('  ')) : null,
      Object.keys(c.base).length ? h('table.kv-table', h('tbody', rows(c.base))) : h('p.muted', 'No base styling captured.'),
      Object.entries(c.states).map(([s, css]) => h('div', h('h4', `:${s}`), h('table.kv-table', h('tbody', rows(css))))),
      Object.entries(c.variants).map(([v, css]) => h('div', h('h4', `variant · ${v}`), h('table.kv-table', h('tbody', rows(css))))));
  });

  // AI-generated reusable components saved to the project library.
  const instruction = h('textarea.input', { rows: 2, placeholder: 'Describe a reusable component, e.g. "testimonial card with avatar, quote and 5-star rating"', 'aria-label': 'Component description' });
  const status = h('div.status', { role: 'status' });
  const btn = h('button.btn.btn--primary', { onclick: create }, 'Generate component');
  async function create() {
    const text = instruction.value.trim();
    if (!text) return;
    btn.disabled = true;
    status.className = 'status';
    status.replaceChildren(h('span.spinner'), ' Generating…');
    try {
      const out = await api.generate({ designSystem: ds, kind: 'component', instruction: text, provider: state.settings.provider || undefined, model: state.settings.model || undefined, components: state.prototype.components });
      const name = text.split(/[,.]/)[0].slice(0, 40);
      update((s) => { s.prototype.components.push({ id: `${slug(name)}-${Date.now().toString(36)}`, name, html: out.html }); });
      toast(`Saved "${name}" · ${out.usage.inputTokens}→${out.usage.outputTokens} tokens`, 'success');
    } catch (e) {
      status.className = 'status status--error';
      status.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  const library = state.prototype.components.map((c) => {
    const frame = previewFrame(c.name);
    frame.srcdoc = renderDocument({ ds, pages: [{ id: c.id, name: c.name, html: `<div class="ds-container" style="padding-block:24px">${c.html}</div>` }], componentsCss, mode: 'preview' });
    return h('div.lib-item',
      h('div.row.between', h('strong', c.name), h('div.row',
        h('button.btn.btn--sm', { onclick: () => copy(c.html) }, 'Copy HTML'),
        h('button.btn.btn--sm.btn--danger', { onclick: () => update((s) => { s.prototype.components = s.prototype.components.filter((x) => x.id !== c.id); }) }, 'Remove'))),
      frame);
  });

  return h('div.view',
    h('header.view-head', h('h1', 'Components'), h('p.muted', 'The shared component layer rendered with this design system. Every prototype uses these classes, so token edits restyle everything.')),
    h('section.panel', gallery),
    h('section.panel', h('h2', 'Project component library'), h('p.hint', 'Generated components are passed to the AI when building pages, so they get reused.'),
      instruction, h('div.row', btn), status, library.length ? library : h('p.muted', 'No saved components yet.')),
    h('section.panel', h('h2', 'Extracted component evidence'), specs.length ? specs : h('p.muted', 'None captured from the reference.')),
  );
}
