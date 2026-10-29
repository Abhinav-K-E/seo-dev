#!/usr/bin/env node
// Installs the skill into a website project (run by the developer/owner, once per project).
//   node install.mjs /path/to/project [--github-action] [--no-hooks] [--work dev-by-seo] [--main main] [--mode merge|pull-request]
// Copies the skill to <project>/.claude/skills/seo-dev, adds the guard + session hooks to
// <project>/.claude/settings.json, optionally adds the GitHub Action that keeps the draft branch synced,
// and writes a first project map (.claude/seo-editor/config.json) from auto-detection.
import fs from 'node:fs';
import path from 'node:path';
import { SKILL_DIR, readJson, writeJson, run, parseArgs, CONFIG_REL } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const target = path.resolve(args._[0] || process.cwd());
const top = run('git', ['rev-parse', '--show-toplevel'], { cwd: target });
if (top.code !== 0) { console.error(`${target} is not a git project.`); process.exit(1); }
const root = fs.realpathSync(top.stdout.trim());
const dest = path.join(root, '.claude', 'skills', 'seo-dev');
const work = String(args.work || 'dev-by-seo');
const main = String(args.main || 'main');

// 1. copy the skill (without test material)
if (path.resolve(SKILL_DIR) !== path.resolve(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(SKILL_DIR, dest, { recursive: true, filter: (src) => !/[\\/](\.git|evals|node_modules|\.DS_Store|[^\\/]*-workspace)([\\/]|$)/.test(path.relative(SKILL_DIR, src) ? '/' + path.relative(SKILL_DIR, src) : '') });
}
console.log(`Skill copied to ${path.relative(root, dest)}`);

// 2. hooks in project settings (they only act on the SEO editor's checkout or the work branch)
if (!args['no-hooks']) {
  const file = path.join(root, '.claude', 'settings.json');
  const settings = readJson(file, {}) || {};
  settings.hooks = settings.hooks || {};
  const guardCmd = 'node "$CLAUDE_PROJECT_DIR/.claude/skills/seo-dev/scripts/guard.mjs"';
  const startCmd = 'node "$CLAUDE_PROJECT_DIR/.claude/skills/seo-dev/scripts/session_start.mjs"';
  const ensure = (event, matcher, command, timeout) => {
    const list = settings.hooks[event] = settings.hooks[event] || [];
    const present = list.some((g) => (g.hooks || []).some((h) => (h.command || '').includes(command.split('/scripts/')[1])));
    if (!present) list.push({ matcher, hooks: [{ type: 'command', command, ...(timeout ? { timeout } : {}) }] });
  };
  ensure('PreToolUse', 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell', guardCmd, 30);
  ensure('SessionStart', 'startup|resume|clear|compact', startCmd, 120);
  writeJson(file, settings);
  console.log('Hooks added to .claude/settings.json (guard + session start).');
}

// 3. GitHub Action to keep the work branch synced with main
if (args['github-action']) {
  const wf = path.join(root, '.github', 'workflows', `sync-${work}.yml`);
  const tpl = fs.readFileSync(path.join(SKILL_DIR, 'assets', 'sync-dev-by-seo.yml'), 'utf8').replaceAll('__WORK__', work).replaceAll('__MAIN__', main);
  fs.mkdirSync(path.dirname(wf), { recursive: true });
  fs.writeFileSync(wf, tpl);
  console.log(`GitHub Action written: ${path.relative(root, wf)}`);
}

// 4. first project map from auto-detection
const cfgPath = path.join(root, CONFIG_REL);
const existed = fs.existsSync(cfgPath);
const a = run(process.execPath, [path.join(dest, 'scripts', 'analyze.mjs'), '--write-config'], { cwd: root });
process.stdout.write(a.stdout.split('\n').slice(0, 14).join('\n') + '\n');
if (!existed && fs.existsSync(cfgPath)) {
  const cfg = readJson(cfgPath);
  cfg.branches = { ...cfg.branches, work, main };
  if (args.mode) cfg.publish = { mode: String(args.mode) };
  writeJson(cfgPath, cfg);
}

console.log(`
Next steps for the developer:
  1. Open the project in Claude Code and say: "finish the seo-dev setup" - Claude reviews the detected
     zones with you, writes .claude/seo-editor/project-map.md and fills in the backend contact.
  2. Commit .claude/ (and .github/workflows/ if added) to ${main} and push.
  3. Create the draft branch online: git push origin ${main}:refs/heads/${work}
  4. Give the SEO editor push access to ${work} (and ${main}, unless publish mode is pull-request).
`);
