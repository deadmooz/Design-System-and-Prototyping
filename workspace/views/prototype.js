import { renderDocument } from '/src/prototype/render.ts';
import { sanitizeBody } from '/src/prototype/sanitize.ts';
import { api } from '../lib/api.js';
import { ask, download, h, previewFrame, slug, toast } from '../lib/dom.js';
import { currentPage, setPageHtml, state, undoPage, update } from '../lib/store.js';
import { emptyState } from './tokens.js';

const DEVICES = { mobile: 390, tablet: 768, desktop: 1280 };
const SUGGESTIONS = [
  'Landing page with hero, three feature cards, pricing and a footer',
  'Sign-in page with email, password and a remember-me checkbox',
  'Analytics dashboard with sidebar, stat cards and a recent-activity table',
  'Contact page with a validated form and an FAQ accordion',
];

let activeFrame = null;
let inflight = null; // AbortController of the running generation
let navigateHandler = null;

window.addEventListener('message', (e) => {
  if (!activeFrame || e.source !== activeFrame.contentWindow || e.data?.type !== 'dsp:navigate') return;
  navigateHandler?.(String(e.data.page || ''));
});

export function PrototypeView({ go, componentsCss, rerender }) {
  const ds = state.ds;
  if (!ds) return emptyState(go);
  const page = currentPage();
  const pages = state.prototype.pages;

  const selectPage = (id) => update((s) => { s.currentPage = id; });
  const addPage = (name, id) => {
    const base = id || slug(name);
    let pid = base, n = 2;
    while (pages.some((p) => p.id === pid)) pid = `${base}-${n++}`;
    update((s) => { s.prototype.pages.push({ id: pid, name, html: '' }); s.currentPage = pid; });
  };
  navigateHandler = (id) => {
    if (pages.some((p) => p.id === id)) return selectPage(id);
    const name = id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) || 'New page';
    addPage(name, slug(id));
    toast(`Created page "${name}" from a link — describe it in the chat.`);
  };

  // ---------- pages ----------
  const newName = h('input.input', { placeholder: 'New page name', 'aria-label': 'New page name' });
  const addBtn = h('button.btn.btn--sm', { onclick: () => { if (newName.value.trim()) addPage(newName.value.trim()); } }, 'Add');
  newName.addEventListener('keydown', (e) => e.key === 'Enter' && addBtn.click());
  const pageList = h('nav.pages', { 'aria-label': 'Pages' },
    h('ul', pages.map((p) => h('li',
      h('button.page' + (p.id === page.id ? '.active' : ''), {
        onclick: () => selectPage(p.id),
        ondblclick: async () => {
          const n = await ask({ title: 'Rename page', input: p.name, confirmLabel: 'Rename' });
          if (n?.trim()) update((s) => { s.prototype.pages.find((x) => x.id === p.id).name = n.trim().slice(0, 60); });
        },
        title: 'Double-click to rename',
      }, h('span', p.name), h('small.mono', `#/${p.id}`), p.html ? null : h('small.muted', 'empty')),
      pages.length > 1 ? h('button.icon-btn', {
        'aria-label': `Delete ${p.name}`,
        onclick: async () => { if (await ask({ title: `Delete page "${p.name}"?`, confirmLabel: 'Delete', danger: true })) update((s) => { s.prototype.pages = s.prototype.pages.filter((x) => x.id !== p.id); if (s.currentPage === p.id) s.currentPage = s.prototype.pages[0].id; }); },
      }, '×') : null))),
    h('div.row', newName, addBtn));

  // ---------- preview ----------
  const device = state.settings.device in DEVICES ? state.settings.device : 'desktop';
  const frame = previewFrame(`Preview of ${page.name}`);
  activeFrame = frame;
  const stage = h('div.stage', frame);
  frame.style.width = `${DEVICES[device]}px`;
  const fit = () => {
    const w = stage.clientWidth - 2, hgt = stage.clientHeight - 2;
    const scale = Math.min(1, w / DEVICES[device]);
    frame.style.transform = `scale(${scale})`;
    frame.style.height = `${Math.max(400, hgt / scale)}px`;
  };
  new ResizeObserver(fit).observe(stage);
  frame.srcdoc = page.html
    ? renderDocument({ ds, pages, pageId: page.id, componentsCss, mode: 'preview' })
    : renderDocument({ ds, pages: [{ id: page.id, name: page.name, html: `<div class="ds-container ds-section ds-stack" style="text-align:center;align-items:center"><span class="ds-badge">Empty page</span><h1 class="ds-h3">${page.name.replace(/</g, '&lt;')}</h1><p class="ds-muted">Describe this page in the chat to generate it.</p></div>` }], pageId: page.id, componentsCss, mode: 'preview' });

  const deviceSeg = h('div.segmented.segmented--sm', { role: 'group', 'aria-label': 'Device' }, Object.keys(DEVICES).map((d) =>
    h('button', { 'aria-pressed': String(d === device), onclick: () => update((s) => { s.settings.device = d; }) }, d)));

  const codeArea = h('textarea.input.mono.code', { value: page.html, spellcheck: 'false', 'aria-label': 'Page HTML' });
  const codePanel = h('div.code-panel', { hidden: true }, codeArea, h('div.row',
    h('button.btn.btn--primary.btn--sm', { onclick: () => { setPageHtml(page.id, sanitizeBody(codeArea.value)); toast('HTML applied'); } }, 'Apply HTML'),
    h('span.hint', 'External scripts, iframes and links are stripped.')));
  const toolbar = h('div.toolbar',
    deviceSeg,
    h('div.row',
      h('button.btn.btn--sm', { disabled: !state.versions[page.id]?.length, onclick: () => { if (undoPage(page.id)) toast('Reverted to previous version'); } }, `Undo${state.versions[page.id]?.length ? ` (${state.versions[page.id].length})` : ''}`),
      h('button.btn.btn--sm', { onclick: () => { codePanel.hidden = !codePanel.hidden; } }, 'HTML'),
      h('button.btn.btn--sm', { onclick: exportPrototype }, 'Export prototype')));

  function exportPrototype() {
    const html = renderDocument({ ds, pages: pages.filter((p) => p.html), componentsCss, mode: 'export', title: state.prototype.name });
    download(`${slug(ds.meta.name)}-prototype.html`, html, 'text/html');
  }

  // ---------- chat ----------
  const chat = state.chat[page.id] ?? [];
  const log = h('div.chat-log', { 'aria-live': 'polite' },
    chat.length ? chat.map((m) => h(`div.msg.msg--${m.role}`, m.text, m.meta ? h('small', m.meta) : null))
      : h('div.suggestions', h('p.muted', page.html ? 'Describe a change to this page.' : 'Try one of these:'),
        page.html ? null : SUGGESTIONS.map((s) => h('button.chip', { onclick: () => { input.value = s; input.focus(); } }, s))));
  const input = h('textarea.input', { rows: 3, placeholder: page.html ? 'e.g. "Make the hero two columns with an illustration on the right"' : 'Describe the page you want…', 'aria-label': 'Instruction' });
  const status = h('div.status', { role: 'status' });
  const sendBtn = h('button.btn.btn--primary', { onclick: send }, page.html ? 'Apply change' : 'Generate page');
  const cancelBtn = h('button.btn', { hidden: true, onclick: () => inflight?.abort() }, 'Cancel');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });

  async function send() {
    const instruction = input.value.trim();
    if (!instruction || inflight) return;
    const target = page.id;
    const history = (state.chat[target] ?? []).filter((m) => m.role === 'user').map((m) => m.text);
    inflight = new AbortController();
    sendBtn.disabled = true; cancelBtn.hidden = false;
    status.className = 'status';
    status.replaceChildren(h('span.spinner'), ` ${page.html ? 'Applying change' : 'Generating page'} with ${state.settings.provider || 'default provider'}…`);
    try {
      const out = await api.generate({
        designSystem: ds, kind: 'page', instruction, history,
        pages: pages.map(({ id, name }) => ({ id, name })), page: { id: page.id, name: page.name, html: page.html },
        components: state.prototype.components, provider: state.settings.provider || undefined, model: state.settings.model || undefined,
      }, inflight.signal);
      const meta = `${out.provider}/${out.model} · ${out.usage.inputTokens} in${out.usage.cachedInputTokens ? ` (${out.usage.cachedInputTokens} cached)` : ''} · ${out.usage.outputTokens} out${out.truncated ? ' · truncated, try a smaller change' : ''}`;
      update((s) => {
        (s.chat[target] ??= []).push({ role: 'user', text: instruction }, { role: 'assistant', text: page.html ? 'Updated the page.' : 'Created the page.', meta });
        if (s.chat[target].length > 40) s.chat[target].splice(0, s.chat[target].length - 40);
      }, { silent: true });
      setPageHtml(target, out.html);
    } catch (e) {
      status.className = 'status status--error';
      status.textContent = e.name === 'AbortError' ? 'Cancelled.' : e.message;
    } finally {
      inflight = null;
      sendBtn.disabled = false; cancelBtn.hidden = true;
    }
  }

  return h('div.view.view--full',
    h('div.proto',
      h('aside.proto-pages', h('h2', 'Pages'), pageList),
      h('section.proto-preview', toolbar, codePanel, stage),
      h('aside.proto-chat', h('h2', `Chat · ${page.name}`), log, input, h('div.row', sendBtn, cancelBtn, h('span.hint', 'Ctrl+Enter')), status)));
}
