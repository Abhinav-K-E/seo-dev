#!/usr/bin/env node
// SessionStart hook. On the SEO editor's checkout (or the work branch) it brings the draft branch up to date
// with main and tells Claude to work through the seo-dev skill. Silent everywhere else.
import fs from 'node:fs';
import { repoRoot, loadConfig, seoMode } from './lib.mjs';
import { syncBranch } from './sync.mjs';

process.env.GIT_TERMINAL_PROMPT = '0'; // never hang on a password prompt inside a hook
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* no input */ }
const root = repoRoot(input.cwd || process.cwd());
if (!root) process.exit(0);
const { config, exists } = loadConfig(root);
const mode = seoMode(root, config);
if (!mode.on) process.exit(0);

const lines = [];
const who = mode.person ? mode.person.name : null;
lines.push(`SEO EDITOR MODE is on in this project${who ? ` for ${who}` : ''}.`);
lines.push('Handle every request in this session through the seo-dev skill (invoke it now if it is not loaded): friendly plain language with no developer jargon, edit only content/presentation files, never change the logic layer, take data only from the existing API (if it is missing, say so and write the backend developer a WhatsApp message), no workarounds, test and check the UI before saving, save with the person\'s name, and ask with buttons before publishing.');
if (!exists) lines.push('The project map (.claude/seo-editor/config.json) is missing, so nothing can be edited yet. Tell the person the developer needs to finish the one-time setup (references/setup.md).');
if (!who) lines.push('The editor\'s name is not saved on this computer yet: ask for their name and email first (scripts/person.mjs).');

if (input.source === 'compact') {
  lines.push('(Context was compacted: re-read the skill\'s SKILL.md before continuing.)');
} else if (exists) {
  try {
    const r = syncBranch({ fetch: true, abortOnConflict: true });
    if (r.ok) {
      lines.push(`Draft branch ${r.branch} is ready${r.created ? ' (just created from main)' : ''}${r.mainUpdates ? `; brought in ${r.mainUpdates} new update(s) from main` : '; already up to date with main'}${r.pulledFromRemoteWork ? `; pulled ${r.pulledFromRemoteWork} change(s) from the online copy` : ''}.`);
      if (r.unpublished) lines.push(`${r.unpublished} saved change(s) are not published yet.`);
      if (r.dirty) lines.push('There are unsaved edits from an earlier session; mention them to the person before starting new work.');
      if (r.fetchError) lines.push(`Could not reach the online project (${r.fetchError}); working with the local copy.`);
      for (const d of r.drift) lines.push(`WARNING: logic-layer file ${d.path} differs from main; restore it from main before saving.`);
    } else {
      lines.push(`Branch sync needs attention: ${r.notes.join(' ')}`);
      for (const c of r.conflicts) lines.push(`  overlapping edit: ${c.path} [${c.zone}]`);
    }
  } catch (e) {
    lines.push(`Branch sync could not run automatically (${e.message}). Run scripts/sync.mjs at the start of the task.`);
  }
}
process.stdout.write(lines.join('\n') + '\n');
