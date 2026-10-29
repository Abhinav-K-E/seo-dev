// Shared helpers for the seo-dev scripts.
// Node 18+, no dependencies, works on macOS, Linux and Windows (Git Bash).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CONFIG_REL = '.claude/seo-editor/config.json';
export const PERSON_REL = '.claude/seo-editor/person.local.json';
export const SCRATCH_REL = '.seo-editor'; // logs, screenshots, state; never committed

export const DEFAULT_CONFIG = {
  version: 1,
  project: '',
  siteUrl: '',
  branches: { work: 'dev-by-seo', main: 'main', remote: 'origin' },
  publish: { mode: 'merge' }, // "merge" pushes to main; "pull-request" opens a PR for a developer to approve
  packageManager: 'npm',
  commands: {},
  devServer: { port: 3000, samplePaths: ['/'] },
  zones: { protected: [], shared: [], editable: [] },
  content: {},
  contacts: {
    backend: { name: 'Backend developer', whatsapp: '' },
    frontend: { name: 'Frontend developer', whatsapp: '' },
  },
  commit: { assistantTrailer: false },
};

// Files no SEO session may change, whatever the project config says.
// Gitignore-style: later "!" entries carve exceptions out of earlier ones.
export const ALWAYS_PROTECTED = [
  '.git/**',
  '.claude/**',
  '!.claude/launch.json',
  '!' + PERSON_REL,
  '!.claude/seo-editor/project-map.md',
  '.github/**', '.gitlab/**', '.gitlab-ci.yml', '.circleci/**', 'bitbucket-pipelines.yml', 'azure-pipelines.yml',
  '.husky/**', '.githooks/**', 'lefthook.yml', '.lefthook*', '.pre-commit-config.yaml',
  '**/package.json', '**/package-lock.json', '**/npm-shrinkwrap.json', '**/pnpm-lock.yaml', '**/pnpm-workspace.yaml',
  '**/yarn.lock', '**/.yarnrc', '**/.yarnrc.yml', '**/bun.lock', '**/bun.lockb', '**/.npmrc',
  '.nvmrc', '.node-version', '.tool-versions', '**/composer.json', '**/composer.lock', '**/Gemfile', '**/Gemfile.lock',
  '**/requirements*.txt', '**/pyproject.toml', '**/poetry.lock', '**/go.mod', '**/go.sum',
  '**/.env', '**/.env.*', '**/.dev.vars', '**/*.pem', '**/*.key', '**/*.p12',
  '**/tsconfig*.json', '**/jsconfig*.json', '**/*.config.{js,cjs,mjs,ts,cts,mts}', '**/*.config.*.{js,cjs,mjs,ts}',
  '**/.eslintrc*', '**/eslint.config.*', '**/.prettierrc*', '**/prettier.config.*', '**/.babelrc*', '**/babel.config.*',
  '**/.stylelintrc*', '**/.browserslistrc', '**/.editorconfig', '**/.gitignore', '**/.gitattributes', '**/.lintstagedrc*',
  '**/commitlint.config.*', '**/.commitlintrc*', '**/components.json',
  '**/wrangler.{toml,json,jsonc}', '**/netlify.toml', '**/vercel.json', '**/firebase.json', '**/app.yaml', '**/serverless.yml',
  '**/Dockerfile*', '**/docker-compose*', '**/.dockerignore', '**/Makefile', '**/Procfile', '**/turbo.json', '**/nx.json',
  '**/hugo.{toml,yaml,yml,json}', '_config.yml', '**/angular.json', '**/nuxt.config.*', '**/svelte.config.*', '**/astro.config.*',
  '**/middleware.{js,ts,mjs,cjs}', '**/proxy.{js,ts,mjs}', '**/instrumentation*.{js,ts}', '**/sentry.*.config.*',
  '**/node_modules/**', '**/vendor/**', '**/*.d.ts', '**/*.{test,spec}.*', '**/__tests__/**', '**/__mocks__/**',
  '**/e2e/**', '**/cypress/**', '**/playwright/**', '**/prisma/**', '**/drizzle/**', '**/migrations/**', '**/supabase/**',
];

// Untracked files that dev tools create on their own (e.g. `next dev` writes AGENTS.md/CLAUDE.md).
// They are never part of an SEO save and never block one.
export const TOOL_FILES = [
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', 'next-env.d.ts', '.claude/launch.json',
  '**/*.log', '**/.eslintcache', '**/*.tsbuildinfo', '**/.DS_Store', '**/Thumbs.db',
];

// Build output and caches. Editing these is never a real fix.
export const GENERATED = [
  '**/.next/**', '**/.nuxt/**', '**/.output/**', '**/.astro/**', '**/.svelte-kit/**', '**/.turbo/**', '**/.vercel/**',
  '**/.open-next/**', '**/.wrangler/**', '**/.netlify/**', '**/.cache/**', '**/.parcel-cache/**', '**/.docusaurus/**',
  'dist/**', 'build/**', 'out/**', '_site/**', 'public/build/**', 'resources/_gen/**', 'storybook-static/**',
  'coverage/**', '**/*.tsbuildinfo', '**/.DS_Store',
];

// ---------- processes and git ----------

export function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
  return {
    code: typeof r.status === 'number' ? r.status : r.error ? 127 : 1,
    stdout: r.stdout || '',
    stderr: (r.stderr || '') + (r.error ? `\n${r.error.message}` : ''),
  };
}

// Run a shell command line (used for the project's own npm/pnpm/yarn scripts).
export function sh(commandLine, opts = {}) {
  return run(commandLine, [], { shell: true, ...opts });
}

export function git(args, cwd, opts = {}) {
  return run('git', args, { cwd, ...opts });
}

export function gitOut(args, cwd) {
  const r = git(args, cwd);
  return r.code === 0 ? r.stdout.trim() : null;
}

export function repoRoot(start = process.cwd()) {
  const top = gitOut(['rev-parse', '--show-toplevel'], start);
  return top ? realish(top) : null;
}

export function currentBranch(root) {
  return gitOut(['symbolic-ref', '--quiet', '--short', 'HEAD'], root); // null when detached
}

export function gitPath(root, name) {
  const p = gitOut(['rev-parse', '--git-path', name], root);
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(root, p);
}

export function mergeInProgress(root) {
  const p = gitPath(root, 'MERGE_HEAD');
  return !!p && fs.existsSync(p);
}

export function unmergedFiles(root) {
  const out = gitOut(['diff', '--name-only', '--diff-filter=U', '-z'], root) ?? '';
  return out.split('\0').filter(Boolean);
}

export function isDirty(root) {
  const out = gitOut(['status', '--porcelain'], root);
  return !!out;
}

export function refExists(root, ref) {
  return git(['rev-parse', '--verify', '--quiet', ref], root).code === 0;
}

export function countCommits(root, range) {
  const n = gitOut(['rev-list', '--count', range], root);
  return n ? Number(n) : 0;
}

// Uncommitted changes, split into what an SEO save may include and what it may not.
//   allowed: editable/shared files (these get saved)
//   blocked: anything else the person's work touched (must be undone before saving)
//   ignored: untracked files dev tools create by themselves, and the local .seo-editor folder
export function pendingChanges(root, config) {
  const out = { allowed: [], blocked: [], ignored: [] };
  const st = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root);
  const raw = st.code === 0 ? st.stdout : ''; // not trimmed: the first status column may be a space
  const t = raw.split('\0');
  for (let i = 0; i < t.length; i++) {
    const e = t[i];
    if (!e || e.length < 4) continue;
    const xy = e.slice(0, 2), p = e.slice(3);
    const paths = [p];
    if (xy[0] === 'R' || xy[0] === 'C') paths.push(t[++i]); // rename: next token is the old path
    for (const f of paths.filter(Boolean)) {
      const zone = classify(f, config);
      const untracked = xy === '??';
      if (zone === 'scratch' || (untracked && matchList(TOOL_FILES, f)) || f === '.claude/launch.json') out.ignored.push(f);
      else if (ALLOWED_ZONES.has(zone)) out.allowed.push(f);
      else out.blocked.push({ path: f, zone, untracked });
    }
  }
  return out;
}

// Tree hash of HEAD plus the person's allowed changes, i.e. exactly what a save would commit.
// Used to tie a test run to the exact content that gets saved and published.
export function workingTreeHash(root, config) {
  const index = gitPath(root, 'index');
  const tmp = path.join(os.tmpdir(), `seo-editor-index-${process.pid}-${Math.floor(performance.now() * 1000)}`);
  try {
    if (index && fs.existsSync(index)) fs.copyFileSync(index, tmp);
    const env = { ...process.env, GIT_INDEX_FILE: tmp };
    if (git(['reset', '-q', 'HEAD'], root, { env }).code !== 0) return null;
    const files = config ? pendingChanges(root, config).allowed : null;
    const add = files ? (files.length ? git(['add', '-A', '--', ...files], root, { env }) : { code: 0 }) : git(['add', '-A'], root, { env });
    if (add.code !== 0) return null;
    const r = git(['write-tree'], root, { env });
    return r.code === 0 ? r.stdout.trim() : null;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function headTree(root) {
  return gitOut(['rev-parse', 'HEAD^{tree}'], root);
}

// ---------- paths ----------

// realpath that also works for files that do not exist yet.
export function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  let base = cur;
  try { base = fs.realpathSync.native(cur); } catch { /* keep as is */ }
  return path.join(base, ...rest);
}

// Repo-relative posix path, or null when the path is outside the repo.
export function toRel(root, p) {
  const abs = realish(path.isAbsolute(p) ? p : path.join(root, p));
  const rel = path.relative(root, abs);
  if (rel === '' ) return '.';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export function isTempPath(p) {
  const abs = realish(path.resolve(p));
  const temps = [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
    .map((t) => { try { return fs.realpathSync.native(t); } catch { return t; } });
  return temps.some((t) => abs === t || abs.startsWith(t + path.sep));
}

// ---------- globs ----------

const globCache = new Map();

export function globToRegExp(glob) {
  if (globCache.has(glob)) return globCache.get(glob);
  let g = glob.replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**';
  if (!g.includes('/')) g = '**/' + g; // bare names match at any depth, like .gitignore
  const src = '^' + translate(g) + '$';
  const re = new RegExp(src);
  globCache.set(glob, re);
  return re;
}

function translate(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:[^/]*/)*'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      let depth = 1, j = i + 1;
      for (; j < g.length && depth; j++) { if (g[j] === '{') depth++; else if (g[j] === '}') depth--; }
      if (depth) { re += '\\{'; continue; }
      const inner = g.slice(i + 1, j - 1);
      const parts = []; let buf = '', d = 0;
      for (const ch of inner) {
        if (ch === ',' && d === 0) { parts.push(buf); buf = ''; continue; }
        if (ch === '{') d++; if (ch === '}') d--;
        buf += ch;
      }
      parts.push(buf);
      re += '(?:' + parts.map(translate).join('|') + ')';
      i = j - 1;
    } else if (c === '\\' && i + 1 < g.length) {
      re += g[++i].replace(/[.+^$()|[\]\\{}*?]/g, '\\$&');
    } else {
      // "[" and "]" are literal so Next.js folders like [locale] or [...slug] work as written
      re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
  }
  return re;
}

export function matchGlob(glob, rel) {
  const hasMagic = /[*?{]/.test(glob);
  if (!hasMagic) {
    const g = glob.replace(/^\.\//, '').replace(/\/$/, '').replace(/\\(.)/g, '$1');
    return rel === g || rel.startsWith(g + '/');
  }
  return globToRegExp(glob).test(rel);
}

// Gitignore-like list: the last matching pattern wins, "!pattern" un-matches.
export function matchList(patterns = [], rel) {
  let hit = false;
  for (const raw of patterns) {
    if (!raw || typeof raw !== 'string' || raw.startsWith('#')) continue;
    const neg = raw.startsWith('!');
    const pat = neg ? raw.slice(1) : raw;
    if (matchGlob(pat, rel)) hit = !neg;
  }
  return hit;
}

// protected > shared > editable; anything not listed is treated as protected.
export function classify(rel, config) {
  if (rel === null || rel === undefined) return 'outside';
  if (rel === '.' ) return 'protected';
  if (rel === SCRATCH_REL || rel.startsWith(SCRATCH_REL + '/')) return 'scratch';
  if (matchList(GENERATED, rel)) return 'generated';
  if (matchList(ALWAYS_PROTECTED, rel)) return 'protected';
  const z = (config && config.zones) || {};
  if (matchList(z.protected, rel)) return 'protected';
  if (matchList(z.shared, rel)) return 'shared';
  if (matchList(z.editable, rel)) return 'editable';
  return 'unlisted';
}

export const ALLOWED_ZONES = new Set(['editable', 'shared']);

// ---------- config and person ----------

function deepMerge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra ?? base;
  if (base && typeof base === 'object' && extra && typeof extra === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(extra)) out[k] = k in base ? deepMerge(base[k], v) : v;
    return out;
  }
  return extra === undefined ? base : extra;
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function loadConfig(root) {
  const file = path.join(root, CONFIG_REL);
  const raw = readJson(file);
  return { config: deepMerge(DEFAULT_CONFIG, raw || {}), exists: !!raw, file };
}

export function loadPerson(root) {
  const p = readJson(path.join(root, PERSON_REL));
  return p && p.name ? p : null;
}

// SEO mode = this checkout belongs to the SEO editor, or it is on the work branch.
// Developers can switch the guard off for their own sessions with SEO_EDITOR_GUARD=off.
export function seoMode(root, config) {
  if ((process.env.SEO_EDITOR_GUARD || '').toLowerCase() === 'off') return { on: false, why: 'SEO_EDITOR_GUARD=off' };
  const person = loadPerson(root);
  const branch = currentBranch(root);
  if (person) return { on: true, why: 'person', person, branch };
  if (branch && branch === config.branches.work) return { on: true, why: 'branch', person: null, branch };
  return { on: false, why: 'not an SEO checkout', branch };
}

// Keep scratch files and the personal file out of git without touching .gitignore.
export function ensureLocalIgnores(root) {
  const file = gitPath(root, 'info/exclude');
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const want = [`/${SCRATCH_REL}/`, `/${PERSON_REL}`];
  const missing = want.filter((l) => !have.split(/\r?\n/).includes(l));
  if (missing.length) {
    fs.appendFileSync(file, (have && !have.endsWith('\n') ? '\n' : '') + '# seo-dev (local only)\n' + missing.join('\n') + '\n');
  }
}

export function scratchDir(root, ...sub) {
  ensureLocalIgnores(root);
  const d = path.join(root, SCRATCH_REL, ...sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ---------- package manager ----------

export function detectPackageManager(root) {
  const pkg = readJson(path.join(root, 'package.json'), {});
  const field = (pkg.packageManager || '').split('@')[0];
  const has = (f) => fs.existsSync(path.join(root, f));
  const locks = [
    ['pnpm', has('pnpm-lock.yaml') || has('pnpm-workspace.yaml')],
    ['yarn', has('yarn.lock')],
    ['bun', has('bun.lock') || has('bun.lockb')],
    ['npm', has('package-lock.json') || has('npm-shrinkwrap.json')],
  ].filter(([, ok]) => ok).map(([n]) => n);
  const pm = ['pnpm', 'yarn', 'bun', 'npm'].includes(field) ? field : locks[0] || 'npm';
  return { pm, locks, fromField: !!field };
}

export function pmRun(pm, script) {
  if (pm === 'npm') return `npm run ${script}`;
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `pnpm run ${script}`;
}

export function pmExec(pm, bin) {
  if (pm === 'npm') return `npx --no-install ${bin}`;
  if (pm === 'yarn') return `yarn ${bin}`;
  if (pm === 'bun') return `bunx ${bin}`;
  return `pnpm exec ${bin}`;
}

export function pmInstall(pm, root) {
  if (pm === 'pnpm') return 'pnpm install --frozen-lockfile';
  if (pm === 'yarn') return fs.existsSync(path.join(root, '.yarnrc.yml')) ? 'yarn install --immutable' : 'yarn install --frozen-lockfile';
  if (pm === 'bun') return 'bun install --frozen-lockfile';
  return fs.existsSync(path.join(root, 'package-lock.json')) ? 'npm ci' : 'npm install --no-save';
}

// ---------- changes since main ----------

// Net change of this branch (commits + uncommitted + untracked) since it last met main.
export function changesSinceMain(root, config) {
  const { remote, main } = config.branches;
  const baseRef = refExists(root, `${remote}/${main}`) ? `${remote}/${main}` : main;
  const base = gitOut(['merge-base', baseRef, 'HEAD'], root) || gitOut(['rev-parse', 'HEAD'], root);
  const files = new Map();
  const add = (p, status, from) => { if (p) files.set(p, { path: p, status, from: from || null }); };
  const tokens = (gitOut(['diff', '--name-status', '-z', '-M', base], root) ?? '').split('\0');
  for (let i = 0; i < tokens.length; ) {
    const st = tokens[i++];
    if (!st) continue;
    if (st[0] === 'R' || st[0] === 'C') { const from = tokens[i++]; const to = tokens[i++]; add(from, 'D', null); add(to, 'A', from); }
    else add(tokens[i++], st[0], null);
  }
  const untracked = new Set((gitOut(['ls-files', '--others', '--exclude-standard', '-z'], root) ?? '').split('\0').filter(Boolean));
  for (const p of untracked) add(p, 'A', null);
  for (const f of files.values()) {
    f.zone = classify(f.path, config);
    if ((untracked.has(f.path) && matchList(TOOL_FILES, f.path)) || f.path === '.claude/launch.json') f.zone = 'tool';
  }
  return { base, baseRef, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

// Added lines per file since base (untracked files count as fully added).
export function addedLines(root, base, file) {
  const abs = path.join(root, file);
  const tracked = git(['ls-files', '--error-unmatch', file], root).code === 0;
  const inBase = git(['cat-file', '-e', `${base}:${file}`], root).code === 0;
  if (!tracked && !inBase) {
    try { return fs.readFileSync(abs, 'utf8').split(/\r?\n/).map((text, i) => ({ line: i + 1, text })); } catch { return []; }
  }
  const diff = gitOut(['diff', '-U0', '--no-color', base, '--', file], root) ?? '';
  const out = [];
  let ln = 0;
  for (const l of diff.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { ln = Number(h[1]); continue; }
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) { out.push({ line: ln, text: l.slice(1) }); ln++; }
  }
  return out;
}

export function removedLines(root, base, file) {
  const diff = gitOut(['diff', '-U0', '--no-color', base, '--', file], root) ?? '';
  return diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
}

// ---------- preview + reports ----------

// URL of the preview started by serve.mjs (null when none is running).
export function previewUrl(root) {
  const st = readJson(path.join(root, SCRATCH_REL, 'state', 'server.json'));
  if (!st || !st.pid) return null;
  try { process.kill(st.pid, 0); } catch { return null; }
  return st.url;
}

// Does this HTML look like it belongs to another website? (wrong port / another project's server)
export function foreignSite(html, config) {
  if (!config || !config.siteUrl) return null;
  let want; try { want = new URL(config.siteUrl).hostname.replace(/^www\./, ''); } catch { return null; }
  const hosts = [...html.matchAll(/<link[^>]+rel=["']canonical["'][^>]*>|<meta[^>]+property=["']og:url["'][^>]*>/gi)]
    .map((m) => (/(?:href|content)=["']([^"']+)["']/.exec(m[0]) || [])[1]).filter((u) => u && /^https?:\/\//.test(u))
    .map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean);
  const other = hosts.find((h) => h !== want && h !== 'localhost' && h !== '127.0.0.1');
  return other && !hosts.includes(want) ? other : null;
}

// ---------- output ----------

// "--help" on any script prints its header comment (usage) and exits.
if (process.argv.includes('--help') && process.argv[1] && /\.mjs$/.test(process.argv[1])) {
  try {
    const head = fs.readFileSync(process.argv[1], 'utf8').split('\n').slice(1).filter((l, i, a) => l.startsWith('//') && a.slice(0, i).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, ''));
    process.stdout.write(head.join('\n') + '\n');
  } catch { /* ignore */ }
  process.exit(0);
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) { args[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; } else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

export function list(v) {
  if (v === undefined || v === true) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

export function die(msg, code = 1) {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(code);
}

export function emit(obj, human) {
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  else process.stdout.write((human || JSON.stringify(obj, null, 2)) + '\n');
}

export function requireRepo() {
  const root = repoRoot();
  if (!root) die('This folder is not a git project. Open the website project folder and try again.');
  return root;
}
