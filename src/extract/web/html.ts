/** Regex-level HTML inspection (no DOM dependency): metadata, element counts, navigation. */

import type { ComponentType, NavigationPattern } from '../../core/schema.ts';

export interface HtmlInsights {
  title: string;
  description: string;
  themeColor: string | null;
  fontLinks: string[];
  componentCounts: Record<ComponentType, number>;
  navigation: Omit<NavigationPattern, 'sticky'>;
  styleAttributes: string[];
  scriptCount: number;
  textLength: number;
  features: string[];
}

const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v !== undefined) ?? '';

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
const textOf = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function analyzeHtml(html: string, pageUrl: string): HtmlInsights {
  const head = html.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? html.slice(0, 20000);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (key: string) => {
    const t = metas.find((m) => new RegExp(`(name|property)\\s*=\\s*["']${key}["']`, 'i').test(m));
    return t ? decode(attr(t, 'content')) : '';
  };
  const siteName = meta('og:site_name');
  const rawTitle = textOf(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const title = siteName || rawTitle.split(/\s[|–—\-:·]\s/)[0].trim() || new URL(pageUrl).hostname.replace(/^www\./, '');

  const fontLinks = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => attr(m[0], 'href'))
    .filter((h) => /fonts\.googleapis\.com\/css|fonts\.bunny\.net\/css|use\.typekit\.net\/.+\.css|rsms\.me\/inter/i.test(h))
    .map((h) => { try { return new URL(decode(h), pageUrl).href; } catch { return ''; } })
    .filter(Boolean);

  const body = html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html;
  const noScript = body.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, '');
  const count = (re: RegExp) => (noScript.match(re) || []).length;
  const classTokens = [...noScript.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)].flatMap((m) => m[1].split(/\s+/));
  const classCount = (re: RegExp) => classTokens.filter((c) => re.test(c)).length;

  const inputs = [...noScript.matchAll(/<input\b[^>]*>/gi)].filter((m) => !/type\s*=\s*["']?(hidden|checkbox|radio|submit|button|image)/i.test(m[0])).length;
  const componentCounts: Record<ComponentType, number> = {
    button: count(/<button\b/gi) + classCount(/^(btn|button)$|^(btn|button)[-_]|[-_](btn|button)$/i) + count(/<input\b[^>]*type\s*=\s*["']?(submit|button)/gi),
    input: inputs + count(/<textarea\b/gi) + count(/<select\b/gi),
    card: classCount(/(^|[-_])card($|[-_])/i),
    badge: classCount(/(^|[-_])(badge|chip|pill|tag)($|[-_])/i),
    link: count(/<a\b[^>]*href/gi),
    nav: count(/<nav\b/gi) + count(/role\s*=\s*["']navigation/gi),
    modal: count(/<dialog\b/gi) + classCount(/(^|[-_])(modal|dialog)($|[-_])/i),
    avatar: classCount(/(^|[-_])avatar($|[-_])/i),
  };

  // Navigation: first <nav>, else <header>.
  const navHtml = noScript.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? noScript.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? '';
  const headerHtml = noScript.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? navHtml;
  const items = [...navHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => textOf(m[1]))
    .filter((t) => t.length > 1 && t.length < 32)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 8);
  const sidebar = /<aside\b[^>]*>[\s\S]{0,400}<nav\b|class\s*=\s*["'][^"']*\bsidebar\b/i.test(noScript);
  const navigation: HtmlInsights['navigation'] = {
    type: navHtml ? (sidebar ? 'sidebar' : 'topbar') : sidebar ? 'sidebar' : 'none',
    hasMobileMenu: /hamburger|burger|menu-toggle|nav-toggle|navbar-toggler|mobile-menu|aria-controls\s*=\s*["'][^"']*(menu|nav)|aria-label\s*=\s*["'][^"']*menu/i.test(headerHtml || noScript.slice(0, 30000)),
    hasSearch: /type\s*=\s*["']search|role\s*=\s*["']search|aria-label\s*=\s*["'][^"']*search/i.test(headerHtml || ''),
    items,
  };

  const features: string[] = [];
  const has = (re: RegExp) => re.test(noScript);
  if (has(/class\s*=\s*["'][^"']*\bdropdown|aria-haspopup/i)) features.push('dropdown menus');
  if (has(/carousel|swiper|slick-|splide|embla/i)) features.push('carousel / slider');
  if (has(/<details\b|accordion|aria-expanded/i)) features.push('accordion / disclosure');
  if (has(/role\s*=\s*["']tab["']|class\s*=\s*["'][^"']*\btabs?\b/i)) features.push('tabs');
  if (componentCounts.modal) features.push('modal / dialog');
  if (count(/<form\b/gi)) features.push('forms');

  return {
    title,
    description: meta('description') || meta('og:description'),
    themeColor: meta('theme-color') || null,
    fontLinks: [...new Set(fontLinks)],
    componentCounts,
    navigation,
    styleAttributes: [...noScript.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => decode(m[1])).slice(0, 2000),
    scriptCount: (html.match(/<script\b/gi) || []).length,
    textLength: textOf(noScript).length,
    features,
  };
}
