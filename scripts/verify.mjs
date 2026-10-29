#!/usr/bin/env node
// Runs the project's own quality checks and records a "tested" stamp for the exact content tested.
//   node verify.mjs                    install if needed, then lint, types, tests, extra checks, build
//   node verify.mjs --only lint,typecheck   --skip build   --no-baseline   --timeout 900
//   node verify.mjs --mark-ui "/, /pricing at 375/768/1280: no issues"   record that the UI was checked
//   node verify.mjs --status           show whether the current content has a passing stamp
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  requireRepo, loadConfig, sh, git, gitOut, refExists, workingTreeHash, scratchDir, readJson, writeJson,
  detectPackageManager, pmRun, pmExec, pmInstall, parseArgs, list, emit, changesSinceMain,
} from './lib.mjs';

export function stampFile(root) { return path.join(scratchDir(root, 'state'), 'verify.json'); }
export function readStamp(root) { return readJson(stampFile(root)); }

// Commands from config, falling back to the package.json scripts.
export function resolveCommands(root, config) {
  const c = { ...(config.commands || {}) };
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    const { pm } = detectPackageManager(root);
    const s = pkg.scripts || {};
    const pick = (...names) => names.find((n) => s[n] && !/no test specified/.test(s[n]));
    if (c.install === undefined) c.install = pmInstall(pm, root);
    if (c.lint === undefined) { const n = pick('lint'); c.lint = n ? pmRun(pm, n) : null; }
    if (c.typecheck === undefined) {
      const n = pick('typecheck', 'type-check', 'types', 'check-types', 'tsc', 'check:types');
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      c.typecheck = n ? pmRun(pm, n) : (deps.typescript && fs.existsSync(path.join(root, 'tsconfig.json')) && !deps['vue-tsc'] && !deps['@astrojs/check'] && !deps['svelte-check'])
        ? pmExec(pm, 'tsc --noEmit -p tsconfig.json') : deps['vue-tsc'] ? pmExec(pm, 'vue-tsc --noEmit') : deps['svelte-check'] ? pmExec(pm, 'svelte-check') : null;
    }
    if (c.test === undefined) { const n = pick('test:ci', 'test:unit', 'test'); c.test = n ? pmRun(pm, n) : null; }
    if (c.build === undefined) { const n = pick('build'); c.build = n ? pmRun(pm, n) : null; }
  }
  c.extraChecks = (c.extraChecks || []).map((x) => (typeof x === 'string' ? { name: x, cmd: x, required: false } : x));
  return c;
}

function tail(text, n = 40) {
  return text.split('\n').filter((l) => l.trim()).slice(-n).join('\n');
}

function runCheck(root, name, cmd, timeoutSec, cwd = root) {
  const started = Date.now();
  const env = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', NEXT_TELEMETRY_DISABLED: '1', ASTRO_TELEMETRY_DISABLED: '1' };
  const r = sh(cmd, { cwd, env, timeout: timeoutSec * 1000 });
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  const log = path.join(scratchDir(root, 'logs'), `${name.replace(/[^\w.-]+/g, '_')}${cwd === root ? '' : '.baseline'}.log`);
  fs.writeFileSync(log, `$ ${cmd}\n\n${out}`);
  const timedOut = r.code !== 0 && Date.now() - started >= timeoutSec * 1000 - 50;
  return { name, cmd, ok: r.code === 0, code: r.code, seconds: Math.round((Date.now() - started) / 1000), timedOut, log, tail: r.code === 0 ? '' : tail(out) };
}

// Run one check on a clean copy of main to learn whether a failure was already there.
function baseline(root, config, check, cmd, timeoutSec) {
  const { remote, main } = config.branches;
  const ref = refExists(root, `${remote}/${main}`) ? `${remote}/${main}` : main;
  const dir = path.join(scratchDir(root), 'baseline');
  git(['worktree', 'remove', '--force', dir], root);
  fs.rmSync(dir, { recursive: true, force: true });
  const add = git(['worktree', 'add', '--detach', dir, ref], root);
  if (add.code !== 0) return { ran: false, note: 'could not create a clean copy of main' };
  try {
    for (const f of fs.readdirSync(root)) {
      if (f === 'node_modules') fs.symlinkSync(path.join(root, f), path.join(dir, f), 'dir');
      else if (/^\.env/.test(f) || f === '.dev.vars') fs.copyFileSync(path.join(root, f), path.join(dir, f));
    }
    const r = runCheck(root, check, cmd, timeoutSec, dir);
    return { ran: true, ok: r.ok, log: r.log };
  } catch (e) {
    return { ran: false, note: e.message };
  } finally {
    git(['worktree', 'remove', '--force', dir], root);
    fs.rmSync(dir, { recursive: true, force: true });
    git(['worktree', 'prune'], root);
  }
}

function human(r) {
  const lines = [];
  if (r.install) lines.push(`install: ${r.install.ok ? 'ok' : 'FAILED'} (${r.install.seconds}s)${r.install.ok ? '' : `\n${r.install.tail}`}`);
  for (const c of r.results) {
    let s = `${c.name}: ${c.skipped ? 'not set up in this project' : c.ok ? 'passed' : c.preexisting ? 'failing on main too (not caused by these changes)' : 'FAILED'}`;
    if (!c.skipped) s += ` (${c.seconds}s)`;
    if (c.required === false && !c.ok && !c.skipped) s += ' [optional check]';
    lines.push(s);
    if (!c.ok && !c.skipped) lines.push(`  log: ${c.log}\n${c.tail.split('\n').map((l) => '  | ' + l).join('\n')}`);
  }
  if (r.ui) lines.push(`ui: ${r.ui}`);
  lines.push(r.passed ? (r.partial ? 'RESULT: passed (partial run)' : 'RESULT: PASSED - stamp saved for this exact content')
    : 'RESULT: FAILED - fix the problems above (in editable files only) and run verify again');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = requireRepo();
  const { config } = loadConfig(root);

  if (args.status) {
    const st = readStamp(root);
    const tree = workingTreeHash(root, config);
    const current = !!st && st.tree === tree;
    const r = { current, passed: current && st.passed, ui: current ? st.ui : null, stamp: st };
    emit(r, current ? `Stamp matches the current content: ${st.passed ? 'PASSED' : 'FAILED'}; UI: ${st.ui || 'not recorded yet'}` : 'No test stamp for the current content. Run verify.mjs.');
    process.exit(r.passed ? 0 : 1);
  }

  if (args['mark-ui']) {
    const st = readStamp(root);
    const tree = workingTreeHash(root, config);
    if (!st || st.tree !== tree) { console.error('The content changed since the last test run. Run verify.mjs first, then check the UI, then mark it.'); process.exit(1); }
    // Evidence: a ui_check.mjs report for this exact content, or an explicit statement that browser tools were used.
    const rep = readJson(path.join(root, '.seo-editor', 'reports', 'ui-check.json'));
    const viaReport = rep && rep.tree === tree;
    const via = args.via && args.via !== true ? String(args.via) : '';
    if (!viaReport && !via && !String(args['mark-ui']).startsWith('skipped')) {
      console.error('No UI check found for these exact changes. Run ui_check.mjs on the changed pages (and open the side-by-side images), or if you checked with the browser tools add --via browser-tools.');
      process.exit(1);
    }
    st.ui = String(args['mark-ui']).slice(0, 500);
    st.uiVia = viaReport ? `ui_check (${(rep.widths || []).join('/')}px: ${(rep.paths || []).join(', ')})` : via || 'skipped';
    st.uiAt = new Date().toISOString();
    writeJson(stampFile(root), st);
    emit({ ok: true, ui: st.ui }, `UI check recorded: ${st.ui}`);
    return;
  }

  const timeoutSec = Number(args.timeout || 1800);
  const cmds = resolveCommands(root, config);
  const only = list(args.only), skip = list(args.skip);
  const want = (n) => (only.length ? only.includes(n) : true) && !skip.includes(n);
  const r = { results: [], install: null, passed: false };

  const needInstall = args.install || (fs.existsSync(path.join(root, 'package.json')) && !fs.existsSync(path.join(root, 'node_modules')));
  if (needInstall && cmds.install) {
    r.install = runCheck(root, 'install', cmds.install, timeoutSec);
    if (!r.install.ok) { emit(r, human(r)); process.exit(1); }
  }

  const order = [['lint', cmds.lint, true], ['typecheck', cmds.typecheck, true], ['test', cmds.test, true]];
  for (const x of cmds.extraChecks) order.push([x.name, x.cmd, x.required === true]);
  order.push(['build', cmds.build, true]);

  for (const [name, cmd, required] of order) {
    const group = ['lint', 'typecheck', 'test', 'build'].includes(name) ? name : 'extra';
    if (!want(name) && !want(group)) continue;
    if (!cmd) { r.results.push({ name, skipped: true, ok: true, required }); continue; }
    const res = { ...runCheck(root, name, cmd, timeoutSec), required };
    if (!res.ok && !args['no-baseline'] && name !== 'build' && !res.timedOut) {
      const b = baseline(root, config, name, cmd, timeoutSec);
      res.baseline = b;
      res.preexisting = b.ran && b.ok === false;
    }
    r.results.push(res);
  }

  const blocking = r.results.filter((c) => !c.ok && !c.preexisting && c.required !== false);
  r.passed = blocking.length === 0;
  r.partial = only.length > 0 || skip.length > 0;
  const tree = workingTreeHash(root, config);
  const prev = readStamp(root);
  const stamp = {
    tree, head: gitOut(['rev-parse', 'HEAD'], root), at: new Date().toISOString(), passed: r.passed,
    results: r.results.map(({ name, ok, skipped, preexisting, seconds, required }) => ({ name, ok, skipped: !!skipped, preexisting: !!preexisting, seconds, required })),
    preexisting: r.results.filter((c) => c.preexisting).map((c) => c.name),
    changedFiles: changesSinceMain(root, config).files.map((f) => f.path),
    ui: prev && prev.tree === tree ? prev.ui : null,
  };
  // A partial run is for quick feedback only; saving and publishing need a full run.
  if (!r.partial) writeJson(stampFile(root), stamp);
  r.ui = stamp.ui;
  emit({ ...r, stamp: r.partial ? null : stamp },
    human(r) + (r.partial ? '\n(partial run: no stamp saved; run the full verify before saving)' : ''));
  process.exit(r.passed ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
