#!/usr/bin/env node
// Reads and updates translation (i18n) message files safely. Changing existing texts edits them in place
// (layout, escapes and line endings untouched); adding keys rewrites the file with its own indent and line endings.
//   node i18n.mjs locales                         list locales and their files
//   node i18n.mjs get home.intro                  show a key in every locale
//   node i18n.mjs set --file /tmp/changes.json    apply {"home.intro": {"en": "...", "de": "..."}, ...}
//   node i18n.mjs set --file ... --dry-run        show what would change
//   node i18n.mjs missing [--prefix home]         keys present in the default locale but missing elsewhere
//   node i18n.mjs rename old.key new.key          rename a key in every locale
// Files come from config.content.i18nMessages (e.g. public/messages/*.json or src/locales/**/*.json).
// Layouts: one file per locale (en.json) or a folder per locale (en/common.json -> keys start with "common.").
import fs from 'node:fs';
import path from 'node:path';
import { requireRepo, loadConfig, matchList, gitOut, parseArgs, emit, die, classify, ALLOWED_ZONES } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = requireRepo();
const { config } = loadConfig(root);
const globs = [].concat((config.content && config.content.i18nMessages) || []);
if (!globs.length) die('No translation files are set up for this project (config.content.i18nMessages).');
const defaultLocale = (config.content && config.content.defaultLocale) || 'en';
const LOCALE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/;

const files = (gitOut(['ls-files', '-co', '--exclude-standard', '-z'], root) ?? '').split('\0').filter((f) => f && /\.json$/.test(f) && matchList(globs, f));
// locale -> [{file, namespace}]
const byLocale = new Map();
for (const f of files) {
  const base = path.posix.basename(f, '.json');
  const dir = path.posix.basename(path.posix.dirname(f));
  let locale = null, ns = '';
  if (LOCALE.test(base)) locale = base;
  else if (LOCALE.test(dir)) { locale = dir; ns = base; }
  if (!locale) continue;
  if (!byLocale.has(locale)) byLocale.set(locale, []);
  byLocale.get(locale).push({ file: f, ns });
}
if (!byLocale.size) die(`No locale files matched ${globs.join(', ')}.`);
const locales = [...byLocale.keys()].sort((a, b) => (a === defaultLocale ? -1 : b === defaultLocale ? 1 : a.localeCompare(b)));

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const indent = (/\n([ \t]+)"/.exec(text) || [, '  '])[1];
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const entry = { file, text, indent: indent.includes('\t') ? '\t' : indent.length, eol, finalEol: /\r?\n$/.test(text), data: JSON.parse(text), dirty: false, edits: [], structural: false };
  cache.set(file, entry);
  return entry;
}

// Where each string value sits in the original text (key path -> [start, end]), so changed values can be
// replaced in place and the rest of the file (layout, escapes, line endings) stays exactly as it was.
function valueSpans(text) {
  const spans = new Map();
  let i = 0;
  const ws = () => { while (/\s/.test(text[i])) i++; };
  const str = () => { const st = i++; while (text[i] !== '"') { if (text[i] === '\\') i++; i++; } i++; return [st, i]; };
  const val = (p) => {
    ws();
    if (text[i] === '{') { i++; ws(); if (text[i] === '}') { i++; return; } for (;;) { ws(); const [a, b] = str(); const key = JSON.parse(text.slice(a, b)); ws(); i++; val(p.concat(key)); ws(); if (text[i] === ',') { i++; continue; } i++; return; } }
    if (text[i] === '[') { i++; ws(); if (text[i] === ']') { i++; return; } let n = 0; for (;;) { val(p.concat(String(n++))); ws(); if (text[i] === ',') { i++; continue; } i++; return; } }
    if (text[i] === '"') { const sp = str(); spans.set(JSON.stringify(p), sp); return; }
    while (i < text.length && !/[,}\]\s]/.test(text[i])) i++;
  };
  val([]);
  return spans;
}
function target(locale, key) {
  const list = byLocale.get(locale) || [];
  const single = list.find((x) => !x.ns);
  if (single) return { entry: load(single.file), parts: key.split('.') };
  const [ns, ...rest] = key.split('.');
  const hit = list.find((x) => x.ns === ns);
  if (!hit) return null;
  return { entry: load(hit.file), parts: rest };
}
function getPath(obj, parts) { let o = obj; for (const p of parts) { if (!o || typeof o !== 'object' || !(p in o)) return undefined; o = o[p]; } return o; }
function setPath(obj, parts, value) {
  let o = obj;
  for (const p of parts.slice(0, -1)) {
    if (o[p] === undefined) o[p] = {};
    else if (typeof o[p] !== 'object' || Array.isArray(o[p])) throw new Error(`"${p}" is text, not a group of keys`);
    o = o[p];
  }
  const last = parts[parts.length - 1];
  const before = o[last];
  o[last] = value;
  return before;
}
function delPath(obj, parts) { let o = obj; for (const p of parts.slice(0, -1)) { if (!o[p]) return undefined; o = o[p]; } const v = o[parts.at(-1)]; delete o[parts.at(-1)]; return v; }
function flat(o, p = '', out = []) { if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out); else out.push(p); return out; }
function placeholders(s) { return typeof s === 'string' ? [...s.matchAll(/\{[^{}]+\}|<\/?\w+>|%[sd]|\{\{[^}]+\}\}/g)].map((m) => m[0]).sort().join(' ') : ''; }
function save() {
  const written = [];
  for (const e of cache.values()) {
    if (!e.dirty) continue;
    const zone = classify(e.file, config);
    if (!ALLOWED_ZONES.has(zone)) die(`${e.file} is in the ${zone} area; translation files must be in the editable list.`);
    let out;
    if (!e.structural) {
      // only existing texts changed: patch them in place, right to left
      const spans = valueSpans(e.text);
      const reps = e.edits.map((x) => ({ span: spans.get(JSON.stringify(x.parts)), value: x.value })).filter((x) => x.span).sort((a, b) => b.span[0] - a.span[0]);
      out = e.text;
      for (const r of reps) out = out.slice(0, r.span[0]) + JSON.stringify(r.value) + out.slice(r.span[1]);
      try { JSON.parse(out); } catch { out = null; }
    }
    if (!out) out = JSON.stringify(e.data, null, e.indent).replace(/\n/g, e.eol) + (e.finalEol ? e.eol : '');
    fs.writeFileSync(path.join(root, e.file), out);
    written.push(e.file);
  }
  return written;
}

const cmd = args._[0];
if (cmd === 'locales' || !cmd) {
  emit({ defaultLocale, locales: Object.fromEntries(locales.map((l) => [l, byLocale.get(l).map((x) => x.file)])) },
    `Default: ${defaultLocale}\n` + locales.map((l) => `${l}: ${byLocale.get(l).map((x) => x.file).join(', ')}`).join('\n'));
} else if (cmd === 'get') {
  const key = args._[1] || die('Give a key, e.g. home.intro');
  const out = {};
  for (const l of locales) { const t = target(l, key); out[l] = t ? getPath(t.entry.data, t.parts) : undefined; }
  emit(out, locales.map((l) => `${l}: ${out[l] === undefined ? '(missing)' : JSON.stringify(out[l])}`).join('\n'));
} else if (cmd === 'missing') {
  const prefix = args.prefix && args.prefix !== true ? String(args.prefix) : '';
  const want = new Set();
  for (const x of byLocale.get(defaultLocale) || []) for (const k of flat(load(x.file).data)) want.add(x.ns ? `${x.ns}.${k}` : k);
  const report = {};
  for (const l of locales.filter((x) => x !== defaultLocale)) {
    const miss = [...want].filter((k) => k.startsWith(prefix) && (() => { const t = target(l, k); return !t || getPath(t.entry.data, t.parts) === undefined; })());
    if (miss.length) report[l] = miss;
  }
  emit(report, Object.keys(report).length ? Object.entries(report).map(([l, m]) => `${l}: ${m.length} missing (${m.slice(0, 8).join(', ')}${m.length > 8 ? ', ...' : ''})`).join('\n') : 'Every locale has every key of the default locale.');
} else if (cmd === 'set') {
  const src = args.file && args.file !== true ? String(args.file) : die('Give --file with {"key": {"en": "...", "de": "..."}}');
  let changes; try { changes = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { die(`Could not read ${src}: ${e.message}`); }
  const report = [], warnings = [];
  for (const [key, perLocale] of Object.entries(changes)) {
    if (!perLocale || typeof perLocale !== 'object') die(`"${key}" needs an object of locale -> text.`);
    const unknown = Object.keys(perLocale).filter((l) => !byLocale.has(l));
    if (unknown.length) die(`"${key}": unknown locale(s) ${unknown.join(', ')}. Known: ${locales.join(', ')}`);
    const missingLocales = locales.filter((l) => !(l in perLocale));
    if (missingLocales.length) warnings.push(`"${key}" has no text for ${missingLocales.join(', ')}; those pages would show a missing or fallback text.`);
    const ref = perLocale[defaultLocale];
    for (const [l, value] of Object.entries(perLocale)) {
      if (typeof value !== 'string' && !(value && typeof value === 'object')) die(`"${key}" (${l}) must be text.`);
      if (ref !== undefined && typeof value === 'string' && placeholders(value) !== placeholders(ref)) warnings.push(`"${key}" (${l}): placeholders/tags differ from ${defaultLocale} (${placeholders(ref) || 'none'} vs ${placeholders(value) || 'none'}).`);
      const t = target(l, key);
      if (!t) die(`No ${l} file for the "${key.split('.')[0]}" group.`);
      const before = setPath(t.entry.data, t.parts, value);
      if (JSON.stringify(before) !== JSON.stringify(value)) {
        t.entry.dirty = true;
        if (typeof before === 'string' && typeof value === 'string') t.entry.edits.push({ parts: t.parts, value });
        else t.entry.structural = true;
        report.push({ locale: l, key, before, after: value });
      }
    }
  }
  const written = args['dry-run'] ? [] : save();
  emit({ changes: report, warnings, written, dryRun: !!args['dry-run'] },
    [...report.map((r) => `${r.locale} ${r.key}: ${r.before === undefined ? '(new)' : JSON.stringify(r.before)} -> ${JSON.stringify(r.after)}`),
      ...warnings.map((w) => `WARNING: ${w}`), args['dry-run'] ? '(dry run: nothing written)' : `Updated ${written.length} file(s).`].join('\n'));
} else if (cmd === 'rename') {
  const [, from, to] = args._;
  if (!from || !to) die('Usage: rename old.key new.key');
  const done = [];
  for (const l of locales) {
    const a = target(l, from), b = target(l, to);
    if (!a || !b) continue;
    const v = getPath(a.entry.data, a.parts);
    if (v === undefined) continue;
    delPath(a.entry.data, a.parts); setPath(b.entry.data, b.parts, v);
    a.entry.dirty = b.entry.dirty = true; done.push(l);
  }
  const written = save();
  emit({ renamed: done, written }, `Renamed in ${done.length} locale(s): ${done.join(', ')}. Remember to update the pages that use "${from}".`);
} else die(`Unknown command "${cmd}". Use: locales, get, set, missing, rename.`);
