#!/usr/bin/env node
// Publishes the saved SEO changes to main. Run --confirmed only after the person clicked "Yes, publish it".
//   node publish.mjs --preview            what would go live (changes nothing)
//   node publish.mjs --confirmed          publish (merge to main, or open a pull request in pull-request mode)
//   node publish.mjs --undo-last --confirmed   take back the most recent SEO publish (only if nothing came after it)
// Exit codes: 0 done, 2 blocked, 3 needs a fresh test run (main moved or content changed), 4 sent for approval.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import {
  requireRepo, loadConfig, loadPerson, currentBranch, mergeInProgress, git, gitOut, run, refExists, countCommits,
  headTree, parseArgs, emit, ensureLocalIgnores, pendingChanges,
} from './lib.mjs';
import { checkChanges, humanReport } from './diff_check.mjs';
import { readStamp } from './verify.mjs';
import { syncBranch, personEnv } from './sync.mjs';

function out(r, code) {
  emit(r, r.notes.join('\n'));
  process.exit(code);
}

function seoCommits(root, range) {
  const raw = gitOut(['log', '--no-merges', '--format=%h%x09%an%x09%s', range], root) || '';
  return raw.split('\n').filter(Boolean).map((l) => { const [sha, author, subject] = l.split('\t'); return { sha, author, subject }; })
    .filter((c) => !/^chore\(sync\)/.test(c.subject));
}

// Identifies the set of saved SEO changes (not sync merges), so bringing in main does not change it.
function seoToken(root, mainRef) {
  const list = gitOut(['rev-list', '--no-merges', `${mainRef}..HEAD`], root) || '';
  return crypto.createHash('sha1').update(list.split('\n').sort().join('\n')).digest('hex').slice(0, 10);
}

function deployNote(config) {
  const d = config.deploy || {};
  if (d.auto === true) return d.note || 'The site deploys automatically from main, so it should be live after that finishes (usually a few minutes).';
  if (d.auto === false) return d.note || 'A developer\'s deploy step takes main live; it is not automatic.';
  return d.note || 'Main is updated. If the site deploys automatically from main it will be live shortly; otherwise the developer\'s next deploy takes it live.';
}

function ghAvailable(root) {
  return run('gh', ['auth', 'status'], { cwd: root }).code === 0;
}

function openPullRequest(root, config, person, commits) {
  const { remote, work, main } = config.branches;
  const p = git(['push', '-u', remote, `${work}:refs/heads/${work}`], root, { env: personEnv(person) });
  if (p.code !== 0) return { ok: false, note: `Could not upload the draft branch: ${p.stderr.trim().split('\n').slice(-6).join(' ')}` };
  const manual = `The draft branch "${work}" is uploaded with everything tested. Ask the developer to review and merge "${work}" into "${main}" (WhatsApp message 6 in data-and-api.md, with the branch name instead of a link).`;
  if (!ghAvailable(root)) return { ok: false, uploaded: true, note: `${manual} (The GitHub tool "gh" is not signed in on this computer, so the request could not be opened automatically.)` };
  const existing = run('gh', ['pr', 'list', '--head', work, '--base', main, '--state', 'open', '--json', 'url', '--jq', '.[0].url'], { cwd: root }).stdout.trim();
  if (existing) return { ok: true, url: existing, updated: true };
  const body = ['SEO changes ready to go live.', '', ...commits.map((c) => `- ${c.subject} (${c.sha}, ${c.author})`), '',
    `Requested by: ${person.name}${person.email ? ` <${person.email}>` : ''}`, 'Tested with the project\'s lint, type, test and build checks plus a UI check (seo-dev).'].join('\n');
  const title = commits.length === 1 ? commits[0].subject : `SEO updates by ${person.name} (${commits.length} changes)`;
  const pr = run('gh', ['pr', 'create', '--base', main, '--head', work, '--title', title.slice(0, 120), '--body', body], { cwd: root });
  if (pr.code !== 0) return { ok: false, uploaded: true, note: `${manual} (Opening the request automatically failed: ${pr.stderr.trim().split('\n').pop().slice(0, 200)})` };
  return { ok: true, url: pr.stdout.trim().split('\n').pop() };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = requireRepo();
  const { config } = loadConfig(root);
  ensureLocalIgnores(root);
  const { remote, work, main } = config.branches;
  const r = { ok: false, notes: [] };
  const person = loadPerson(root);
  const branch = currentBranch(root);

  if (!args.preview && !args.confirmed && !args['undo-last']) { r.notes.push('Add --preview to see what would go live, or --confirmed after the person chose "Yes, publish it".'); out(r, 2); }
  if (!person) { r.notes.push('No editor name saved on this computer (person.mjs).'); out(r, 2); }
  if (branch !== work) { r.notes.push(`Publishing starts from the ${work} branch (now on ${branch || 'no branch'}). Run sync.mjs first.`); out(r, 2); }
  if (mergeInProgress(root)) { r.notes.push('A merge with main is still open; finish it with sync.mjs --continue.'); out(r, 2); }

  const hasRemote = !!gitOut(['remote', 'get-url', remote], root);
  if (hasRemote) {
    const f = git(['fetch', remote, '--prune', '--quiet'], root);
    if (f.code !== 0) { r.notes.push(`Could not reach the online project to publish: ${f.stderr.trim().split('\n').slice(-2).join(' ')}`); out(r, 2); }
  }
  const mainRef = hasRemote ? `${remote}/${main}` : main;

  if (args['undo-last']) return undoLast(root, config, person, mainRef, r, args);

  const commits = seoCommits(root, `${mainRef}..HEAD`);
  r.commits = commits;
  r.files = checkChanges(root, config).files.filter((f) => f.zone !== 'scratch' && f.zone !== 'tool').map((f) => `${f.status} ${f.path}`);
  const pend = pendingChanges(root, config);
  const dirty = pend.allowed.length > 0 || pend.blocked.length > 0;
  const stamp = readStamp(root);
  const tested = !!stamp && stamp.passed && stamp.tree === headTree(root);
  const mainMoved = countCommits(root, `HEAD..${mainRef}`);

  if (args.preview) {
    r.ok = true;
    r.notes.push(commits.length ? `Ready to publish ${commits.length} saved change(s):` : 'Nothing saved is waiting to be published.');
    for (const c of commits) r.notes.push(`  - ${c.subject} (${c.sha}, ${c.author})`);
    if (r.files.length) { r.notes.push('Files:'); for (const f of r.files) r.notes.push(`  ${f}`); }
    if (dirty) r.notes.push('There are also unsaved edits; they will NOT be published until saved.');
    if (mainMoved) r.notes.push(`Main has ${mainMoved} newer update(s); publishing will bring them in and re-test first.`);
    r.notes.push(tested ? `Tested: yes (${stamp.at}); UI: ${stamp.ui || 'not recorded'}` : 'Tested: not for the current saved content - run verify.mjs before publishing.');
    r.notes.push(`Mode: ${config.publish.mode === 'pull-request' ? 'sends an approval request (pull request) to the developer' : `merges into ${main}`}.`);
    r.token = seoToken(root, mainRef);
    r.notes.push(`Publish token: ${r.token}  (after the person says yes: publish.mjs --confirmed --expect ${r.token})`);
    out(r, 0);
  }

  if (args.expect && args.expect !== true && seoToken(root, mainRef) !== String(args.expect)) {
    r.notes.push('The saved changes are different from what the person approved (new saves since the preview). Show the preview again and ask again.');
    out(r, 3);
  }
  if (dirty) { r.notes.push('There are unsaved edits. Save them (verify + commit) or undo them before publishing, so the live site gets exactly what was tested.'); out(r, 2); }
  if (!commits.length) { r.ok = true; r.notes.push('Nothing saved is waiting to be published.'); out(r, 0); }

  if (mainMoved) {
    const s = syncBranch({ fetch: false });
    if (!s.ok) { r.notes.push('Main changed and bringing it in needs attention:', ...s.notes, ...s.conflicts.map((c) => `CONFLICT ${c.path}`)); out(r, 2); }
    r.notes.push(`Brought in ${s.mainUpdates} newer update(s) from main. The combined result must be tested again: run verify.mjs (and a quick UI check), then publish --confirmed again.`);
    r.needsRetest = true; out(r, 3);
  }

  const check = checkChanges(root, config);
  if (!check.ok) { r.notes.push(humanReport(check), 'Publishing stopped.'); out(r, 2); }
  if (!tested) { r.needsRetest = true; r.notes.push('The saved content has not passed a full test run yet. Run verify.mjs, then publish --confirmed again.'); out(r, 3); }
  if (!stamp.ui) { r.notes.push('No UI check is recorded for this content. Check the pages, run verify.mjs --mark-ui, then publish again.'); out(r, 3); }

  if (config.publish.mode === 'pull-request') {
    const pr = openPullRequest(root, config, person, commits);
    r.ok = pr.ok; r.mode = 'pull-request'; r.url = pr.url || null;
    r.notes.push(pr.ok ? `Sent for approval: ${pr.url}${pr.updated ? ' (updated the existing request)' : ''}` : pr.note);
    out(r, pr.ok ? 4 : 2);
  }

  // merge mode: build the publish merge commit without touching the working folder.
  const headSha = gitOut(['rev-parse', 'HEAD'], root);
  const mainSha = gitOut(['rev-parse', mainRef], root);
  const subjects = commits.map((c) => `- ${c.subject} (${c.sha})`).join('\n');
  const msg = `Publish SEO changes from ${work}\n\n${subjects}\n\nPublished-by: ${person.name}${person.email ? ` <${person.email}>` : ''} (${person.role || 'SEO'})\nChecked: ${stamp.results.filter((x) => !x.skipped).map((x) => `${x.name} ${x.ok ? 'ok' : 'already failing on main'}`).join(', ')}; UI checked\n`;
  const msgFile = path.join(os.tmpdir(), `seo-editor-publish-${process.pid}.txt`);
  fs.writeFileSync(msgFile, msg);
  const ct = git(['commit-tree', `${headSha}^{tree}`, '-p', mainSha, '-p', headSha, '-F', msgFile], root, { env: personEnv(person) });
  fs.rmSync(msgFile, { force: true });
  if (ct.code !== 0) { r.notes.push(`Could not prepare the publish: ${ct.stderr.trim()}`); out(r, 2); }
  const pubSha = ct.stdout.trim();

  r.notes.push('Publishing (the project may run its own full build first; this can take a few minutes)...');
  const push = hasRemote
    ? git(['push', '--atomic', remote, `${pubSha}:refs/heads/${main}`, `${pubSha}:refs/heads/${work}`], root, { env: personEnv(person) })
    : git(['update-ref', `refs/heads/${main}`, pubSha, mainSha], root);
  if (push.code !== 0) {
    const err = (push.stderr || '').trim();
    if (/protected branch|GH006|GH013|not allowed to push|pre-receive hook declined|required status check|review/i.test(err)) {
      r.notes.push(`${main} is protected, so it needs a developer's approval. Sending it as an approval request instead...`);
      const pr = openPullRequest(root, config, person, commits);
      r.ok = pr.ok; r.mode = 'pull-request'; r.url = pr.url || null;
      r.notes.push(pr.ok ? `Sent for approval: ${pr.url}` : pr.note);
      out(r, pr.ok ? 4 : 2);
    }
    if (/non-fast-forward|fetch first|rejected/i.test(err)) {
      r.needsRetest = true;
      r.notes.push('Someone updated main a moment ago. Run sync.mjs, verify.mjs, then publish again.');
      out(r, 3);
    }
    r.notes.push(`Publishing did not go through; nothing changed online:\n${err.split('\n').slice(-20).join('\n')}`);
    out(r, 2);
  }
  git(['merge', '--ff-only', '--quiet', pubSha], root);
  if (refExists(root, `refs/heads/${main}`) && git(['merge-base', '--is-ancestor', main, pubSha], root).code === 0 && hasRemote) {
    git(['update-ref', `refs/heads/${main}`, pubSha], root);
  }
  r.ok = true; r.mode = 'merge'; r.published = pubSha.slice(0, 9);
  r.notes.push(`Published ${commits.length} change(s) to ${main} (${r.published}).`, deployNote(config));
  out(r, 0);
}

function undoLast(root, config, person, mainRef, r, args) {
  const { remote, main, work } = config.branches;
  const tip = gitOut(['rev-parse', mainRef], root);
  const subject = gitOut(['log', '-1', '--format=%s', tip], root) || '';
  const body = gitOut(['log', '-1', '--format=%B', tip], root) || '';
  const isPublish = /^Publish SEO changes from /.test(subject) && /Published-by:/.test(body);
  if (!isPublish) {
    r.notes.push(`The latest change on ${main} is not an SEO publish ("${subject}"), so it cannot be undone automatically without affecting other people's work. Ask the developer (WhatsApp message).`);
    out(r, 2);
  }
  if (!args.confirmed) { r.notes.push(`Would undo: ${subject} (${tip.slice(0, 9)}). Ask the person to confirm, then run with --confirmed.`); out(r, 0); }
  const parentTree = gitOut(['rev-parse', `${tip}^1^{tree}`], root);
  const msg = `Revert "${subject}"\n\nUndoes SEO publish ${tip.slice(0, 9)}; the site goes back to how it was before it.\n\nReverted-by: ${person.name}${person.email ? ` <${person.email}>` : ''} (${person.role || 'SEO'})\n`;
  const msgFile = path.join(os.tmpdir(), `seo-editor-undo-${process.pid}.txt`);
  fs.writeFileSync(msgFile, msg);
  const ct = git(['commit-tree', parentTree, '-p', tip, '-F', msgFile], root, { env: personEnv(person) });
  fs.rmSync(msgFile, { force: true });
  if (ct.code !== 0) { r.notes.push(`Could not prepare the undo: ${ct.stderr.trim()}`); out(r, 2); }
  const sha = ct.stdout.trim();
  const push = git(['push', remote, `${sha}:refs/heads/${main}`], root, { env: personEnv(person) });
  if (push.code !== 0) { r.notes.push(`The undo did not go through:\n${push.stderr.trim().split('\n').slice(-15).join('\n')}`); out(r, 2); }
  git(['fetch', remote, '--quiet'], root);
  const s = syncBranch({ fetch: false });
  r.ok = true;
  r.notes.push(`Undone on ${main} (${sha.slice(0, 9)}). ${deployNote(config)}`,
    s.ok ? `The draft branch ${work} now matches the live site again; the undone edits can be redone later if wanted.` : 'Bringing the undo into the draft branch needs attention (run sync.mjs).');
  out(r, 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
