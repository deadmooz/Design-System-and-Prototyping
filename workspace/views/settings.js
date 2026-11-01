import { api } from '../lib/api.js';
import { ask, h, toast } from '../lib/dom.js';

const SOURCE_LABEL = { saved: 'Saved in .env', environment: 'From system environment' };

/** API keys are sent once to the local server, stored in its .env, and never shown again (only the last 4 characters). */
export function SettingsView({ refreshProviders }) {
  const root = h('div.view',
    h('header.view-head', h('div', h('h1', 'Settings'),
      h('p.muted', 'Add API keys to use real AI models. Keys are saved in the server\'s .env file on this computer, never in the browser, and are only shown as their last 4 characters.'))),
    h('p.status', h('span.spinner'), ' Loading…'));

  let data = null;
  const load = async () => {
    try {
      data = await api.settings();
      draw();
    } catch (e) {
      root.replaceChildren(h('div.view-head', h('h1', 'Settings')), h('p.status.status--error', e.message));
    }
  };

  const afterChange = async (next, message) => {
    data = next;
    draw();
    await refreshProviders();
    toast(message, 'success');
  };

  function card(p) {
    const isLLM = p.id !== 'figma';
    const keyInput = h('input.input.mono', {
      type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': `${p.label} API key`,
      placeholder: p.configured ? `Replace key (current ${p.keyHint})` : isLLM ? 'Paste API key' : 'Paste personal access token',
    });
    const modelInput = isLLM ? h('input.input.mono', { value: p.model ?? '', placeholder: `Default: ${p.defaultModel}`, 'aria-label': `${p.label} model`, spellcheck: 'false' }) : null;
    const status = h('div.status', { role: 'status' });
    const busy = (btn, on) => { btn.disabled = on; };

    const save = h('button.btn.btn--primary.btn--sm', { onclick: async () => {
      const apiKey = keyInput.value.trim();
      const model = modelInput ? modelInput.value.trim() : undefined;
      if (!apiKey && (modelInput === null || model === (p.model ?? ''))) return void (status.textContent = 'Nothing to save.');
      busy(save, true);
      status.className = 'status';
      try {
        const next = await api.saveSetting({ id: p.id, ...(apiKey ? { apiKey } : {}), ...(modelInput ? { model } : {}) });
        keyInput.value = '';
        await afterChange(next, `${p.label} saved`);
      } catch (e) {
        status.className = 'status status--error';
        status.textContent = e.message;
      } finally {
        busy(save, false);
      }
    } }, 'Save');

    const test = isLLM && p.configured ? h('button.btn.btn--sm', { onclick: async () => {
      busy(test, true);
      status.className = 'status';
      status.replaceChildren(h('span.spinner'), ' Sending a tiny test request…');
      try {
        const r = await api.testProvider(p.id);
        status.className = 'status status--ok';
        status.textContent = `Works — ${r.model} replied "${r.reply}" (${r.usage.inputTokens + r.usage.outputTokens} tokens).`;
      } catch (e) {
        status.className = 'status status--error';
        status.textContent = e.message;
      } finally {
        busy(test, false);
      }
    }, title: 'Makes one very small API call (about 20 tokens)' }, 'Test key') : null;

    const remove = p.source === 'saved' ? h('button.btn.btn--sm.btn--danger', { onclick: async () => {
      const yes = await ask({ title: `Remove the ${p.label} key?`, message: `It will be deleted from .env and ${p.label} stops working until you add a key again.`, confirmLabel: 'Remove key', danger: true });
      if (!yes) return;
      try { await afterChange(await api.saveSetting({ id: p.id, remove: true }), `${p.label} key removed`); }
      catch (e) { status.className = 'status status--error'; status.textContent = e.message; }
    }, title: `Delete the ${p.label} key from .env` }, 'Remove key') : null;

    keyInput.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());

    return h('section.panel.key-card',
      h('div.row.between',
        h('h2', p.label),
        h('div.row', p.configured ? h('span.badge.badge--ok', `Connected ${p.keyHint}`) : h('span.badge', 'Not set'), remove)),
      p.source ? h('p.hint', SOURCE_LABEL[p.source], p.source === 'environment' ? ' — remove it from your system environment variables, then restart the server.' : '') : null,
      h('label.field', h('span.label', isLLM ? 'API key' : 'Personal access token'), keyInput),
      modelInput ? h('label.field', h('span.label', 'Model (optional)'), modelInput) : null,
      h('div.row', save, test, h('a.hint', { href: p.help, target: '_blank', rel: 'noopener noreferrer' }, isLLM ? 'Get a key ↗' : 'Create a token ↗')),
      status);
  }

  function draw() {
    const llms = data.providers.filter((p) => p.id !== 'figma');
    const figma = data.providers.find((p) => p.id === 'figma');
    const options = [{ id: 'mock', label: 'Offline mock (no API calls)', configured: true }, ...llms];
    const select = h('select.input', { 'aria-label': 'Default provider', onchange: async (e) => {
      try { await afterChange(await api.setDefaultProvider(e.target.value), 'Default provider saved'); }
      catch (err) { toast(err.message, 'error'); }
    } }, options.map((p) => h('option', { value: p.id, selected: p.id === data.defaultProvider, disabled: !p.configured }, `${p.label}${p.configured ? '' : ' — add a key first'}`)));

    root.replaceChildren(
      root.firstChild,
      h('section.panel', h('h2', 'Default AI provider'),
        h('p.hint', 'Used when no provider is picked in the top bar. You can still switch per request.'),
        h('div', { style: { maxWidth: '360px' } }, select)),
      h('div.key-grid', llms.map(card)),
      h('h2.section-title', 'Design sources'),
      h('div.key-grid', card(figma)),
      h('p.hint', 'Keys stay on this computer. Anyone who can use this server can spend them, so keep it on 127.0.0.1 (the default). Real AI calls cost money; the "Test key" button uses about 20 tokens.'));
  }

  load();
  return root;
}
