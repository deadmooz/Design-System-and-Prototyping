/** Tiny DOM helpers. h('div.cls#id', {attrs}, ...children) — carried over from the original prototype kit. */

export function h(sel, attrs, ...kids) {
  const [tag, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tag || 'div');
  rest.forEach((s) => (s[0] === '.' ? el.classList.add(s.slice(1)) : (el.id = s.slice(1))));
  if (attrs && (attrs.nodeType || typeof attrs !== 'object' || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach((c) => c != null && c !== false && el.append(c.nodeType ? c : document.createTextNode(String(c))));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

let toastTimer;
export function toast(message, kind = 'info') {
  let el = $('#toast');
  if (!el) { el = h('div#toast', { role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.className = `toast toast--${kind} show`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3000);
}

export function download(filename, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed', 'error'); }
}

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';

/**
 * In-page replacement for confirm()/prompt(). Native dialogs are blocked or auto-dismissed in some
 * embedded browsers (for example desktop-app browser panes), which silently cancels the action.
 * Resolves to true/false, or to the entered text (null when cancelled) when `input` is given.
 */
export function ask({ title, message = '', confirmLabel = 'OK', danger = false, input = null }) {
  return new Promise((resolve) => {
    const field = input !== null ? h('input.input', { value: input, 'aria-label': title }) : null;
    const ok = h(`button.btn${danger ? '.btn--danger-solid' : '.btn--primary'}`, { type: 'submit' }, confirmLabel);
    const dlg = h('dialog.dialog', { 'aria-labelledby': 'dlg-title' },
      h('form.stack', { method: 'dialog' },
        h('h2#dlg-title', title), message ? h('p.muted', message) : null, field,
        h('div.row.end', h('button.btn', { type: 'button', onclick: () => dlg.close('cancel') }, 'Cancel'), ok)));
    dlg.addEventListener('close', () => {
      const confirmed = dlg.returnValue !== 'cancel' && dlg.returnValue !== '';
      dlg.remove();
      resolve(field ? (confirmed ? field.value : null) : confirmed);
    });
    ok.addEventListener('click', (e) => { e.preventDefault(); dlg.close('ok'); });
    dlg.addEventListener('cancel', () => { dlg.returnValue = 'cancel'; }); // Escape key
    document.body.append(dlg);
    dlg.showModal();
    (field ?? ok).focus();
    if (field) field.select();
  });
}

/** Sandboxed preview iframe: scripts allowed, no same-origin, so generated code cannot reach the workspace. */
export function previewFrame(title) {
  return h('iframe.preview', { title, sandbox: 'allow-scripts allow-forms allow-modals', referrerpolicy: 'no-referrer' });
}
