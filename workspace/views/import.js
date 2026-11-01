import { completeDesignSystem } from '/src/core/defaults.ts';
import { api } from '../lib/api.js';
import { h, toast } from '../lib/dom.js';
import { importProject, setDesignSystem, state } from '../lib/store.js';

const BRIEF_EXAMPLES = [
  'Calm fintech app: deep green and slate, generous spacing, rounded corners, Inter',
  'Bold streaming service: dark theme, vivid magenta accent, large headings',
  'Friendly kids-learning site: bright primary colors, very rounded, playful type',
  'Minimal B2B SaaS dashboard: monochrome with one blue accent, compact density',
];

/** The real (non-mock) provider AI features will use: top-bar choice → server default → first configured. */
function aiProvider(providers) {
  const real = providers.providers.filter((p) => p.configured && p.id !== 'mock');
  const pick = real.find((p) => p.id === state.settings.provider) ?? real.find((p) => p.id === providers.default) ?? real[0];
  if (!pick) return null;
  return { id: pick.id, label: pick.label, model: pick.id === state.settings.provider && state.settings.model ? state.settings.model : undefined };
}

export function ImportView({ go, providers }) {
  const ai = aiProvider(providers);
  let mode = 'url';
  let method = 'rules'; // 'rules' | 'ai'
  const status = h('div.status', { role: 'status', 'aria-live': 'polite' });
  const authorized = h('input', { type: 'checkbox', id: 'auth' });
  const authRow = h('label.check', { for: 'auth' }, authorized, h('span', 'I own this design or am authorized to use it. Extraction copies design tokens, not content.'));

  // ---- extraction method (shown for URL and Figma) ----
  const methodSeg = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Extraction method' },
    [['rules', 'Rule-based · free'], ['ai', ai ? `AI-assisted · ${ai.label}` : 'AI-assisted']].map(([id, label]) =>
      h('button', {
        role: 'radio', 'aria-checked': String(id === method), disabled: id === 'ai' && !ai,
        onclick: (e) => {
          method = id;
          methodSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
          methodHint.replaceChildren(...methodText());
        },
      }, label)));
  const methodText = () => method === 'ai'
    ? [`Measures the reference, then ${ai.label} reviews the evidence to pick true brand colors, fix roles and fill in component states and variants. One request, roughly 3–5k tokens. The page itself is never sent.`]
    : ['Measures the CSS deterministically — instant, no AI cost. Best for sites with clear CSS tokens.'];
  const methodHint = h('p.hint', ...methodText());
  const noKey = ai ? null : h('p.hint', 'AI-assisted extraction and AI creation need an API key. ', h('a', { href: '#settings' }, 'Add one in Settings →'));
  const methodBlock = () => h('div.stack', h('span.label', 'Extraction method'), methodSeg, methodHint, noKey);

  // ---- panels ----
  const urlInput = h('input.input', { type: 'url', placeholder: 'https://your-site.com', autocomplete: 'url', 'aria-label': 'Website URL' });
  const robots = h('input', { type: 'checkbox', checked: true, id: 'robots' });
  const figmaUrl = h('input.input', { type: 'url', placeholder: 'https://www.figma.com/design/<key>/…?node-id=…', 'aria-label': 'Figma URL' });
  const figmaToken = h('input.input', {
    type: 'password', autocomplete: 'off', 'aria-label': 'Figma token',
    placeholder: providers.figmaTokenConfigured ? 'Using the token saved in Settings (optional override)' : 'Figma personal access token (or save one in Settings)',
  });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Design system or project JSON' });
  const paste = h('textarea.input.mono', { rows: 6, placeholder: '…or paste a design-system JSON (for example one produced by the AI skill)', 'aria-label': 'Design system JSON' });
  const briefName = h('input.input', { placeholder: 'Name (optional)', 'aria-label': 'Design system name' });
  const brief = h('textarea.input', { rows: 4, placeholder: 'Describe the brand: industry, mood, colors, density, shape, typography…', 'aria-label': 'Design system brief' });

  const urlPanel = h('div.stack',
    h('label.label', 'Website URL'), urlInput,
    h('label.check', { for: 'robots' }, robots, h('span', 'Respect robots.txt')),
    h('p.hint', 'Reads the page HTML and its stylesheets — no JavaScript is executed.'));
  const figmaPanel = h('div.stack',
    h('label.label', 'Figma file or frame URL'), figmaUrl,
    h('label.label', 'Access token'), figmaToken,
    h('p.hint', 'A token typed here is used for this request only. Link a specific frame (node-id) for faster, focused results.'));
  const createPanel = h('div.stack',
    ai ? h('p.hint', `${ai.label} designs an original system from your description — colors, type, spacing, radii, shadows and components. One request, roughly 2–4k tokens.`)
      : h('p.notice', 'Creating a design system with AI needs an API key. ', h('button.btn.btn--sm', { onclick: () => go('settings') }, 'Add an API key')),
    briefName, brief,
    h('div.row', BRIEF_EXAMPLES.map((b) => h('button.chip', { onclick: () => { brief.value = b; brief.focus(); } }, b))));
  const filePanel = h('div.stack', h('label.label', 'Design system or project file'), fileInput, paste);
  const panels = { url: urlPanel, figma: figmaPanel, create: createPanel, file: filePanel };

  const body = h('div.panel-body');
  const methodSlot = h('div');
  const runBtn = h('button.btn.btn--primary', { onclick: run });
  const blankBtn = h('button.btn', { onclick: () => { setDesignSystem(completeDesignSystem({ meta: { name: 'My design system' } })); go('tokens'); } }, 'Start from a blank system');
  const show = (id) => {
    mode = id;
    body.replaceChildren(panels[id]);
    authRow.hidden = id === 'file' || id === 'create';
    methodSlot.replaceChildren(...(id === 'url' || id === 'figma' ? [methodBlock()] : []));
    runBtn.textContent = id === 'create' ? 'Create design system' : id === 'file' ? 'Import file' : 'Extract design system';
    runBtn.disabled = id === 'create' && !ai;
    status.textContent = '';
  };
  const tabs = h('div.segmented', { role: 'tablist' },
    [['url', 'Website URL'], ['figma', 'Figma'], ['create', '✦ Create with AI'], ['file', 'JSON file']].map(([id, label]) =>
      h('button', { role: 'tab', 'aria-selected': String(id === mode), onclick: (e) => {
        tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget)));
        show(id);
      } }, label)));
  show('url');

  // Progress: what is happening, how long it has taken, and a way out. AI replies often take 20–90 s.
  let controller = null;
  let ticker = null;
  const cancelBtn = h('button.btn.btn--sm', { onclick: () => controller?.abort() }, 'Cancel');
  const working = (text, aiNote) => {
    const started = Date.now();
    const clock = h('span.mono', '0s');
    status.className = 'status status--working';
    status.replaceChildren(h('span.spinner'),
      h('div.stack-xs', h('span', text), aiNote ? h('span.hint', aiNote) : null),
      clock, cancelBtn);
    clearInterval(ticker);
    ticker = setInterval(() => { clock.textContent = `${Math.round((Date.now() - started) / 1000)}s`; }, 1000);
  };
  const stopWorking = () => { clearInterval(ticker); ticker = null; controller = null; };
  const AI_NOTE = (label) => `${label} is reading the measurements and writing the design system. This usually takes 20–90 seconds; you can keep this tab open and cancel any time.`;
  const aiBody = () => ({ provider: ai.id, model: ai.model });
  const done = (res, verb) => {
    const ds = res.designSystem;
    setDesignSystem(ds);
    figmaToken.value = '';
    stopWorking();
    const cost = res.usage ? ` · ${res.usage.inputTokens + res.usage.outputTokens} tokens` : '';
    if (res.aiError) toast(`The AI review failed, so you're seeing the free rule-based result. ${res.aiError}`, 'error');
    else toast(`${verb} "${ds.meta.name}"${cost}`, 'success');
    go('tokens');
  };

  async function run() {
    status.className = 'status';
    try {
      if (mode === 'file') {
        const text = fileInput.files[0] ? await fileInput.files[0].text() : paste.value.trim();
        if (!text) throw new Error('Choose a file or paste JSON');
        toast(importProject(text) === 'project' ? 'Project imported' : 'Design system imported', 'success');
        return go('tokens');
      }
      runBtn.disabled = true;
      controller = new AbortController();
      const { signal } = controller;
      if (mode === 'create') {
        if (brief.value.trim().length < 8) throw new Error('Describe the design system in a sentence or two.');
        working(`Creating your design system with ${ai.label}…`, AI_NOTE(ai.label));
        return done(await api.create({ brief: brief.value.trim(), name: briefName.value.trim() || undefined, ai: aiBody() }, signal), 'Created');
      }
      if (!authorized.checked) throw new Error('Please confirm you own or are authorized to use this design.');
      const useAi = method === 'ai' && ai;
      working(
        useAi ? `Step 1: measuring ${mode === 'url' ? 'the website' : 'the Figma file'} (a few seconds) · Step 2: ${ai.label} reviews it` : mode === 'url' ? 'Fetching the page and its stylesheets…' : 'Reading the Figma file…',
        useAi ? AI_NOTE(ai.label) : null);
      const res = mode === 'url'
        ? await api.extractUrl({ url: urlInput.value.trim(), respectRobots: robots.checked, authorized: true, ai: useAi ? aiBody() : undefined }, signal)
        : await api.extractFigma({ url: figmaUrl.value.trim(), token: figmaToken.value.trim() || undefined, authorized: true, ai: useAi ? aiBody() : undefined }, signal);
      done(res, useAi ? 'AI-extracted' : 'Extracted');
    } catch (e) {
      status.className = 'status status--error';
      status.textContent = e.name === 'AbortError' ? 'Cancelled — no design system was changed.' : e.message;
    } finally {
      stopWorking();
      runBtn.disabled = mode === 'create' && !ai;
    }
  }
  [urlInput, figmaUrl].forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && run()));

  return h('div.view',
    h('header.view-head', h('h1', 'Import a reference'), h('p.muted', 'Point at a website or Figma file you own, or describe a brand and let AI design the system. You get colors, type, spacing, radii, shadows, components and patterns.')),
    h('section.panel', tabs, body, methodSlot, authRow, h('div.row', runBtn, blankBtn), status),
    state.ds ? h('p.muted', 'Current system: ', h('strong', state.ds.meta.name), ' — importing replaces it (pages are kept).') : null,
  );
}
