#!/usr/bin/env node
// Saves the tested changes as one commit signed with the SEO editor's name.
//   node commit.mjs --type feat --scope seo --title "improve pricing page title and meta description" \
//     --what "Title now leads with 'pricing plans'|Meta description rewritten (152 chars)" \
//     --why "Target query 'acme pricing' sits at position 9" [--body-file /tmp/body.txt] [--push]
// Refuses when: not on the work branch, logic-layer files changed, workarounds found,
// the exact content was not tested (verify.mjs), or the UI check was not recorded.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  requireRepo, loadConfig, loadPerson, currentBranch, mergeInProgress, git, gitOut, workingTreeHash, headTree,
  parseArgs, emit, ensureLocalIgnores, pendingChanges, readJson,
} from './lib.mjs';
import { checkChanges, humanReport } from './diff_check.mjs';
import { readStamp } from './verify.mjs';
import { personEnv } from './sync.mjs';

const TYPES = ['feat', 'fix', 'style', 'perf', 'docs', 'chore'];

export function buildMessage({ type, scope, title, what = [], why = '', body = '', checks = '', person, assistantTrailer }) {
  let t = String(title || '').trim().replace(/\.+$/, '');
  if (/^[A-Z][a-z]/.test(t)) t = t[0].toLowerCase() + t.slice(1); // conventional-commit subject style
  const header = `${type}${scope ? `(${scope})` : ''}: ${t}`;
  const parts = [header, ''];
  if (body) parts.push(body.trim(), '');
  else {
    if (what.length) { parts.push('What changed:'); for (const w of what) parts.push(`- ${w}`); parts.push(''); }
    if (why) { parts.push('Why:'); for (const w of why.split('|').map((s) => s.trim()).filter(Boolean)) parts.push(`- ${w}`); parts.push(''); }
  }
  if (checks) parts.push(`Checked: ${checks}`, '');
  parts.push(`Changed-by: ${person.name}${person.email ? ` <${person.email}>` : ''} (${person.role || 'SEO'})`);
  if (assistantTrailer) parts.push('Assisted-by: Claude (seo-dev skill)');
  return { header, message: parts.join('\n').replace(/\n{3,}/g, '\n\n') + '\n' };
}

export function checksLine(stamp, root) {
  const label = { lint: 'lint', typecheck: 'types', test: 'tests', build: 'build' };
  const bits = stamp.results.filter((r) => !r.skipped).map((r) => `${label[r.name] || r.name} ${r.ok ? 'ok' : r.preexisting ? 'already failing on main' : 'failed'}`);
  const seo = root ? readJson(path.join(root, '.seo-editor', 'reports', 'seo-check.json')) : null;
  if (seo && seo.tree === stamp.tree) bits.push(`SEO tags ${seo.ok ? 'ok' : `${seo.errors} issue(s)`} (${seo.pages.length} page${seo.pages.length === 1 ? '' : 's'})`);
  if (stamp.ui) bits.push(stamp.ui.startsWith('skipped') ? `UI ${stamp.ui}` : `UI checked${stamp.uiVia ? ` via ${stamp.uiVia}` : ''}`);
  return bits.join(', ');
}

function fail(r, msg, code = 2) {
  r.ok = false; r.notes.push(msg);
  emit(r, r.notes.join('\n'));
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = requireRepo();
  const { config } = loadConfig(root);
  ensureLocalIgnores(root);
  const r = { ok: false, notes: [] };
  const person = loadPerson(root);
  if (!person) fail(r, 'No editor name saved on this computer yet. Ask the person for their name and email, then run person.mjs --name "..." --email "...".');
  const branch = currentBranch(root);
  if (branch !== config.branches.work) fail(r, `Saving only happens on the ${config.branches.work} branch (now on ${branch || 'no branch'}). Run sync.mjs first.`);
  if (mergeInProgress(root)) fail(r, 'A merge with main is still open. Finish it with sync.mjs --continue first.');

  const type = String(args.type || 'feat');
  if (!TYPES.includes(type)) fail(r, `--type must be one of ${TYPES.join(', ')}.`);
  const scope = args.scope && args.scope !== true ? String(args.scope).replace(/[^\w-]/g, '') : 'seo';
  if (!args.title || args.title === true) fail(r, 'Give a short --title describing the change (what, not how).');
  const body = args['body-file'] ? fs.readFileSync(String(args['body-file']), 'utf8') : '';
  const what = args.what && args.what !== true ? String(args.what).split('|').map((s) => s.trim()).filter(Boolean) : [];

  const check = checkChanges(root, config);
  if (!check.ok) fail(r, humanReport(check) + '\nNothing was saved.');
  const pending = check.files.filter((f) => f.zone !== 'scratch' && f.zone !== 'tool');
  const work = pendingChanges(root, config);
  if (work.blocked.length) fail(r, `These files are outside the SEO area and must be undone first: ${work.blocked.map((b) => b.path).join(', ')}. Nothing was saved.`);
  if (!work.allowed.length) {
    r.ok = true; r.notes.push('Nothing new to save: everything is already saved.');
    emit(r, r.notes.join('\n')); return;
  }

  const stamp = readStamp(root);
  const tree = workingTreeHash(root, config);
  if (!stamp || stamp.tree !== tree) fail(r, 'These exact changes have not been tested yet (or changed after testing). Run verify.mjs, check the UI, then save.');
  if (!stamp.passed) fail(r, 'The last test run failed. Fix the problems and run verify.mjs again before saving.');
  if (!stamp.ui) fail(r, 'The UI check is not recorded for these changes. Check the changed pages at mobile/tablet/desktop widths, then run verify.mjs --mark-ui "<pages and result>".');

  const { header, message } = buildMessage({
    type, scope, title: args.title, what, why: args.why && args.why !== true ? String(args.why) : '', body,
    checks: checksLine(stamp, root), person, assistantTrailer: !!(config.commit && config.commit.assistantTrailer),
  });
  if (header.length > 100) fail(r, `The title is too long (${header.length} characters with the prefix); keep it under ~72.`);

  git(['reset', '-q'], root); // start from a clean stage, then add exactly the allowed files
  const add = git(['add', '-A', '--', ...work.allowed], root);
  if (add.code !== 0) fail(r, `Could not stage the changes: ${add.stderr.trim()}`);
  const msgFile = path.join(os.tmpdir(), `seo-editor-msg-${process.pid}.txt`);
  fs.writeFileSync(msgFile, message);
  const c = git(['commit', '-F', msgFile], root, { env: personEnv(person) });
  fs.rmSync(msgFile, { force: true });
  if (c.code !== 0) {
    git(['reset', '-q'], root); // unstage, keep the edits
    fail(r, `The project's pre-save checks stopped the save:\n${(c.stdout + '\n' + c.stderr).trim().split('\n').slice(-40).join('\n')}\nFix what they report (no skipping), run verify.mjs again, then save.`);
  }
  r.ok = true;
  r.commit = gitOut(['rev-parse', '--short', 'HEAD'], root);
  r.header = header;
  r.files = work.allowed;
  if (work.ignored.filter((f) => !f.startsWith('.seo-editor/')).length) r.notes.push(`Left out (made by dev tools, not part of the change): ${work.ignored.filter((f) => !f.startsWith('.seo-editor/')).join(', ')}`);
  r.notes.push(`Saved ${r.commit}: ${header}`);
  if (headTree(root) !== stamp.tree) {
    r.retest = true;
    r.notes.push('The project\'s save hook adjusted some files (usually formatting). Run verify.mjs again before publishing.');
  }

  if (args.push) {
    const { remote, work } = config.branches;
    r.notes.push('Uploading the draft branch (the project may run its own build first; this can take a few minutes)...');
    const p = git(['push', '-u', remote, `${work}:refs/heads/${work}`], root, { env: personEnv(person) });
    r.pushed = p.code === 0;
    if (p.code !== 0) r.notes.push(`Upload did not go through (the change is still saved on this computer):\n${(p.stderr || '').trim().split('\n').slice(-15).join('\n')}`);
    else r.notes.push('Draft branch uploaded.');
  }
  emit(r, r.notes.join('\n'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
