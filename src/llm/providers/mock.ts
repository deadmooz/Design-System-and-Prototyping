/**
 * Offline provider: deterministic, free, no network. Lets the whole product
 * (workspace, CLI, tests) run without API keys or token spend. It reads the
 * structured prompt built by src/prototype/prompts.ts and answers with a
 * template page made from the shared component classes.
 */

import type { CompletionRequest, CompletionResult, LLMProvider } from '../types.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function field(prompt: string, name: string): string {
  return prompt.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
}

function nav(pages: [string, string][], current: string) {
  const links = pages.map(([id, name]) => `<li><a href="#/${id}"${id === current ? ' aria-current="page"' : ''}>${esc(name)}</a></li>`).join('');
  return `<nav class="ds-nav ds-nav--sticky"><a class="ds-nav__brand" href="#/${pages[0]?.[0] ?? current}">Brand</a><ul class="ds-nav__links">${links}</ul><div class="ds-nav__actions"><a class="ds-btn ds-btn--ghost ds-btn--sm" href="#">Sign in</a><a class="ds-btn ds-btn--sm" href="#">Get started</a></div></nav>`;
}

export function mockPage(instruction: string, pageId: string, pageName: string, pages: [string, string][]): string {
  const i = instruction.toLowerCase();
  const title = instruction.length > 70 ? pageName : instruction.replace(/^(create|make|build|design|add|generate)\s+(an?\s+|the\s+)?/i, '');
  const sections: string[] = [nav(pages.length ? pages : [[pageId, pageName]], pageId)];
  if (/log ?in|sign ?(in|up)|register|auth/.test(i)) {
    sections.push(`<main class="ds-section"><div class="ds-container" style="max-width:420px"><div class="ds-card ds-stack"><h1 class="ds-h3">${/sign ?up|register/.test(i) ? 'Create your account' : 'Welcome back'}</h1><p class="ds-muted">Enter your details to continue.</p><label class="ds-field"><span class="ds-field__label">Email</span><input class="ds-field__control" type="email" placeholder="you@example.com"></label><label class="ds-field"><span class="ds-field__label">Password</span><input class="ds-field__control" type="password" placeholder="••••••••"></label><label class="ds-checkbox"><input type="checkbox" checked> Remember me</label><button class="ds-btn ds-btn--block">Continue</button></div></div></main>`);
  } else {
    sections.push(`<header class="ds-section"><div class="ds-container ds-stack" style="max-width:760px;text-align:center;align-items:center"><span class="ds-badge ds-badge--primary">New</span><h1 class="ds-h1">${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h1><p class="ds-lead">A prototype page generated offline by the mock provider using your design system tokens.</p><div class="ds-row" style="justify-content:center"><a class="ds-btn ds-btn--lg" href="#">Get started</a><a class="ds-btn ds-btn--outline ds-btn--lg" href="#">Learn more</a></div></div></header>`);
    if (/pric|plan|tier/.test(i)) {
      const tiers = [['Starter', '$0', 'For trying things out'], ['Pro', '$24', 'For growing teams'], ['Enterprise', 'Custom', 'For large organisations']];
      sections.push(`<section class="ds-section ds-surface"><div class="ds-container ds-grid">${tiers.map(([n, p, d], k) => `<div class="ds-card ds-stack"><div class="ds-row"><h2 class="ds-h4">${n}</h2>${k === 1 ? '<span class="ds-badge ds-badge--success">Popular</span>' : ''}</div><div class="ds-h2">${p}</div><p class="ds-muted">${d}</p><button class="ds-btn ${k === 1 ? '' : 'ds-btn--outline'} ds-btn--block">Choose ${n}</button></div>`).join('')}</div></section>`);
    } else {
      const items = /dashboard|admin|analytics/.test(i) ? ['Revenue', 'Active users', 'Conversion'] : ['Fast', 'Consistent', 'Accessible'];
      sections.push(`<section class="ds-section ds-surface"><div class="ds-container ds-grid">${items.map((t) => `<div class="ds-card ds-card--interactive ds-stack"><h2 class="ds-h4">${t}</h2><p class="ds-muted">Supporting copy for ${t.toLowerCase()} goes here.</p><a class="ds-link" href="#">Read more →</a></div>`).join('')}</div></section>`);
    }
    if (/contact|form|newsletter|subscribe/.test(i)) {
      sections.push(`<section class="ds-section"><div class="ds-container" style="max-width:560px"><form class="ds-card ds-stack" onsubmit="event.preventDefault();this.querySelector('[data-ok]').hidden=false"><h2 class="ds-h3">Get in touch</h2><label class="ds-field"><span class="ds-field__label">Name</span><input class="ds-field__control" required></label><label class="ds-field"><span class="ds-field__label">Message</span><textarea class="ds-field__control" rows="4"></textarea></label><button class="ds-btn">Send</button><p data-ok hidden class="ds-badge ds-badge--success">Thanks! (simulated)</p></form></div></section>`);
    }
  }
  sections.push(`<footer class="ds-footer"><div class="ds-container ds-row" style="justify-content:space-between"><span>© Brand</span><span class="ds-small">Prototype</span></div></footer>`);
  return sections.join('\n');
}

const HUES: [RegExp, string][] = [
  [/green|eco|nature|health/, '#16A34A'], [/teal|ocean|calm/, '#0D9488'], [/blue|trust|fintech|bank/, '#2563EB'],
  [/purple|violet|creative/, '#7C3AED'], [/pink|rose|beauty/, '#DB2777'], [/red|bold|energy/, '#DC2626'],
  [/orange|warm|food/, '#EA580C'], [/yellow|gold|sun/, '#CA8A04'],
];

/** Deterministic design-system JSON for the AI create/extract flows (no network). */
function mockDesignSystem(system: string, prompt: string): string {
  if (/design-systems engineer/.test(system)) {
    // extract: echo the rule-based draft back, as a model that agrees would.
    let draft: any = {};
    try { draft = JSON.parse(prompt).draft ?? {}; } catch { /* not JSON */ }
    return JSON.stringify({ roles: draft.roles ?? {}, notes: ['Mock provider: draft returned unchanged.'] });
  }
  const brief = prompt.toLowerCase();
  const primary = HUES.find(([re]) => re.test(brief))?.[1] ?? '#4F46E5';
  const dark = /dark|night|cinema|gaming/.test(brief);
  const rounded = /round|friendly|soft|playful/.test(brief);
  return JSON.stringify({
    name: 'Mock system',
    description: `Offline mock generated from: ${prompt.slice(7, 90)}`,
    roles: dark
      ? { primary, background: '#0B0D12', surface: '#151922', text: '#E6E8EE', textMuted: '#9AA3B2', border: '#262B36' }
      : { primary, background: '#FFFFFF', surface: '#F6F7F9', text: '#111827', textMuted: '#6B7280', border: '#E5E7EB' },
    fonts: { sans: "'Inter', system-ui, sans-serif", heading: "'Inter', system-ui, sans-serif", googleFonts: ['Inter'] },
    radius: rounded ? { sm: 8, md: 12, lg: 20, xl: 28 } : { sm: 4, md: 6, lg: 10, xl: 14 },
    components: { button: { base: { 'border-radius': rounded ? '999px' : '6px', padding: '10px 20px', 'font-weight': '600' }, states: { hover: { opacity: '0.9' } } } },
    navigation: { type: 'topbar', sticky: true, hasMobileMenu: true, hasSearch: false },
    notes: ['Mock provider: colors chosen from keywords in the brief.'],
  });
}

export function createMockProvider(): LLMProvider {
  return {
    id: 'mock',
    label: 'Offline mock (no API calls)',
    defaultModel: 'mock-1',
    configured: true,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const prompt = req.messages.at(-1)?.content ?? '';
      if (/design-systems (engineer|designer)/.test(req.system ?? '')) {
        const text = mockDesignSystem(req.system ?? '', prompt);
        return { text, provider: 'mock', model: req.model || 'mock-1', usage: { inputTokens: Math.ceil(((req.system ?? '').length + prompt.length) / 4), outputTokens: Math.ceil(text.length / 4) }, stopReason: 'end_turn' };
      }
      const instruction = field(prompt, 'INSTRUCTION') || 'Landing page';
      const [pageId, pageName] = (field(prompt, 'PAGE').match(/^(\S+)\s+"(.*)"$/)?.slice(1) ?? ['home', 'Home']) as [string, string];
      const pages = [...field(prompt, 'PAGES').matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]] as [string, string]);
      const current = prompt.match(/CURRENT HTML:\n```html\n([\s\S]*?)\n```/)?.[1];
      const note = `<section class="ds-section"><div class="ds-container"><div class="ds-card ds-card--muted"><strong>Mock edit:</strong> ${esc(instruction)}</div></div></section>`;
      const html = current === undefined
        ? mockPage(instruction, pageId, pageName, pages)
        : /<footer\b/.test(current) ? current.replace(/(<footer\b)/, `${note}\n$1`) : `${current}\n${note}`;
      const text = '```html\n' + html + '\n```';
      return { text, provider: 'mock', model: req.model || 'mock-1', usage: { inputTokens: Math.ceil(((req.system ?? '').length + prompt.length) / 4), outputTokens: Math.ceil(text.length / 4) }, stopReason: 'end_turn' };
    },
  };
}
