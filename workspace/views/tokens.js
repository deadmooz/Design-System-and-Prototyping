import { contrastRatio, generateScale, normalizeColor } from '/src/core/color.ts';
import { exportDesignSystem } from '/src/core/emit.ts';
import { COLOR_ROLES, TYPE_STEPS } from '/src/core/schema.ts';
import { copy, download, h } from '../lib/dom.js';
import { state, update } from '../lib/store.js';

const ROLE_LABEL = {
  primary: 'Primary', onPrimary: 'On primary', secondary: 'Secondary', accent: 'Accent', background: 'Background', surface: 'Surface',
  text: 'Text', textMuted: 'Muted text', border: 'Border', success: 'Success', warning: 'Warning', error: 'Error', info: 'Info',
};
const SCALED = { primary: 'primary', secondary: 'secondary', accent: 'accent' };

export function TokensView({ go, rerender }) {
  const ds = state.ds;
  if (!ds) return emptyState(go);
  // Commit on `change` (not `input`) so re-rendering never steals focus mid-edit.
  const commit = (fn) => { update(fn, { silent: true }); rerender(); };

  const roleCard = (role) => {
    const value = ds.color.roles[role];
    const picker = h('input', { type: 'color', value: value.slice(0, 7), 'aria-label': `${ROLE_LABEL[role]} color` });
    const hex = h('input.input.mono.hex', { value, 'aria-label': `${ROLE_LABEL[role]} hex` });
    const apply = (v) => {
      const n = normalizeColor(v)?.slice(0, 7);
      if (!n) return;
      commit((s) => {
        s.ds.color.roles[role] = n;
        if (SCALED[role]) s.ds.color.scales[SCALED[role]] = generateScale(n);
      });
    };
    picker.addEventListener('input', () => { hex.value = picker.value.toUpperCase(); picker.parentElement.style.background = picker.value; });
    picker.addEventListener('change', () => apply(picker.value));
    hex.addEventListener('change', () => apply(hex.value));
    const onBg = role === 'text' || role === 'textMuted' ? ds.color.roles.background : role === 'onPrimary' ? ds.color.roles.primary : null;
    const ratio = onBg ? contrastRatio(value, onBg) : null;
    return h('div.role',
      h('div.swatch', { style: { background: value } }, picker),
      h('div.role-meta', h('strong', ROLE_LABEL[role]), hex, ratio ? h('span.badge' + (ratio < 4.5 ? '.badge--warn' : ''), `${ratio.toFixed(1)}:1`) : null));
  };

  const scales = Object.entries(ds.color.scales).map(([name, scale]) =>
    h('div.scale', h('span.scale-name', name), h('div.scale-row', Object.entries(scale).map(([step, hex]) =>
      h('button.scale-cell', { style: { background: hex, color: Number(step) >= 500 ? '#fff' : '#111' }, title: `${name}-${step} ${hex}`, onclick: () => copy(`var(--ds-${name}-${step})`) }, step)))));

  const palette = ds.color.palette.length
    ? h('div.palette', ds.color.palette.map((p) => h('button.chip', { title: `${p.value} · used ${p.count}× · ${p.usage.join(', ')}`, onclick: () => copy(p.value) }, h('span.dot', { style: { background: p.value } }), p.value)))
    : h('p.muted', 'No palette evidence (blank or manual system).');

  const famInput = (key, label) => {
    const i = h('input.input', { value: ds.typography.families[key], 'aria-label': `${label} font stack` });
    i.addEventListener('change', () => commit((s) => { s.ds.typography.families[key] = i.value.replace(/[;{}<>]/g, ''); }));
    return h('label.field', h('span.label', label), i);
  };
  const typeRows = TYPE_STEPS.slice().reverse().map((step) => {
    const t = ds.typography.scale[step];
    const size = h('input.input.num', { type: 'number', min: 8, max: 160, value: t.size, 'aria-label': `${step} size` });
    const weight = h('input.input.num', { type: 'number', min: 100, max: 900, step: 100, value: t.weight, 'aria-label': `${step} weight` });
    size.addEventListener('change', () => commit((s) => { s.ds.typography.scale[step].size = Math.max(8, Math.min(160, Number(size.value) || t.size)); }));
    weight.addEventListener('change', () => commit((s) => { s.ds.typography.scale[step].weight = Math.max(100, Math.min(900, Number(weight.value) || t.weight)); }));
    const fam = step.match(/xl/) ? ds.typography.families.heading : ds.typography.families.sans;
    return h('div.type-row',
      h('span.mono.step', step), size, weight,
      h('span.sample', { style: { fontFamily: fam, fontSize: `${Math.min(t.size, 56)}px`, fontWeight: t.weight, lineHeight: t.lineHeight } }, 'The quick brown fox'));
  });

  const numberList = (label, entries, onChange) => h('div.tokens-list', h('h3', label), entries.map(([k, v]) => {
    const i = h('input.input.num', { type: 'number', min: 0, value: v, 'aria-label': `${label} ${k}` });
    i.addEventListener('change', () => onChange(k, Math.max(0, Number(i.value) || 0)));
    return h('label.kv', h('span.mono', k), i);
  }));

  const spacing = h('div.spacing', ds.spacing.scale.map((px, i) => h('div.space-row', h('span.mono', `space-${i}`), h('div.space-bar', { style: { width: `${Math.min(px, 160)}px` } }), h('span.muted', `${px}px`))));
  const radius = h('div.boxes', Object.entries(ds.radius).filter(([k]) => k !== 'none').map(([k, v]) => h('div.box', { style: { borderRadius: `${Math.min(v, 60)}px` } }, h('span', k), h('small', k === 'full' ? '∞' : `${v}px`))));
  const shadows = h('div.boxes', Object.entries(ds.shadow).map(([k, v]) => h('div.box.box--shadow', { style: { boxShadow: v }, title: v }, h('span', k))));

  const nameInput = h('input.input.title-input', { value: ds.meta.name, 'aria-label': 'Design system name' });
  nameInput.addEventListener('change', () => commit((s) => { s.ds.meta.name = nameInput.value.slice(0, 80) || 'Untitled design system'; }));

  const exportBtn = (fmt, label) => h('button.btn', { onclick: () => { const f = exportDesignSystem(state.ds, fmt); download(f.filename, f.content); } }, label);
  const comps = Object.entries(ds.components).filter(([, c]) => c?.found);
  const nav = ds.patterns.navigation;

  return h('div.view',
    h('header.view-head',
      h('div.stack-sm', nameInput,
        ds.meta.source.type === 'ai'
          ? h('p.muted', '✦ Generated by AI from: ', h('em', ds.meta.source.ref))
          : h('p.muted', `${ds.meta.source.type === 'manual' ? 'Manual' : `From ${ds.meta.source.type}`} ${ds.meta.source.ref ? '· ' + ds.meta.source.ref : ''}`),
        ds.meta.source.type === 'ai' ? null
          : h('div.meter', { title: 'How much real evidence the extractor found' }, h('div', { style: { width: `${Math.round(ds.meta.confidence * 100)}%` } }), h('span', `Confidence ${Math.round(ds.meta.confidence * 100)}%`))),
      h('div.row', exportBtn('json', 'JSON'), exportBtn('css', 'CSS variables'), exportBtn('tailwind', 'Tailwind'), exportBtn('ts', 'TypeScript'), h('button.btn.btn--primary', { onclick: () => go('prototype') }, 'Prototype with it →'))),
    ds.meta.notes.length ? h('ul.notes', ds.meta.notes.map((n) => h('li', n))) : null,
    h('section.panel', h('h2', 'Color roles'), h('div.roles', COLOR_ROLES.map(roleCard))),
    h('section.panel', h('h2', 'Scales'), h('p.hint', 'Click a step to copy its CSS variable.'), scales),
    h('section.panel', h('h2', 'Extracted palette'), palette),
    h('section.panel', h('h2', 'Typography'), h('div.grid-3', famInput('sans', 'Body'), famInput('heading', 'Headings'), famInput('mono', 'Monospace')),
      h('div.type-head', h('span', 'step'), h('span', 'px'), h('span', 'weight'), h('span', 'sample')), typeRows),
    h('section.panel.grid-2',
      h('div', h('h2', 'Spacing'), h('p.hint', `Base unit ${ds.spacing.base}px`), spacing),
      h('div', h('h2', 'Radius'), radius, h('h2', 'Shadows'), shadows)),
    h('section.panel.grid-3',
      numberList('Radius (px)', Object.entries(ds.radius).filter(([k]) => k !== 'none' && k !== 'full'), (k, v) => commit((s) => { s.ds.radius[k] = v; })),
      numberList('Breakpoints (px)', Object.entries(ds.breakpoints), (k, v) => commit((s) => { s.ds.breakpoints[k] = v; })),
      numberList('Layout (px)', Object.entries(ds.layout), (k, v) => commit((s) => { s.ds.layout[k] = v; }))),
    h('section.panel', h('h2', 'Components & patterns'),
      comps.length ? h('p', comps.map(([k, c]) => h('span.badge', `${k}${c.count ? ` ×${c.count}` : ''}`))) : h('p.muted', 'No component evidence.'),
      h('p.muted', `Navigation: ${nav.type}${nav.sticky ? ', sticky' : ''}${nav.hasMobileMenu ? ', mobile menu' : ''}${nav.hasSearch ? ', search' : ''}${nav.items.length ? ` — ${nav.items.join(' · ')}` : ''}`),
      ds.patterns.interactions.length ? h('p.muted', `Interactions: ${ds.patterns.interactions.join(', ')}`) : null,
      h('button.btn', { onclick: () => go('components') }, 'Inspect components →')),
  );
}

export function emptyState(go) {
  return h('div.view.empty', h('h1', 'No design system yet'), h('p.muted', 'Import a website or Figma file, load a JSON file, or start blank.'), h('button.btn.btn--primary', { onclick: () => go('import') }, 'Import a reference'));
}
