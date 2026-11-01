/**
 * Project state: design system + prototype + per-page chat/version history.
 * Persisted to this browser's localStorage as a convenience; export/import
 * the project file for anything you want to keep or share.
 */

import { completeDesignSystem, parseDesignSystem } from '/src/core/defaults.ts';

const KEY = 'dsp.project.v1';
const MAX_VERSIONS = 10;

const blankPrototype = () => ({ name: 'Prototype', pages: [{ id: 'home', name: 'Home', html: '' }], components: [] });

function initial() {
  return { ds: null, prototype: blankPrototype(), currentPage: 'home', chat: {}, versions: {}, settings: { provider: '', model: '', device: 'desktop' } };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initial();
    const s = JSON.parse(raw);
    return { ...initial(), ...s, ds: s.ds ? parseDesignSystem(s.ds) : null };
  } catch {
    return initial();
  }
}

const listeners = new Set();
export const state = load();

let saveWarned = false;
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    if (!saveWarned) { saveWarned = true; console.warn('Project too large for browser storage — use Export project to keep it.'); }
  }
}

export function update(mutator, { silent = false } = {}) {
  mutator(state);
  persist();
  if (!silent) listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setDesignSystem(ds) {
  update((s) => { s.ds = completeDesignSystem(ds); });
}

export function currentPage() {
  return state.prototype.pages.find((p) => p.id === state.currentPage) ?? state.prototype.pages[0];
}

/** Store new html for a page, keeping the previous version for undo. */
export function setPageHtml(pageId, html) {
  update((s) => {
    const page = s.prototype.pages.find((p) => p.id === pageId);
    if (!page) return;
    const v = (s.versions[pageId] ??= []);
    if (page.html) { v.push(page.html); if (v.length > MAX_VERSIONS) v.shift(); }
    page.html = html;
    page.updatedAt = new Date().toISOString();
  });
}

export function undoPage(pageId) {
  const v = state.versions[pageId];
  if (!v?.length) return false;
  update((s) => { s.prototype.pages.find((p) => p.id === pageId).html = s.versions[pageId].pop(); });
  return true;
}

export function exportProject() {
  return JSON.stringify({ kind: 'dsp-project', version: 1, ds: state.ds, prototype: state.prototype, chat: state.chat }, null, 2);
}

export function importProject(text) {
  const data = JSON.parse(text);
  if (data.kind === 'dsp-project') {
    update((s) => {
      s.ds = data.ds ? parseDesignSystem(data.ds) : null;
      s.prototype = data.prototype?.pages?.length ? data.prototype : blankPrototype();
      s.prototype.components ??= [];
      s.chat = data.chat ?? {};
      s.versions = {};
      s.currentPage = s.prototype.pages[0].id;
    });
    return 'project';
  }
  setDesignSystem(parseDesignSystem(data)); // a bare design-system JSON (e.g. produced by the skill)
  return 'design-system';
}

export function resetProject() {
  update((s) => Object.assign(s, initial()));
}
