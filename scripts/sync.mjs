#!/usr/bin/env node
// Puts the checkout on the SEO work branch and brings in the latest main.
//   node sync.mjs                 switch/create branch, pull latest, merge main
//   node sync.mjs --continue      finish a merge after conflicts were resolved
//   node sync.mjs --abort         cancel a merge that hit conflicts
//   --no-fetch  --abort-on-conflict  --json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  git, gitOut, requireRepo, loadConfig, loadPerson, currentBranch, refExists, countCommits, mergeInProgress,
  unmergedFiles, ensureLocalIgnores, classify, ALLOWED_ZONES, parseArgs, emit, pendingChanges,
} from './lib.mjs';

export function personEnv(person) {
  if (!person) return process.env;
  return {
    ...process.env,
    GIT_AUTHOR_NAME: person.name, GIT_AUTHOR_EMAIL: person.email || '',
    GIT_COMMITTER_NAME: person.name, GIT_COMMITTER_EMAIL: person.email || '',
  };
}

function conflictMarkers(root, files) {
  const bad = [];
  for (const f of files) {
    try {
      const t = fs.readFileSync(path.join(root, f), 'utf8');
      if (/^<{7}( |$)/m.test(t) && /^={7}$/m.test(t) && /^>{7}( |$)/m.test(t)) bad.push(f);
    } catch { /* deleted or binary */ }
  }
  return bad;
}

// Logic-layer files on the work branch must stay identical to main.
export function protectedDrift(root, config) {
  const { remote, main } = config.branches;
  const mainRef = refExists(root, `${remote}/${main}`) ? `${remote}/${main}` : main;
  const out = gitOut(['diff', '--name-only', '-z', `${mainRef}...HEAD`], root) ?? '';
  const committed = out.split('\0').filter(Boolean);
  const working = (gitOut(['diff', '--name-only', '-z', 'HEAD'], root) ?? '').split('\0').filter(Boolean);
  const all = [...new Set([...committed, ...working])];
  return all.filter((f) => { const z = classify(f, config); return !ALLOWED_ZONES.has(z) && z !== 'scratch' && f !== '.claude/launch.json'; })
    .map((f) => ({ path: f, zone: classify(f, config) }));
}

export function syncBranch({ fetch = true, abortOnConflict = false } = {}) {
  const root = requireRepo();
  const { config, exists } = loadConfig(root);
  const person = loadPerson(root);
  const env = personEnv(person);
  const { work, main, remote } = config.branches;
  ensureLocalIgnores(root);
  const r = { ok: true, branch: null, created: false, switchedFrom: null, fetched: false, fetchError: null,
    pulledFromRemoteWork: 0, mainUpdates: 0, conflicts: [], drift: [], dirty: false, unpublished: 0,
    configMissing: !exists, notes: [] };

  if (mergeInProgress(root)) {
    r.ok = false;
    r.conflicts = unmergedFiles(root).map((f) => ({ path: f, zone: classify(f, config) }));
    r.notes.push('A merge is still in progress. Resolve the files listed, then run sync.mjs --continue (or --abort).');
    return r;
  }

  const hasRemote = !!gitOut(['remote', 'get-url', remote], root);
  if (fetch && hasRemote) {
    const f = git(['fetch', remote, '--prune', '--quiet'], root);
    r.fetched = f.code === 0;
    if (f.code !== 0) r.fetchError = (f.stderr || '').trim().split('\n').slice(-3).join(' ');
  }
  const mainRef = hasRemote && refExists(root, `${remote}/${main}`) ? `${remote}/${main}` : main;
  if (!refExists(root, mainRef)) {
    r.ok = false;
    r.notes.push(`Could not find the main branch "${main}". Check .claude/seo-editor/config.json (branches.main).`);
    return r;
  }

  let branch = currentBranch(root);
  if (branch !== work) {
    r.switchedFrom = branch;
    const hasLocal = refExists(root, `refs/heads/${work}`);
    const hasRemoteWork = hasRemote && refExists(root, `refs/remotes/${remote}/${work}`);
    let s;
    if (hasLocal) s = git(['switch', work], root);
    else if (hasRemoteWork) s = git(['switch', '-c', work, '--track', `${remote}/${work}`], root);
    else { s = git(['switch', '-c', work, mainRef], root); r.created = s.code === 0; }
    if (s.code !== 0) {
      r.ok = false;
      r.notes.push(`Could not switch to ${work}: ${(s.stderr || '').trim().split('\n').slice(-2).join(' ')}. ` +
        'Usually this means there are unsaved edits on the current branch that clash with the draft branch.');
      return r;
    }
    if (hasRemoteWork || r.created) {
      // no upstream needed for a fresh branch; commit.mjs --push sets it
    }
    branch = work;
  }
  r.branch = branch;

  // 1. catch up with the remote copy of the work branch (other machine, or the GitHub sync job)
  const remoteWork = `${remote}/${work}`;
  if (hasRemote && refExists(root, `refs/remotes/${remoteWork}`)) {
    const behind = countCommits(root, `HEAD..${remoteWork}`);
    if (behind > 0) {
      const ahead = countCommits(root, `${remoteWork}..HEAD`);
      const args = ahead === 0 ? ['merge', '--ff-only', '--autostash', remoteWork]
        : ['merge', '--no-ff', '--autostash', '-m', `chore(sync): combine local and online copies of ${work}`, remoteWork];
      const m = git(args, root, { env });
      if (m.code !== 0) return conflictResult(root, config, r, abortOnConflict, remoteWork);
      noteAutostash(r, m);
      r.pulledFromRemoteWork = behind;
    }
  }

  // 2. bring in the latest main
  const updates = countCommits(root, `HEAD..${mainRef}`);
  if (updates > 0) {
    const m = git(['merge', '--no-ff', '--autostash', '-m', `chore(sync): bring in latest ${main} (${updates} update${updates === 1 ? '' : 's'})`, mainRef], root, { env });
    if (m.code !== 0) return conflictResult(root, config, r, abortOnConflict, mainRef);
    noteAutostash(r, m);
    r.mainUpdates = updates;
  }

  r.drift = protectedDrift(root, config);
  if (r.drift.length) r.notes.push('Some logic-layer files on the draft branch differ from main. Restore them from main before saving (see git-and-publish.md).');
  { const p = pendingChanges(root, config); r.dirty = p.allowed.length > 0 || p.blocked.length > 0; }
  r.unpublished = Number(gitOut(['rev-list', '--count', '--no-merges', `${mainRef}..HEAD`], root) || 0);
  return r;
}

function noteAutostash(r, m) {
  if (/autostash.*conflict|conflict.*autostash|stash entry is kept/i.test(m.stdout + m.stderr)) {
    r.ok = false;
    r.notes.push('Unsaved edits were set aside during the update and overlap with the new changes; they are kept safely in "git stash list". Re-apply them by hand (git stash show -p, then edit), not with workarounds.');
  }
}

function conflictResult(root, config, r, abortOnConflict, from) {
  r.ok = false;
  r.conflicts = unmergedFiles(root).map((f) => ({ path: f, zone: classify(f, config) }));
  if (!r.conflicts.length) {
    r.notes.push(`Could not bring in ${from}. Git said: ${(gitOut(['status', '--short'], root) || '').slice(0, 400)}`);
    if (mergeInProgress(root)) git(['merge', '--abort'], root);
    return r;
  }
  if (abortOnConflict) {
    git(['merge', '--abort'], root);
    r.notes.push(`Bringing in ${from} hit overlapping edits, so it was cancelled for now. Run sync.mjs inside the session to resolve it.`);
  } else {
    r.notes.push(`Overlapping edits while bringing in ${from}. Resolve them (see git-and-publish.md), then run sync.mjs --continue.`);
  }
  return r;
}

export function continueMerge() {
  const root = requireRepo();
  const { config } = loadConfig(root);
  const env = personEnv(loadPerson(root));
  const r = { ok: false, notes: [], drift: [], conflicts: [] };
  if (!mergeInProgress(root)) { r.ok = true; r.notes.push('No merge in progress.'); return r; }
  const left = unmergedFiles(root);
  if (left.length) { r.conflicts = left.map((f) => ({ path: f, zone: classify(f, config) })); r.notes.push('These files still have unresolved overlaps.'); return r; }
  const changed = (gitOut(['diff', '--name-only', '-z', 'HEAD'], root) ?? '').split('\0').filter(Boolean);
  const markers = conflictMarkers(root, changed);
  if (markers.length) { r.conflicts = markers.map((f) => ({ path: f, zone: classify(f, config), markers: true })); r.notes.push('Conflict markers (<<<<<<< ======= >>>>>>>) are still in these files.'); return r; }
  // On a merge, logic files must end up exactly as main has them.
  const { remote, main } = config.branches;
  const mainRef = refExists(root, `${remote}/${main}`) ? `${remote}/${main}` : main;
  const vsMain = (gitOut(['diff', '--name-only', '-z', mainRef], root) ?? '').split('\0').filter(Boolean);
  r.drift = vsMain.filter((f) => { const z = classify(f, config); return !ALLOWED_ZONES.has(z) && z !== 'scratch'; })
    .map((f) => ({ path: f, zone: classify(f, config) }));
  if (r.drift.length) {
    r.notes.push(`These logic-layer files must match ${main}. Restore each with: git checkout ${mainRef} -- <file>, then run --continue again.`);
    return r;
  }
  git(['add', '-A'], root);
  const c = git(['commit', '--no-edit', '--cleanup=strip'], root, { env });
  if (c.code !== 0) { r.notes.push(`Finishing the merge failed: ${(c.stderr || c.stdout).trim().slice(-600)}`); return r; }
  r.ok = true;
  r.notes.push('Merge finished.');
  return r;
}

function human(r) {
  const lines = [];
  if (r.configMissing) lines.push('! No project map yet (.claude/seo-editor/config.json). Run the setup in references/setup.md first.');
  if (r.branch) lines.push(`Branch: ${r.branch}${r.created ? ' (created from main)' : ''}${r.switchedFrom ? ` (switched from ${r.switchedFrom})` : ''}`);
  if (r.fetchError) lines.push(`! Could not reach the online copy: ${r.fetchError}`);
  if (r.pulledFromRemoteWork) lines.push(`Pulled ${r.pulledFromRemoteWork} saved change(s) from the online copy of the draft branch.`);
  if (r.mainUpdates) lines.push(`Brought in ${r.mainUpdates} new update(s) from main.`);
  else if (r.ok && r.branch) lines.push('Already up to date with main.');
  if (r.unpublished) lines.push(`Saved but not yet published: ${r.unpublished} change(s).`);
  if (r.dirty) lines.push('There are unsaved edits in the working folder.');
  for (const c of r.conflicts || []) lines.push(`CONFLICT [${c.zone}] ${c.path}${c.markers ? ' (markers left)' : ''}`);
  for (const d of r.drift || []) lines.push(`DRIFT [${d.zone}] ${d.path} differs from main`);
  for (const n of r.notes || []) lines.push(n);
  lines.push(r.ok ? 'STATUS: ok' : 'STATUS: needs attention');
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  let r;
  if (args.continue) r = continueMerge();
  else if (args.abort) {
    const root = requireRepo();
    const a = git(['merge', '--abort'], root);
    r = { ok: a.code === 0, notes: [a.code === 0 ? 'Merge cancelled; nothing was changed.' : (a.stderr || '').trim()] };
  } else r = syncBranch({ fetch: !args['no-fetch'], abortOnConflict: !!args['abort-on-conflict'] });
  emit(r, human(r));
  process.exit(r.ok ? 0 : 2);
}
