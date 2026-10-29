#!/usr/bin/env node
// Checks the SEO basics of pages served by the local site (what Google receives in the HTML).
//   node seo_check.mjs --base http://localhost:3000 --paths /,/pricing,/blog/my-post [--links] [--ua browser] [--json]
//   node seo_check.mjs --file out/index.html
// Errors must be fixed before saving; warnings need a look; duplicates across pages are reported.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, list, emit, repoRoot, scratchDir, writeJson, loadConfig, previewUrl, foreignSite, workingTreeHash } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const UA = args.ua === 'browser'
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
  : 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = (h) => decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([^\s=<>"'/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) => attrs(m[1]));
}

export function analyzeHtml(html, url) {
  const issues = [];
  const add = (level, msg) => issues.push({ level, msg });
  const htmlTag = attrs((/<html\b([^>]*)>/i.exec(html) || ['', ''])[1]);
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => strip(m[1]));
  const metas = tags(html, 'meta');
  const links = tags(html, 'link');
  const meta = (k) => (metas.find((m) => (m.name || m.property || '').toLowerCase() === k) || {}).content;
  const title = titles[0] || '';
  const desc = meta('description') || '';
  const robots = (meta('robots') || '') + ' ' + (meta('googlebot') || '');
  const canonicals = links.filter((l) => (l.rel || '').toLowerCase() === 'canonical').map((l) => l.href);
  const hreflang = links.filter((l) => (l.rel || '').toLowerCase() === 'alternate' && l.hreflang).map((l) => ({ lang: l.hreflang, href: l.href }));
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: strip(m[2]).slice(0, 120) }));
  const h1s = headings.filter((h) => h.level === 1);
  const imgs = tags(html, 'img');
  const noAlt = imgs.filter((i) => !('alt' in i));
  const jsonLd = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      const items = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
      for (const it of items) jsonLd.push({ type: [].concat(it['@type'] || 'unknown').join(','), ok: true });
    } catch (e) { jsonLd.push({ type: 'INVALID', ok: false, error: e.message.slice(0, 120) }); }
  }
  const bodyText = strip((/<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html) || ['', html])[1]);
  const words = bodyText ? bodyText.split(/\s+/).length : 0;
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ ...attrs(m[1]), text: strip(m[2]) }));
  const origin = (() => { try { return new URL(url).origin; } catch { return ''; } })();
  const internal = [...new Set(anchors.map((a) => a.href).filter((h) => h && !/^(mailto:|tel:|javascript:|#)/i.test(h)).map((h) => { try { return new URL(h, url); } catch { return null; } })
    .filter((u) => u && u.origin === origin).map((u) => u.pathname + u.search))];
  const emptyLinks = anchors.filter((a) => !a.text && !a['aria-label'] && !/<img[^>]+alt="[^"]+"/i.test(a.text || '')).length;

  if (!htmlTag.lang) add('warning', '<html> has no lang attribute');
  if (!title) add('error', 'missing <title>');
  else if (title.length > 65) add('warning', `title is ${title.length} characters (aim for 50-60 so it is not cut off)`);
  else if (title.length < 25) add('warning', `title is only ${title.length} characters (say what the page offers)`);
  if (titles.length > 1) add('warning', `${titles.length} <title> tags found`);
  if (!desc) add('error', 'missing meta description');
  else if (desc.length > 165) add('warning', `meta description is ${desc.length} characters (aim for 140-160)`);
  else if (desc.length < 70) add('warning', `meta description is only ${desc.length} characters (aim for 140-160)`);
  if (/noindex/i.test(robots)) add(args['allow-noindex'] ? 'info' : 'error', `page says noindex (${robots.trim()}) - Google will drop it`);
  if (!canonicals.length) add('warning', 'no canonical link');
  else if (canonicals.length > 1) add('error', `${canonicals.length} canonical links (must be exactly one)`);
  else {
    try {
      const c = new URL(canonicals[0], url), u = new URL(url);
      if (c.pathname.replace(/\/$/, '') !== u.pathname.replace(/\/$/, '')) add('warning', `canonical points to a different path: ${c.pathname} (fine only if this page is a duplicate on purpose)`);
      if (!/^https?:\/\//.test(canonicals[0])) add('warning', 'canonical is not an absolute URL');
    } catch { add('error', `canonical is not a valid URL: ${canonicals[0]}`); }
  }
  if (h1s.length === 0) add('error', 'no H1 heading');
  if (h1s.length > 1) add('warning', `${h1s.length} H1 headings (use one)`);
  for (let i = 1; i < headings.length; i++) if (headings[i].level > headings[i - 1].level + 1) { add('warning', `heading jumps from H${headings[i - 1].level} to H${headings[i].level} ("${headings[i].text.slice(0, 50)}")`); break; }
  if (noAlt.length) add('warning', `${noAlt.length} image(s) without alt text (e.g. ${(noAlt[0].src || '').slice(0, 80)})`);
  for (const j of jsonLd.filter((x) => !x.ok)) add('error', `invalid JSON-LD schema: ${j.error}`);
  if (!meta('og:title')) add('warning', 'no og:title (social/AI previews)');
  if (!meta('og:description')) add('info', 'no og:description');
  if (!meta('og:image')) add('warning', 'no og:image (social previews)');
  if (!metas.some((m) => (m.name || '').toLowerCase() === 'viewport')) add('error', 'no viewport meta tag (mobile)');
  if (words < 250) add('warning', `only about ${words} words of visible text in the HTML (thin content, or text only appears after JavaScript runs)`);
  if (emptyLinks) add('warning', `${emptyLinks} link(s) without readable text or aria-label`);
  if (hreflang.length && !hreflang.some((h) => { try { return new URL(h.href, url).pathname === new URL(url).pathname; } catch { return false; } })) add('warning', 'hreflang set does not include this page itself');

  return {
    url, title, titleLength: title.length, description: desc, descriptionLength: desc.length, robots: robots.trim() || null,
    canonical: canonicals[0] || null, lang: htmlTag.lang || null, h1: h1s.map((h) => h.text), headings: headings.slice(0, 30),
    images: imgs.length, imagesWithoutAlt: noAlt.length, jsonLd, hreflang: hreflang.length, words, internalLinks: internal,
    og: { title: meta('og:title') || null, description: meta('og:description') || null, image: meta('og:image') || null }, issues,
  };
}

async function fetchPage(url) {
  const chain = [];
  let current = url;
  for (let i = 0; i < 8; i++) {
    const res = await fetch(current, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(Number(args.timeout || 60) * 1000) });
    chain.push({ url: current, status: res.status });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), current).href; continue; }
    return { res, html: await res.text(), chain, finalUrl: current };
  }
  throw new Error('too many redirects');
}

async function main() {
  const pages = [];
  if (args.file) {
    for (const f of list(args.file)) pages.push({ ...analyzeHtml(fs.readFileSync(f, 'utf8'), `http://localhost/${path.basename(f)}`), status: 200, chain: [] });
  } else {
    const root0 = repoRoot();
    const base = String(args.base || (root0 && previewUrl(root0)) || 'http://localhost:3000').replace(/\/$/, '');
    const cfg = root0 ? loadConfig(root0).config : null;
    const paths = list(args.paths).length ? list(args.paths) : ['/'];
    for (const p of paths) {
      const url = /^https?:/.test(p) ? p : base + (p.startsWith('/') ? p : '/' + p);
      try {
        const { res, html, chain, finalUrl } = await fetchPage(url);
        const a = analyzeHtml(html, finalUrl);
        a.status = res.status; a.chain = chain;
        const other = foreignSite(html, cfg);
        if (other) {
          a.issues.unshift({ level: 'error', msg: `this page belongs to another website (${other}), not this project: the preview is on a different address. Use the URL serve.mjs printed.` });
          a.foreign = true;
        }
        const xr = res.headers.get('x-robots-tag');
        if (xr && /noindex/i.test(xr)) a.issues.push({ level: 'error', msg: `X-Robots-Tag header says ${xr}` });
        if (res.status >= 400) a.issues.unshift({ level: 'error', msg: `HTTP ${res.status}` });
        if (chain.length > 1) a.issues.push({ level: chain.length > 2 ? 'warning' : 'info', msg: `redirects: ${chain.map((c) => `${c.status} ${new URL(c.url).pathname}`).join(' -> ')} -> ${new URL(finalUrl).pathname}` });
        if (args.links) {
          const broken = [];
          for (const l of a.internalLinks.slice(0, Number(args['max-links'] || 150))) {
            try { const r = await fetch(new URL(l, finalUrl), { method: 'GET', redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }); if (r.status >= 400) broken.push(`${r.status} ${l}`); } catch (e) { broken.push(`ERR ${l}`); }
          }
          if (broken.length) a.issues.push({ level: 'error', msg: `${broken.length} broken internal link(s): ${broken.slice(0, 8).join(', ')}` });
        }
        pages.push(a);
      } catch (e) {
        pages.push({ url, status: 0, issues: [{ level: 'error', msg: `could not load: ${e.message}. Is the local site running?` }] });
      }
    }
  }
  const dup = (key) => {
    const m = new Map();
    for (const p of pages) if (p[key]) m.set(p[key], [...(m.get(p[key]) || []), p.url]);
    return [...m.entries()].filter(([, v]) => v.length > 1);
  };
  const cross = [];
  for (const [v, urls] of dup('title')) cross.push({ level: 'error', msg: `same title on ${urls.length} pages ("${v.slice(0, 60)}"): ${urls.join(', ')}` });
  for (const [v, urls] of dup('description')) cross.push({ level: 'warning', msg: `same meta description on ${urls.length} pages: ${urls.join(', ')}` });
  for (const [, urls] of dup('canonical')) cross.push({ level: 'error', msg: `same canonical on ${urls.length} pages: ${urls.join(', ')}` });

  const errors = pages.reduce((n, p) => n + p.issues.filter((i) => i.level === 'error').length, 0) + cross.filter((i) => i.level === 'error').length;
  const report = { ok: errors === 0, errors, pages, crossPage: cross };
  const root = repoRoot();
  if (root && !args.file) {
    report.tree = workingTreeHash(root, loadConfig(root).config);
    report.at = new Date().toISOString();
    writeJson(path.join(scratchDir(root, 'reports'), 'seo-check.json'), report);
  }
  const lines = [];
  for (const p of pages) {
    lines.push(`\n${p.url}  [HTTP ${p.status}]`);
    if (p.title !== undefined) {
      lines.push(`  title (${p.titleLength}): ${p.title}`);
      lines.push(`  description (${p.descriptionLength}): ${p.description}`);
      lines.push(`  H1: ${(p.h1 || []).join(' | ') || '-'} | canonical: ${p.canonical || '-'} | lang: ${p.lang || '-'} | words: ${p.words} | schema: ${p.jsonLd.map((j) => j.type).join(', ') || '-'} | hreflang: ${p.hreflang}`);
    }
    for (const i of p.issues) lines.push(`  ${i.level.toUpperCase()}: ${i.msg}`);
  }
  if (cross.length) { lines.push('\nAcross pages:'); for (const i of cross) lines.push(`  ${i.level.toUpperCase()}: ${i.msg}`); }
  lines.push(`\nRESULT: ${errors ? `${errors} error(s) to fix` : 'no SEO errors'}`);
  emit(report, lines.join('\n'));
  process.exit(errors ? 2 : 0);
}

main();
