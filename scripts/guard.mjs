#!/usr/bin/env node
// PreToolUse hook: keeps an SEO session inside the content/presentation layer.
// Active only on the SEO editor's checkout (person file present) or on the work branch.
// Registered in .claude/settings.json by install.mjs; the skill's frontmatter hook calls it with
// --from-skill and then steps aside when the settings hook is already present (no double run).
// Denies with a JSON reason so Claude can explain and recover instead of working around it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  repoRoot, loadConfig, seoMode, toRel, classify, isTempPath, SCRATCH_REL, SKILL_DIR,
} from './lib.mjs';

const SKILL_ROOT = SKILL_DIR;

const FROM_SKILL = process.argv.includes('--from-skill');

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

const ZONE_REASON = {
  protected: (rel) =>
    `"${rel}" is part of the developer's logic layer (data, API, state, config, build or tooling). ` +
    `SEO work may read it but never change it. Do not look for another way to change it or copy its logic elsewhere. ` +
    `If the request truly needs this changed, stop that part, explain it to the person in plain words, and write the developer a WhatsApp message (references/data-and-api.md).`,
  unlisted: (rel) =>
    `"${rel}" is outside the SEO editable area in .claude/seo-editor/config.json, so it is treated as protected. ` +
    `If it is presentation or content only, a developer can add it to the editable list; draft that WhatsApp request instead of editing it.`,
  generated: (rel) =>
    `"${rel}" is build output or a cache. Editing it is never a real fix; change the source file instead.`,
  outside: (rel) =>
    `"${rel}" is outside this website project. SEO edits stay inside the project (temporary files may go in the system temp folder).`,
  state: () =>
    `The ${SCRATCH_REL}/state folder is written only by the skill's scripts (test results, approvals). Run the script instead.`,
};

const SINKS = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/;

function checkPath(root, config, p) {
  if (!p || p === '-' || SINKS.test(p)) return null;
  const abs = path.isAbsolute(p) ? p : path.join(root, p);
  const rel = toRel(root, abs);
  if (rel === null) {
    if (isTempPath(abs)) return null;
    return ZONE_REASON.outside(abs);
  }
  if (rel.startsWith(`${SCRATCH_REL}/state`)) return ZONE_REASON.state();
  const zone = classify(rel, config);
  if (zone === 'editable' || zone === 'shared' || zone === 'scratch') return null;
  return (ZONE_REASON[zone] || ZONE_REASON.unlisted)(rel);
}

// ---------- shell parsing (best effort; the commit and publish scripts re-check everything) ----------

// Drop heredoc bodies so their text is not mistaken for commands.
function stripHeredocs(cmd) {
  const lines = cmd.split('\n');
  const out = [];
  let end = null;
  for (const line of lines) {
    if (end !== null) { if (line.trim() === end) end = null; continue; }
    out.push(line);
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (m) end = m[2];
  }
  return out.join('\n');
}

function splitSegments(cmd) {
  const segs = [];
  let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"') { cur += cmd[++i] ?? ''; } continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\') { cur += c + (cmd[++i] ?? ''); continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') {
      if (c === '&' && (cmd[i + 1] === '>' || cmd[i - 1] === '>')) { cur += c; continue; }
      segs.push(cur); cur = '';
      continue;
    }
    if (c === '$' && cmd[i + 1] === '(') { segs.push(cur); cur = ''; i++; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

function words(seg) {
  const out = [];
  let cur = '', q = null, any = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < seg.length) cur += seg[++i]; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; any = true; continue; }
    if (c === '\\' && i + 1 < seg.length) { cur += seg[++i]; any = true; continue; }
    if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
    cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}

function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

// Returns redirect targets and the words with redirections removed.
function stripRedirects(ws) {
  const targets = [], rest = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const m = /^(\d*|&)(>>?|>\|)(.*)$/.exec(w);
    if (m) {
      let t = m[3];
      if (!t) t = ws[++i] ?? '';
      if (t && !t.startsWith('&') && t !== '/dev/null' && t !== '/dev/stderr' && t !== '/dev/stdout') targets.push(t);
      continue;
    }
    if (/^\d*<</.test(w) || /^\d*</.test(w)) { if (/^\d*<<?$/.test(w)) i++; continue; }
    rest.push(w);
  }
  return { targets, rest };
}

function gitSub(ws) {
  // skip "git" global options: -C <dir>, -c k=v, --git-dir=..., --no-pager, etc.
  let i = 1;
  const globals = [];
  while (i < ws.length && ws[i].startsWith('-')) {
    globals.push(ws[i]);
    if (ws[i] === '-C' || ws[i] === '-c' || ws[i] === '--git-dir' || ws[i] === '--work-tree' || ws[i] === '--namespace') { globals.push(ws[i + 1]); i += 2; }
    else i++;
  }
  return { sub: ws[i], args: ws.slice(i + 1), globals };
}

const SHA = /^[0-9a-f]{7,40}$/i;

function checkGit(root, config, ws) {
  const { sub, args, globals } = gitSub(ws);
  const { work, main } = config.branches;
  const joined = args.join(' ');
  if (globals.some((g) => /hooksPath|core\.hooks/i.test(g || ''))) return 'Changing git hook settings is not allowed; the project\'s checks must run.';
  switch (sub) {
    case undefined: return null;
    case 'commit':
      return 'Save changes with the skill\'s save script (scripts/commit.mjs) so the message, author name and checks are always right. Raw git commit is not used in SEO mode.';
    case 'push':
      return 'Uploading is done by scripts/commit.mjs --push (draft branch) or scripts/publish.mjs (live site, only after the person clicks "Yes, publish it"). Raw git push is not used in SEO mode.';
    case 'merge':
      if (args.includes('--abort')) return null;
      return 'Bringing in the latest main is done by scripts/sync.mjs, which also checks the logic layer stayed untouched. Use it instead of raw git merge.';
    case 'rebase': case 'cherry-pick': case 'revert': case 'am': case 'apply': case 'filter-branch': case 'filter-repo':
    case 'update-ref': case 'replace': case 'reflog': case 'gc': case 'prune': case 'notes': case 'submodule':
      return `git ${sub} rewrites or bulk-changes history/files and is not used in SEO mode. If a saved change must be undone, edit the files back and save again, or ask the developer.`;
    case 'reset':
      if (/--(hard|merge|keep|soft)\b/.test(joined) || args.some((a) => /^(HEAD[~^]|@\{|ORIG_HEAD|origin\/)/.test(a) || SHA.test(a)))
        return 'Resetting can throw away work. To undo one file use "git restore <file>"; to undo saved work ask the person first and edit the files back.';
      return null;
    case 'checkout': {
      if (args.includes('--')) return null; // restoring files
      if (args.some((a) => ['-b', '-B', '--orphan', '--detach', '-f', '--force'].includes(a))) return `Stay on the ${work} branch; switching or creating branches is handled by the scripts.`;
      const nonOpt = args.filter((a) => !a.startsWith('-'));
      if (nonOpt.length && nonOpt.every((a) => fs.existsSync(path.join(root, a)))) return null;
      return `Stay on the ${work} branch. To restore a file use "git restore <file>" or "git checkout -- <file>".`;
    }
    case 'switch':
      return `Stay on the ${work} branch; scripts/sync.mjs and scripts/publish.mjs handle branches.`;
    case 'branch':
      if (args.some((a) => /^-(d|D|m|M|f|c|C)$|^--(delete|move|force|copy|set-upstream-to|unset-upstream)/.test(a))) return 'Deleting, renaming or forcing branches is not allowed in SEO mode.';
      if (args.filter((a) => !a.startsWith('-')).length) return 'Creating branches is not needed; all SEO work happens on ' + work + '.';
      return null;
    case 'tag':
      return args.length && !args.every((a) => ['-l', '--list', '-n'].includes(a) || a.startsWith('-n')) ? 'Tags are managed by developers.' : null;
    case 'stash':
      if (/^(drop|clear)\b/.test(args[0] || '')) return 'Dropping stashed work can lose changes; ask the person first.';
      return null;
    case 'clean':
      if (args.some((a) => /^-[a-zA-Z]*f/.test(a) || a === '--force')) return 'git clean deletes files for good. Remove specific files you created instead.';
      return null;
    case 'config': {
      const ro = args.some((a) => ['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin'].includes(a)) || args.filter((a) => !a.startsWith('-')).length === 1;
      if (ro) return null;
      if (args.some((a) => a === '--global' || a === '--system')) return 'Global git settings are not changed in SEO mode.';
      const key = args.find((a) => !a.startsWith('-')) || '';
      if (/^user\.(name|email)$/.test(key)) return null;
      return `Changing git setting "${key}" is not allowed in SEO mode.`;
    }
    case 'rm': case 'mv': {
      for (const t of args.filter((a) => !a.startsWith('-'))) {
        const why = checkPath(root, config, path.resolve(root, t));
        if (why) return why;
      }
      return null;
    }
    case 'remote':
      if (args.some((a) => ['add', 'remove', 'rm', 'rename', 'set-url', 'set-head', 'prune'].includes(a))) return 'Remote settings are managed by developers.';
      return null;
    case 'worktree':
      if (args[0] && args[0] !== 'list') return 'Extra worktrees are managed by the scripts.';
      return null;
    default:
      return null;
  }
}

const PM = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PM_MUTATE = /^(add|install|i|in|ins|inst|insta|instal|isnt|isntall|uninstall|un|unlink|remove|rm|r|update|up|upgrade|dedupe|link|ln|pkg|version|unpublish|deprecate|dist-tag|patch|patch-commit|set-script|import)$/;
const DEPLOY_SCRIPT = /deploy|release|publish|rollback|^versions?(:|$)/i;
const DEPLOY_MSG = 'Deploying happens only through the publish step after the person clicks "Yes, publish it" (and then the site\'s own pipeline).';

function checkPackageManager(root, config, ws) {
  let i = 1;
  while (ws[i] && ws[i].startsWith('-')) {
    if (['--filter', '-F', '-C', '--dir', '--prefix', '--cwd', '-w', '--workspace'].includes(ws[i])) i++;
    i++;
  }
  const sub = ws[i];
  const rest = ws.slice(i + 1);
  if (!sub) return null;
  const script = ['run', 'run-script', 'rum', 'urn'].includes(sub) ? rest.find((a) => !a.startsWith('-')) || '' : sub;
  if (DEPLOY_SCRIPT.test(script)) return DEPLOY_MSG;
  if (sub === 'audit') return rest.includes('fix') ? 'Fixing dependencies changes the project setup; that is developer work.' : null;
  if (PM_MUTATE.test(sub)) {
    const pkgs = rest.filter((a) => !a.startsWith('-'));
    if (['install', 'i', 'in'].includes(sub) && pkgs.length === 0) return null; // installing the existing dependencies is fine
    return 'Adding, removing or updating packages changes the project setup (package.json / lock file), which belongs to the developer. Build it with what the project already has, or ask the developer.';
  }
  return null; // run, exec, test, ci, build scripts, ...
}

const WRITE_API = /(writeFile|appendFile|createWriteStream|rmSync|unlinkSync|unlink\(|renameSync|rename\(|copyFile|cpSync|mkdirSync|truncate|open\([^)]*['"][wax+]|\.write_text|\.write_bytes|\.write\(|json\.dump\(|shutil\.|os\.(remove|rename|replace|unlink)|Path\([^)]*\)\.(unlink|rename|touch)|File\.write|file_put_contents|IO\.write|fs\.promises)/;
const INTERP = /^(node|deno|bun|python|python3|ruby|perl|php|tsx|ts-node)$/;

// Heredoc bodies fed to an interpreter (python3 - <<'EOF' ... open(p,'w') ... EOF).
function heredocScriptWrites(cmd) {
  const lines = cmd.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /\b(node|deno|bun|python3?|ruby|perl|php)\b[^|;&\n]*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(lines[i]);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== m[3]; j++) body.push(lines[j]);
    if (WRITE_API.test(body.join('\n'))) return true;
  }
  return false;
}

// "python3 /tmp/edit.py" or "node scratch.mjs": read scripts that are not tracked project code.
function scriptFileWrites(root, cmd, args) {
  if (!INTERP.test(cmd)) return false;
  const file = args.find((a) => !a.startsWith('-'));
  if (!file) return false;
  const abs = path.resolve(root, expandHome(file));
  if (abs.startsWith(SKILL_ROOT + path.sep) || isSkillScript(abs)) return false; // the skill's own scripts
  const rel = toRel(root, abs);
  if (rel !== null && gitTracked(root, rel)) return false; // the developers' own scripts
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 300 * 1024) return false;
    return WRITE_API.test(fs.readFileSync(abs, 'utf8'));
  } catch { return false; }
}

// The same skill installed elsewhere (e.g. ~/.claude/skills/seo-dev next to the project copy).
function isSkillScript(abs) {
  if (!/[\\/]seo-dev[\\/]scripts[\\/][a-z0-9_]+\.mjs$/.test(abs)) return false;
  try {
    const dir = path.dirname(abs);
    return fs.existsSync(path.join(dir, 'guard.mjs')) && /^name:\s*seo-dev\s*$/m.test(fs.readFileSync(path.join(dir, '..', 'SKILL.md'), 'utf8'));
  } catch { return false; }
}

function gitTracked(root, rel) {
  return spawnSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root, stdio: 'ignore' }).status === 0;
}

const SCRIPT_MSG = 'Changing files through a script hides which files change, so the checks cannot see them. Use the Edit/Write tools for page and content files (and node <skill>/scripts/i18n.mjs for translation files).';

function inlineWrites(cmdText) {
  return /\b(node|deno|bun|python3?|ruby|perl|php)\b[^|;&]*\s-(e|c|p|E|r)\b/.test(cmdText) &&
    /(writeFile|appendFile|createWriteStream|rmSync|unlinkSync|renameSync|copyFile|mkdirSync|open\([^)]*['"][wa]|\.write_text|\.write\(|shutil\.|os\.remove|File\.write|file_put_contents)/.test(cmdText);
}

function checkWriteTargets(root, config, cmd, args) {
  const nonOpt = args.filter((a) => !a.startsWith('-') || a === '-');
  let targets = [];
  switch (cmd) {
    case 'rm': case 'rmdir': case 'unlink': case 'shred': {
      for (const t of nonOpt) {
        const rel = toRel(root, path.resolve(root, expandHome(t)));
        if (rel !== null && (classify(rel, config) === 'generated' || classify(`${rel}/_`, config) === 'generated')) continue; // clearing build caches is fine
        targets.push(t);
      }
      break;
    }
    case 'mv': targets = nonOpt; break;
    case 'cp': case 'install': case 'ln': case 'rsync': case 'ditto': {
      if (nonOpt.length >= 2) {
        const dest = nonOpt[nonOpt.length - 1];
        const destAbs = path.resolve(root, expandHome(dest));
        const isDir = fs.existsSync(destAbs) && fs.statSync(destAbs).isDirectory();
        targets = isDir ? nonOpt.slice(0, -1).map((s) => path.join(dest, path.basename(s))) : [dest];
      }
      break;
    }
    case 'touch': case 'truncate': case 'chmod': case 'chown': case 'tee':
      targets = cmd === 'chmod' || cmd === 'chown' ? nonOpt.slice(1) : nonOpt;
      break;
    case 'mkdir': // empty folders are harmless; only stop folders outside the project
      for (const t of nonOpt) {
        const abs = path.resolve(root, expandHome(t));
        if (toRel(root, abs) === null && !isTempPath(abs)) return ZONE_REASON.outside(abs);
      }
      break;
    case 'sed': case 'perl': case 'gsed': {
      if (args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place') || /^-[a-zA-Z]*p[a-zA-Z]*i/.test(a))) {
        targets = nonOpt.filter((a) => a !== '' && fs.existsSync(path.resolve(root, expandHome(a))));
      }
      break;
    }
    case 'patch': targets = ['.']; break;
    case 'dd': targets = args.filter((a) => a.startsWith('of=')).map((a) => a.slice(3)); break;
    case 'unzip': case 'tar': case 'curl': case 'wget': {
      const flag = { unzip: '-d', tar: '-C', curl: '-o', wget: '-O' }[cmd];
      const idx = args.findIndex((a) => a === flag || a === '--output' || a === '--output-document' || a === '--directory');
      if (idx > -1 && args[idx + 1]) targets = [args[idx + 1]];
      if (cmd === 'curl' && args.some((a) => a === '-O' || a === '--remote-name')) targets.push('.');
      break;
    }
    default: break;
  }
  for (const t of targets) {
    const why = checkPath(root, config, path.resolve(root, expandHome(t)));
    if (why) return why;
  }
  return null;
}

function checkApiWrite(cmd, args) {
  if (cmd === 'curl') {
    const m = args.findIndex((a) => a === '-X' || a === '--request');
    const method = m > -1 ? (args[m + 1] || '').toUpperCase() : (args.find((a) => /^-X[A-Z]+$/.test(a)) || '').slice(2);
    const sendsBody = args.some((a) => /^(-d|--data.*|-F|--form.*|-T|--upload-file|--json)$/.test(a) || /^-d./.test(a));
    if ((method && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') || sendsBody)
      return 'APIs are read-only for SEO work: only GET requests to look at data are allowed. Changing data is backend work.';
  }
  if (cmd === 'wget' && args.some((a) => /^--(post-data|post-file|method|body-data|body-file)/.test(a)))
    return 'APIs are read-only for SEO work: only GET requests are allowed.';
  if ((cmd === 'http' || cmd === 'https' || cmd === 'xh') && /^(POST|PUT|PATCH|DELETE)$/i.test(args[0] || ''))
    return 'APIs are read-only for SEO work: only GET requests are allowed.';
  return null;
}

function checkDeploy(cmd, args) {
  const a0 = args.find((a) => !a.startsWith('-')) || '';
  if (cmd === 'wrangler' && /^(deploy|publish|versions|rollback|secret|kv|r2|d1|delete|pages)$/.test(a0)) return 'Deploying or changing hosting happens only through the publish step (and the site\'s own pipeline).';
  if ((cmd === 'vercel' || cmd === 'netlify' || cmd === 'firebase' || cmd === 'fly' || cmd === 'flyctl' || cmd === 'heroku' || cmd === 'railway' || cmd === 'amplify') && (args.length === 0 || /^(deploy|--prod|publish|promote|rollback|env|secrets?|alias|remove|rm|destroy)$/.test(a0) || args.includes('--prod')))
    return 'Deploying or changing hosting happens only through the publish step (and the site\'s own pipeline).';
  if (cmd === 'opennextjs-cloudflare' && /^(deploy|upload|populateCache)$/.test(a0)) return 'Deploying happens only through the publish step.';
  if (cmd === 'gh') {
    const sub = args.slice(0, 2).join(' ');
    if (/^(pr merge|pr close|pr review|release |repo |secret |variable |workflow |run |ruleset |label |issue (close|delete|edit))/.test(sub + ' ') || sub === 'pr ready')
      return 'GitHub settings, merges and releases are handled by the publish script or the developer.';
    if (args[0] === 'api' && args.some((x) => /^(-X|--method)$/.test(x) || /^-[fF]$|^--(field|raw-field|input)$/.test(x)))
      return 'Only read-only GitHub API calls are allowed in SEO mode.';
  }
  return null;
}

function checkBash(root, config, command, depth = 0) {
  if (heredocScriptWrites(command || '')) return SCRIPT_MSG;
  const text = stripHeredocs(command || '');
  if (/(^|\s)--no-verify\b|(^|\s)HUSKY=0\b|HUSKY_SKIP_HOOKS|SKIP_SIMPLE_GIT_HOOKS|LEFTHOOK=0|PRE_COMMIT_ALLOW_NO_CONFIG|\bgit\s+commit\b[^|;&]*\s-[a-zA-Z]*n\b/.test(text))
    return 'Skipping the project\'s safety checks (--no-verify, HUSKY=0 and similar) is a workaround and is not allowed. Fix what the check reports.';
  if (/SEO_EDITOR_GUARD\s*=/.test(text)) return 'The SEO guard cannot be switched off from inside an SEO session.';
  if (/disableAllHooks|\.claude\/settings/.test(text) && /(>|tee|sed -i|perl -i|mv |cp |rm )/.test(text)) return 'Claude settings and hooks are not changed in SEO mode.';
  if (inlineWrites(text)) return SCRIPT_MSG;
  for (const seg of splitSegments(text)) {
    let ws = words(seg);
    while (ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0])) ws.shift(); // leading VAR=value
    while (ws.length && ['sudo', 'env', 'command', 'builtin', 'exec', 'nohup', 'time', 'xargs', 'nice'].includes(ws[0])) {
      ws.shift();
      while (ws.length && (ws[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0]))) ws.shift();
    }
    const { targets, rest } = stripRedirects(ws);
    for (const t of targets) { const why = checkPath(root, config, path.resolve(root, expandHome(t))); if (why) return why; }
    if (!rest.length) continue;
    const cmd = path.basename(rest[0]);
    const args = rest.slice(1);
    if (cmd === 'sudo') return 'sudo is not used for website edits.';
    if (scriptFileWrites(root, cmd, args)) return SCRIPT_MSG;
    if (['bash', 'sh', 'zsh', 'dash'].includes(cmd) && depth < 3) {
      const c = args.indexOf('-c');
      if (c > -1 && args[c + 1]) { const why = checkBash(root, config, args[c + 1], depth + 1); if (why) return why; continue; }
    }
    if (cmd === 'eval' && depth < 3) { const why = checkBash(root, config, args.join(' '), depth + 1); if (why) return why; continue; }
    if (cmd === 'git') { const why = checkGit(root, config, rest); if (why) return why; continue; }
    if (PM.has(cmd)) { const why = checkPackageManager(root, config, rest); if (why) return why; }
    if (cmd === 'npx' || cmd === 'pnpx' || cmd === 'bunx') {
      const tool = args.find((a) => !a.startsWith('-')) || '';
      const dep = checkDeploy(path.basename(tool.split('@')[0]), args.slice(args.indexOf(tool) + 1));
      if (dep) return dep;
      if (/^(npm-check-updates|ncu)$/.test(tool) && args.includes('-u')) return 'Updating packages is developer work.';
    }
    const why = checkWriteTargets(root, config, cmd, args) || checkApiWrite(cmd, args) || checkDeploy(cmd, args);
    if (why) return why;
  }
  return null;
}

// ---------- main ----------

const input = readStdin();
const root = repoRoot(input.cwd || process.cwd());
if (!root) process.exit(0);
if (FROM_SKILL) {
  // The project settings hook already runs this guard; don't check every call twice.
  try { if (fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8').includes('seo-dev/scripts/guard.mjs')) process.exit(0); } catch { /* no settings: act */ }
}
const { config } = loadConfig(root);
const mode = seoMode(root, config);
if (!mode.on) process.exit(0);

const tool = input.tool_name || '';
const ti = input.tool_input || {};

if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
  const p = ti.file_path || ti.notebook_path || ti.path;
  const why = checkPath(root, config, p);
  if (why) deny(why);
  process.exit(0);
}

if (tool === 'Bash' || tool === 'PowerShell') {
  const why = checkBash(root, config, ti.command || '');
  if (why) deny(why);
  process.exit(0);
}

process.exit(0);

