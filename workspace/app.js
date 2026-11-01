import { api } from './lib/api.js';
import { $, ask, clear, download, h, toast } from './lib/dom.js';
import { exportProject, importProject, resetProject, state, subscribe, update } from './lib/store.js';
import { ComponentsView } from './views/components.js';
import { ImportView } from './views/import.js';
import { PrototypeView } from './views/prototype.js';
import { SettingsView } from './views/settings.js';
import { TokensView } from './views/tokens.js';

const VIEWS = {
  import: ['Import', ImportView], tokens: ['Design system', TokensView], components: ['Components', ComponentsView],
  prototype: ['Prototype', PrototypeView], settings: ['Settings', SettingsView],
};

const main = $('#main');
const nav = $('#nav');
const providerSelect = $('#provider');
const modelInput = $('#model');
let providers = { default: 'mock', providers: [], figmaTokenConfigured: false };
let componentsCss = '';

const route = () => (location.hash.slice(1) in VIEWS ? location.hash.slice(1) : state.ds ? 'tokens' : 'import');
const go = (view) => { if (location.hash !== `#${view}`) location.hash = view; else render(); };

function render() {
  const view = route();
  nav.querySelectorAll('a').forEach((a) => a.setAttribute('aria-current', a.dataset.view === view ? 'page' : 'false'));
  const [, View] = VIEWS[view];
  try {
    clear(main, View({ go, providers, componentsCss, rerender: render, refreshProviders }));
  } catch (e) {
    console.error(e);
    clear(main, h('div.view', h('h1', 'Something went wrong'), h('p.status.status--error', e.message)));
  }
  $('#ds-name').textContent = state.ds ? state.ds.meta.name : 'No design system';
}

function renderProviders() {
  clear(providerSelect, providers.providers.map((p) => h('option', { value: p.id, disabled: !p.configured, selected: p.id === (state.settings.provider || providers.default) },
    `${p.label}${p.configured ? '' : ' — add key in Settings'}`)));
  const current = providers.providers.find((p) => p.id === (state.settings.provider || providers.default));
  modelInput.placeholder = current?.defaultModel ?? 'model';
  modelInput.value = state.settings.model;
}

/** Re-reads provider status after keys change in Settings (no page reload needed). */
async function refreshProviders() {
  try {
    providers = await api.providers();
    // A provider that lost its key can no longer be the selection.
    const chosen = providers.providers.find((p) => p.id === state.settings.provider);
    if (state.settings.provider && !chosen?.configured) update((s) => { s.settings.provider = ''; s.settings.model = ''; }, { silent: true });
    renderProviders();
  } catch (e) {
    toast(e.message, 'error');
  }
}

nav.append(...Object.entries(VIEWS).map(([id, [label]]) => h('a', { href: `#${id}`, 'data-view': id }, label)));
providerSelect.addEventListener('change', () => { update((s) => { s.settings.provider = providerSelect.value; s.settings.model = ''; }, { silent: true }); renderProviders(); });
modelInput.addEventListener('change', () => update((s) => { s.settings.model = modelInput.value.trim(); }, { silent: true }));

$('#export-project').addEventListener('click', () => download('project.dsp.json', exportProject(), 'application/json'));
$('#import-project').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { toast(importProject(await file.text()) === 'project' ? 'Project imported' : 'Design system imported', 'success'); go(state.ds ? 'tokens' : 'import'); }
  catch (err) { toast(`Import failed: ${err.message}`, 'error'); }
  e.target.value = '';
});
$('#reset-project').addEventListener('click', async () => {
  if (await ask({ title: 'Reset project?', message: 'Clears the design system, pages and chat from this browser. API keys are not affected.', confirmLabel: 'Reset', danger: true })) { resetProject(); go('import'); }
});

window.addEventListener('hashchange', render);
subscribe(render);

(async function boot() {
  const [prov, css] = await Promise.allSettled([api.providers(), fetch('/src/styles/components.css').then((r) => r.text())]);
  if (prov.status === 'fulfilled') providers = prov.value;
  else toast('Local server not reachable — run "npm start". Imports and AI need it.', 'error');
  if (css.status === 'fulfilled') componentsCss = css.value;
  renderProviders();
  render();
})();
