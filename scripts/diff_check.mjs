#!/usr/bin/env node
// Reviews everything this branch changes compared with main (saved + unsaved).
// Blockers stop a save or publish; warnings must be looked at and explained.
//   node diff_check.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireRepo, loadConfig, changesSinceMain, addedLines, removedLines, matchList, emit, gitOut } from './lib.mjs';

const CODE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|html?|njk|liquid|hbs|ejs|erb|php|twig)$/i;
const STYLE = /\.(css|scss|sass|less|pcss|styl)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/i;

// [regex, level, message] checked against each added line of code/markup files.
const ADDED_RULES = [
  [/@ts-(ignore|nocheck|expect-error)/, 'blocker', 'silences a TypeScript error instead of fixing it'],
  [/eslint-disable|stylelint-disable|biome-ignore|jshint ignore|noinspection/, 'blocker', 'switches off a code check instead of fixing the problem'],
  [/(^|[^.\w])(fetch|axios(\.\w+)?|ky(\.\w+)?|got|superagent|request)\s*\(\s*[`'"]/, 'blocker', 'adds a new network request; data must come from the existing data layer'],
  [/\bnew (XMLHttpRequest|WebSocket|EventSource)\b|navigator\.sendBeacon/, 'blocker', 'adds a new network connection; that is logic-layer work'],
  [/\$fetch\s*\(|\buse(Lazy)?Fetch\s*\(\s*[`'"]https?:/, 'blocker', 'adds a new network request; data must come from the existing data layer'],
  [/https?:\/\/[^\s'"`)]*(\/api\/|\/graphql|\/v\d+\/|api\.)[^\s'"`)]*/i, 'blocker', 'points at an API address directly; only the existing data layer talks to APIs'],
  [/\b(process\.env|import\.meta\.env|Deno\.env)\b/, 'blocker', 'reads environment settings/secrets; that is configuration work'],
  [/^\s*['"]use server['"]/, 'blocker', 'adds server-side logic (server actions)'],
  [/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/, 'blocker', 'adds browser storage/cookies logic'],
  [/googletagmanager|gtag\(|\bfbq\(|hotjar|clarity\.ms|segment\.com|mixpanel|posthog|amplitude|intercom|hs-scripts|<script[^>]+src=["']https?:/i, 'blocker', 'adds a tracking or third-party script; ask the developer to add it'],
  [/lorem ipsum|dolor sit amet/i, 'blocker', 'placeholder text is not production ready'],
  [/^\s*(<<<<<<<|>>>>>>>)( |$)|^={7}$/, 'blocker', 'leftover conflict marker'],
  [/\[(SOURCE|DATA|STAT|CITATION) NEEDED\]|\bTODO\b|\bFIXME\b|\bXXX\b|\bTBD\b/, 'warning', 'unfinished marker left in the change'],
  [/console\.(log|debug|info|warn|error)\s*\(/, 'warning', 'leftover console output'],
  [/\buse(State|Effect|LayoutEffect|Reducer|Context|SyncExternalStore|Transition)\b|\bcreateContext\b|\b(ref|reactive|watch|computed|onMounted)\s*\(/, 'warning', 'adds interactive state/logic; keep it to simple UI behaviour (open/close, tabs) and nothing data-related'],
  [/\bas any\b|:\s*any\b|<any>/, 'warning', 'uses "any" to get around a type'],
  [/!important|\s![a-z-]+[:-]|\b![a-z]+-\[/, 'warning', 'forces a style with !important; prefer the design system\'s own classes'],
  [/\b\d[\d,.]*\s*(k|K|m|M|\+)?\s*\+?\s*(travel+ers?|users?|customers?|clients?|members?|subscribers?|downloads?|installs?|reviews?|ratings?|companies|businesses|teams|countries|cities|flights|bookings|happy|satisfied|trusted)\b|\b\d(\.\d)?\s*(★|stars?\b|\/\s*5\b)|\b\d{1,3}\s?%\s*(of|faster|cheaper|more|less|on[- ]time|satisf)/i, 'warning', 'adds a number claim (users, reviews, ratings, percentages); it must come from real data the site has, never typed in or estimated'],
  [/\b(most popular|best[- ]selling|#1|number one|trusted by|loved by|world'?s (best|leading)|industry[- ]leading)\b/i, 'warning', 'adds a popularity/superlative claim; keep it only if it is backed by real data'],
  [/noindex|nofollow/i, 'warning', 'adds noindex/nofollow; confirm this page really should be hidden from Google'],
  [/dangerouslySetInnerHTML|v-html|\{@html|set:html|innerHTML\s*=/, 'warning', 'injects raw HTML; only acceptable for JSON-LD schema built from page data'],
  [/style=\{\{|style="[^"]{30,}"/, 'warning', 'inline styles; prefer the project\'s classes/tokens'],
  [/(^|[^-])\b(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|text-indent\s*:\s*-\d{3,})/, 'warning', 'hides content; never hide text for SEO and never hide a broken element instead of fixing it'],
];

// Lines removed from existing files that look like logic (a sign of editing the logic inside a page).
const REMOVED_LOGIC = /\b(await|fetch|axios|use[A-Z]\w*\s*\(|getServerSideProps|getStaticProps|generateStaticParams|loader|action|load\s*\(|useAsyncData|useFetch|\$fetch|revalidate|export\s+const\s+(dynamic|runtime|revalidate)|cookies\(\)|headers\(\)|redirect\(|notFound\(\))/;

const DATA_LITERAL = /\b[A-Za-z_]\w*\s*:\s*-?\d[\d,]*(\.\d+)?\s*(,|$|%|[}\]])|"[^"]+"\s*:\s*-?\d[\d,]*(\.\d+)?\s*(,|$|[}\]])/;

function i18nGaps(root, config, file) {
  const glob = config.content && config.content.i18nMessages;
  if (!glob || !/\.json$/i.test(file)) return [];
  const globs = Array.isArray(glob) ? glob : [glob];
  if (!matchList(globs, file)) return [];
  const flat = (o, p = '', out = new Set()) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out);
    else out.add(p);
    return out;
  };
  const dir = path.dirname(path.join(root, file));
  let mine;
  try { mine = flat(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))); } catch { return []; }
  const gaps = [];
  // sibling locale files: same folder (en.json, de.json) or sibling folders (en/common.json, de/common.json)
  const siblings = [];
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && path.join(dir, f) !== path.join(root, file)) siblings.push(path.join(dir, f));
  const parent = path.dirname(dir), base = path.basename(file);
  if (/^[a-z]{2}([-_][A-Za-z]{2,4})?$/.test(path.basename(dir))) {
    for (const d of fs.readdirSync(parent)) {
      const cand = path.join(parent, d, base);
      if (d !== path.basename(dir) && fs.existsSync(cand)) siblings.push(cand);
    }
  }
  for (const s of siblings.slice(0, 60)) {
    let theirs;
    try { theirs = flat(JSON.parse(fs.readFileSync(s, 'utf8'))); } catch { continue; }
    const missing = [...mine].filter((k) => !theirs.has(k));
    if (missing.length) gaps.push({ file: path.relative(root, s).split(path.sep).join('/'), missing: missing.slice(0, 15), count: missing.length });
  }
  return gaps;
}

export function checkChanges(root, config) {
  const { base, baseRef, files } = changesSinceMain(root, config);
  const findings = [];
  const add = (level, file, message, extra = {}) => findings.push({ level, file, message, ...extra });

  for (const f of files) {
    if (f.zone === 'scratch') continue;
    if (f.zone === 'tool') { add('info', f.path, 'created by a dev tool, not part of the SEO change; it is left out of saves'); continue; }
    if (!['editable', 'shared'].includes(f.zone)) {
      add('blocker', f.path, f.status === 'D'
        ? `deletes a file in the ${f.zone} area (logic layer / outside the SEO area)`
        : `changes a file in the ${f.zone} area (logic layer / outside the SEO area)`, { zone: f.zone });
      continue;
    }
    if (f.zone === 'shared') add('info', f.path, 'site-wide part: check several different pages that use it, on mobile and desktop', { zone: 'shared' });
    if (f.status === 'D') { add('warning', f.path, 'file deleted: if it was a page, make sure a redirect exists or the developer adds one (deleted pages become 404s)'); continue; }
    const abs = path.join(root, f.path);
    if (!fs.existsSync(abs)) continue;
    const size = fs.statSync(abs).size;

    if (IMAGE.test(f.path)) {
      if (size > 400 * 1024 && !/\.svg$/i.test(f.path)) add('warning', f.path, `image is ${(size / 1024).toFixed(0)} KB; compress it (WebP/AVIF, under ~200 KB) for page speed`);
      continue;
    }
    if (/\.json$/i.test(f.path)) {
      try { JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { add('blocker', f.path, `invalid JSON: ${e.message}`); continue; }
      for (const g of i18nGaps(root, config, f.path)) add('warning', f.path, `${g.count} text key(s) missing in ${g.file} (e.g. ${g.missing.slice(0, 3).join(', ')}); every language needs them or the page breaks/falls back`);
    }
    if (!(CODE.test(f.path) || STYLE.test(f.path) || /\.(md|mdx|json|ya?ml|txt|xml)$/i.test(f.path))) continue;

    const added = addedLines(root, base, f.path);
    let dataish = 0;
    for (const { line, text } of added) {
      for (const [re, level, message] of ADDED_RULES) {
        if (STYLE.test(f.path) && !/important|display|visibility|font-size|text-indent|stylelint/.test(re.source)) continue;
        if (/\.(md|mdx|txt|json|ya?ml)$/i.test(f.path) && level !== 'blocker' && !/number claim|superlative/.test(message)) continue;
        if (re.test(text)) {
          const all = added.map((a) => a.text).join('\n');
          if (/dangerouslySetInnerHTML|v-html|set:html/.test(text) && /ld\+json|jsonLd|JsonLd|schema/i.test(all)) {
            if (/JSON\.stringify/.test(all) && !/\\u003c|replace\(\s*\/<\/g/.test(all) && !/JsonLd|jsonLd\(/.test(text)) add('warning', f.path, 'JSON-LD built with JSON.stringify should escape "<" (JSON.stringify(data).replace(/</g, "\\u003c")) so text from data cannot break out of the script tag', { line });
            else add('info', f.path, 'JSON-LD schema injected as raw HTML (expected for structured data)', { line });
            continue;
          }
          add(level, f.path, message, { line, text: text.trim().slice(0, 160) });
        }
      }
      if (DATA_LITERAL.test(text)) dataish++;
    }
    if (dataish >= 6 && CODE.test(f.path)) add('warning', f.path, `${dataish} new lines look like hard-coded numbers/data. Facts like prices, counts, ratings, times or stats must come from the API; only editorial text may live in the page`);
    if (/\.(tsx|jsx|vue|svelte|astro)$/.test(f.path) && f.status !== 'A' && !/(^|\/)(page|layout|\+page|\+layout|index)\.[a-z]+$/.test(f.path)) {
      const name = path.basename(f.path).replace(/\.[a-z]+$/, '');
      const users = (gitOut(['grep', '-l', '-E', `(from|import)\\s+['\"][^'\"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`, '--', '*.tsx', '*.jsx', '*.ts', '*.vue', '*.svelte', '*.astro'], root) || '').split('\n').filter((u) => u && u !== f.path);
      if (users.length) add('info', f.path, `this part is also used by ${users.length} other file(s): ${users.slice(0, 6).join(', ')}${users.length > 6 ? ' ...' : ''} - check those pages too`);
    }
    if (CODE.test(f.path)) {
      const removed = removedLines(root, base, f.path).filter((l) => REMOVED_LOGIC.test(l));
      if (removed.length) add('warning', f.path, `${removed.length} removed/changed line(s) look like data or logic code (e.g. "${removed[0].trim().slice(0, 100)}"); the logic inside a page must stay as it was`);
    }
  }
  const summary = {
    blockers: findings.filter((x) => x.level === 'blocker').length,
    warnings: findings.filter((x) => x.level === 'warning').length,
  };
  return { ok: summary.blockers === 0, base, baseRef, files, findings, summary };
}

export function humanReport(r) {
  const lines = [];
  lines.push(`Changes compared with ${r.baseRef}: ${r.files.filter((f) => f.zone !== 'scratch' && f.zone !== 'tool').length} file(s)`);
  for (const f of r.files) if (f.zone !== 'scratch' && f.zone !== 'tool') lines.push(`  ${f.status} [${f.zone}] ${f.path}${f.from ? ` (from ${f.from})` : ''}`);
  for (const level of ['blocker', 'warning', 'info']) {
    const items = r.findings.filter((x) => x.level === level);
    if (!items.length) continue;
    lines.push(`${level.toUpperCase()}S:`);
    for (const x of items) lines.push(`  - ${x.file}${x.line ? `:${x.line}` : ''}: ${x.message}${x.text ? `\n      > ${x.text}` : ''}`);
  }
  lines.push(r.ok ? (r.summary.warnings ? 'RESULT: no blockers; review each warning and fix it or explain why it is fine' : 'RESULT: clean') : 'RESULT: BLOCKED - fix the blockers (undo logic-layer changes, remove workarounds)');
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = requireRepo();
  const { config } = loadConfig(root);
  const r = checkChanges(root, config);
  emit(r, humanReport(r));
  process.exit(r.ok ? 0 : 2);
}
