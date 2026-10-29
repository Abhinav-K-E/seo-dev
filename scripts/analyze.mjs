#!/usr/bin/env node
// Auto-detects the project and builds an inventory of its frontend and data (API) layer.
//   node analyze.mjs                    print a summary, save .seo-editor/inventory.json
//   node analyze.mjs --write-config     also create .claude/seo-editor/config.json if it does not exist
//   node analyze.mjs --update-config    refresh detected fields (commands, stack, i18n, deploy) but keep zones/contacts
//   node analyze.mjs --route /airports/[code]   show what one route renders and which data it can reach
//   --json for the full inventory on stdout
import fs from 'node:fs';
import path from 'node:path';
import {
  requireRepo, loadConfig, readJson, writeJson, gitOut, scratchDir, detectPackageManager, pmRun, pmExec, pmInstall,
  DEFAULT_CONFIG, CONFIG_REL, parseArgs, emit, classify, refExists,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = requireRepo();
const MAX_READ = 400 * 1024;

// ---------- files ----------
const allFiles = (gitOut(['ls-files', '-co', '--exclude-standard', '-z'], root) ?? '').split('\0').filter(Boolean)
  .filter((f) => !/(^|\/)(node_modules|\.next|\.nuxt|\.output|\.astro|\.svelte-kit|dist|build|out|coverage|\.open-next|\.wrangler|\.vercel|\.turbo|\.seo-editor)\//.test(f) && !/^\.(claude|github|husky|vscode|idea|codex|cursor)\//.test(f));
const fileSet = new Set(allFiles);
const textCache = new Map();
function read(f) {
  if (textCache.has(f)) return textCache.get(f);
  let t = '';
  try { const st = fs.statSync(path.join(root, f)); if (st.size <= MAX_READ) t = fs.readFileSync(path.join(root, f), 'utf8'); } catch { /* unreadable */ }
  textCache.set(f, t);
  return t;
}
const has = (f) => fileSet.has(f) || fs.existsSync(path.join(root, f));
const firstExisting = (...c) => c.find(has) || null;
const SRC_EXT = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro)$/;
const UI_EXT = /\.(tsx|jsx|vue|svelte|astro|html|njk|liquid|hbs|ejs|erb|twig|php)$/;
const sources = allFiles.filter((f) => SRC_EXT.test(f) && !/\.d\.ts$/.test(f));

// ---------- stack ----------
const pkg = readJson(path.join(root, 'package.json'), null);
const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies } : {};
const dep = (n) => (deps[n] ? String(deps[n]) : null);
const anyDep = (re) => Object.keys(deps).filter((d) => re.test(d));
const { pm, locks } = detectPackageManager(root);
const scripts = (pkg && pkg.scripts) || {};

function detectFramework() {
  const fw = [];
  if (dep('next')) {
    const appDir = firstExisting('src/app', 'app');
    const pagesDir = firstExisting('src/pages', 'pages');
    fw.push({ name: 'next', version: dep('next'), router: [appDir && hasAny(appDir, /\/page\.(tsx|jsx|ts|js|mdx)$/) && 'app', pagesDir && 'pages'].filter(Boolean).join('+') || 'unknown', appDir, pagesDir });
  }
  if (dep('nuxt')) fw.push({ name: 'nuxt', version: dep('nuxt'), pagesDir: firstExisting('app/pages', 'pages', 'src/pages') });
  if (dep('astro')) fw.push({ name: 'astro', version: dep('astro'), pagesDir: firstExisting('src/pages') });
  if (dep('@sveltejs/kit')) fw.push({ name: 'sveltekit', version: dep('@sveltejs/kit'), pagesDir: firstExisting('src/routes') });
  if (dep('@remix-run/react') || dep('@react-router/dev')) fw.push({ name: dep('@react-router/dev') ? 'react-router' : 'remix', version: dep('@react-router/dev') || dep('@remix-run/react'), pagesDir: firstExisting('app/routes', 'src/routes') });
  if (dep('gatsby')) fw.push({ name: 'gatsby', version: dep('gatsby'), pagesDir: firstExisting('src/pages') });
  if (dep('@angular/core')) fw.push({ name: 'angular', version: dep('@angular/core') });
  if (dep('@docusaurus/core')) fw.push({ name: 'docusaurus', version: dep('@docusaurus/core'), pagesDir: firstExisting('src/pages') });
  if (dep('vitepress')) fw.push({ name: 'vitepress', version: dep('vitepress') });
  if (dep('@11ty/eleventy')) fw.push({ name: 'eleventy', version: dep('@11ty/eleventy') });
  if (!fw.length && dep('vite')) fw.push({ name: dep('vue') ? 'vite-vue' : dep('svelte') ? 'vite-svelte' : 'vite-react', version: dep('vite'), spa: true });
  if (!fw.length && dep('react-scripts')) fw.push({ name: 'create-react-app', version: dep('react-scripts'), spa: true });
  if (has('hugo.toml') || has('hugo.yaml') || (has('config.toml') && has('layouts'))) fw.push({ name: 'hugo', pagesDir: 'content' });
  if (has('_config.yml') && (has('_layouts') || has('_posts'))) fw.push({ name: 'jekyll' });
  if (!fw.length && allFiles.some((f) => /\.html$/.test(f))) fw.push({ name: 'static-html' });
  return fw;
}
function hasAny(dir, re) { return allFiles.some((f) => f.startsWith(dir + '/') && re.test(f)); }
const frameworks = detectFramework();
const primary = frameworks[0] || { name: 'unknown' };

const styling = [
  dep('tailwindcss') && `tailwind ${dep('tailwindcss')}`,
  allFiles.some((f) => /\.module\.(css|scss)$/.test(f)) && 'css-modules',
  dep('sass') && 'sass', dep('styled-components') && 'styled-components', dep('@emotion/react') && 'emotion',
  dep('@vanilla-extract/css') && 'vanilla-extract', dep('unocss') && 'unocss',
].filter(Boolean);
const uiKits = [
  has('components.json') && 'shadcn/ui', anyDep(/^@radix-ui\//).length && 'radix', dep('@mui/material') && 'mui', dep('@chakra-ui/react') && 'chakra',
  dep('@mantine/core') && 'mantine', dep('antd') && 'antd', dep('@headlessui/react') && 'headless-ui', dep('vuetify') && 'vuetify', dep('@nuxt/ui') && 'nuxt-ui',
  dep('framer-motion') && 'framer-motion', dep('motion') && 'motion', dep('gsap') && 'gsap',
].filter(Boolean);
const icons = ['lucide-react', 'lucide-vue-next', '@heroicons/react', '@hugeicons/react', 'react-icons', '@phosphor-icons/react', '@tabler/icons-react', '@iconify/react'].filter(dep);
const i18nLibs = ['next-intl', 'next-i18next', 'react-i18next', 'i18next', '@nuxtjs/i18n', 'vue-i18n', 'astro-i18next', '@inlang/paraglide-js', 'svelte-i18n', '@lingui/core', 'rosetta'].filter(dep);
const CMS = {
  sanity: /^(@sanity\/|next-sanity|sanity$)/, contentful: /^(contentful|@contentful\/)/, storyblok: /^@storyblok\//, prismic: /^@prismicio\//,
  strapi: /^@strapi\//, builder: /^@builder\.io\//, payload: /^(payload|@payloadcms\/)/, tina: /^(tinacms|@tinacms\/)/, directus: /^@directus\//,
  datocms: /datocms/, hygraph: /graphcms|hygraph/, wordpress: /wpgraphql|@wordpress\//, ghost: /@tryghost\//, notion: /^@notionhq\//, keystatic: /keystatic/, decap: /decap-cms|netlify-cms/,
};
const cms = Object.entries(CMS).filter(([, re]) => anyDep(re).length).map(([n]) => n);
const hosting = [
  allFiles.some((f) => /(^|\/)wrangler\.(toml|json|jsonc)$/.test(f)) && 'cloudflare', has('vercel.json') && 'vercel', has('netlify.toml') && 'netlify',
  has('firebase.json') && 'firebase', allFiles.some((f) => /(^|\/)Dockerfile/.test(f)) && 'docker', dep('@opennextjs/cloudflare') && 'opennext-cloudflare',
  has('amplify.yml') && 'aws-amplify', has('app.yaml') && 'google-app-engine', has('fly.toml') && 'fly',
].filter(Boolean);

// ---------- commands ----------
function commands() {
  const pick = (...n) => n.find((k) => scripts[k] && !/no test specified/.test(scripts[k]));
  const c = { install: pkg ? pmInstall(pm, root) : null };
  const lint = pick('lint'); c.lint = lint ? pmRun(pm, lint) : null;
  const tc = pick('typecheck', 'type-check', 'types', 'check-types', 'tsc', 'check:types');
  c.typecheck = tc ? pmRun(pm, tc) : dep('typescript') && has('tsconfig.json')
    ? (dep('vue-tsc') ? pmExec(pm, 'vue-tsc --noEmit') : dep('svelte-check') ? pmExec(pm, 'svelte-check') : dep('@astrojs/check') ? pmExec(pm, 'astro check') : pmExec(pm, 'tsc --noEmit -p tsconfig.json'))
    : null;
  const test = pick('test:ci', 'test:unit', 'test'); c.test = test ? pmRun(pm, test) : null;
  const build = pick('build'); c.build = build ? pmRun(pm, build) : primary.name === 'hugo' ? 'hugo --minify' : primary.name === 'jekyll' ? 'bundle exec jekyll build' : null;
  const dev = pick('dev', 'develop', 'start:dev', 'serve', 'start'); c.dev = dev ? pmRun(pm, dev) : primary.name === 'hugo' ? 'hugo server' : null;
  const start = pick('start', 'preview', 'serve'); c.start = start && start !== dev ? pmRun(pm, start) : null;
  c.extraChecks = Object.keys(scripts).filter((k) => /^(check|seo|validate|verify|audit|test:seo|lint:)[:-]?/i.test(k) && k !== lint && k !== tc && !/fix|write|watch/i.test(k))
    .map((k) => ({ name: k, cmd: pmRun(pm, k), required: false, note: scripts[k].slice(0, 120) }));
  return c;
}
function devPort() {
  const s = (scripts.dev || scripts.develop || '') + ' ';
  const m = /(?:-p|--port)[ =](\d{2,5})/.exec(s) || /PORT=(\d{2,5})/.exec(s);
  if (m) return Number(m[1]);
  return { next: 3000, nuxt: 3000, astro: 4321, sveltekit: 5173, remix: 5173, 'react-router': 5173, gatsby: 8000, angular: 4200, hugo: 1313, jekyll: 4000, eleventy: 8080, 'vite-react': 5173, 'vite-vue': 5173, 'vite-svelte': 5173, 'create-react-app': 3000, docusaurus: 3000 }[primary.name] || 3000;
}

// ---------- import graph ----------
function tsconfigPaths() {
  const out = [];
  for (const f of ['tsconfig.json', 'jsconfig.json', 'tsconfig.base.json']) {
    if (!has(f)) continue;
    const raw = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');
    let j; try { j = JSON.parse(raw); } catch { continue; }
    const co = j.compilerOptions || {};
    const baseUrl = co.baseUrl || '.';
    for (const [k, v] of Object.entries(co.paths || {})) out.push({ prefix: k.replace(/\*$/, ''), targets: v.map((t) => path.posix.join(baseUrl, t.replace(/\*$/, ''))) });
  }
  if (!out.length) out.push({ prefix: '@/', targets: [has('src') ? 'src/' : ''] }, { prefix: '~/', targets: [has('src') ? 'src/' : ''] });
  if (primary.name === 'nuxt') out.push({ prefix: '~/', targets: [has('app') ? 'app/' : ''] }, { prefix: '@/', targets: [has('app') ? 'app/' : ''] });
  if (primary.name === 'sveltekit') out.push({ prefix: '$lib/', targets: ['src/lib/'] });
  return out;
}
const aliases = tsconfigPaths();
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte', '.astro', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
function resolveImport(from, spec) {
  let bases = [];
  if (spec.startsWith('.')) bases = [path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))];
  else for (const a of aliases) if (spec.startsWith(a.prefix)) bases.push(...a.targets.map((t) => path.posix.normalize(path.posix.join(t, spec.slice(a.prefix.length)))));
  for (const b of bases) for (const e of EXTS) if (fileSet.has(b + e)) return b + e;
  return null;
}
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const graph = new Map(); // file -> [{to, names}]
const importedBy = new Map();
for (const f of sources) {
  const t = read(f);
  const edges = [];
  for (const m of t.matchAll(IMPORT_RE)) {
    const spec = m[2] || m[3] || m[4];
    if (!spec) continue;
    if (/^import\s+type\b/.test(m[0])) continue;
    const to = resolveImport(f, spec);
    if (!to) continue;
    const names = (m[1] || '').replace(/[{}]/g, ' ').split(',').map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim()).filter((s) => s && s !== '*' && !/\s/.test(s));
    edges.push({ to, names });
    if (!importedBy.has(to)) importedBy.set(to, new Set());
    importedBy.get(to).add(f);
  }
  graph.set(f, edges);
}

// ---------- data / API layer ----------
const DATA_DIR = /(^|\/)(api|apis|services?|servers?|store|stores|state|redux|slices|reducers|hooks|composables|lib|libs|utils?|helpers|core|config|configs|constants|types|typings|models|schemas?|providers?|contexts?|middlewares?|auth|actions|queries|mutations|graphql|gql|db|database|prisma|drizzle|migrations|workers?|scripts|tests?|__tests__|mocks|fixtures|cms|i18n|theme|analytics|tracking|plugins|sdk|clients)\//;
const NET_RE = /\b(fetch|axios|ky|got|ofetch|\$fetch|useFetch|useAsyncData|useSWR|useQuery|useInfiniteQuery|useMutation|createApi|fetchBaseQuery|GraphQLClient|ApolloClient|useLazyQuery|createClient|sanityFetch|request)\s*(\.\w+)?\s*(<[^>]*>)?\s*\(|\b(apiClient|httpClient|http|api|client|instance)\.(get|post|put|patch|delete|request|query|fetch)\s*(<[^>]*>)?\s*\(|gql`|groq`/;
const NOT_APP = /^(scripts|tests?|e2e|cypress|playwright|extension|extensions|tools|bin|docs?|examples?|\.storybook|stories|workers?|migrations|supabase|prisma)\//;
function isDataFile(f) {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(f) || NOT_APP.test(f) || /\.(test|spec|stories)\./.test(f)) return false;
  const t = read(f);
  return DATA_DIR.test(f) && NET_RE.test(t) || /(^|\/)(app|pages)\/api\//.test(f) || /(^|\/)server\/api\//.test(f) || /\+(page|layout)\.server\.(ts|js)$|\+server\.(ts|js)$/.test(f) ||
    (/['"]use server['"]/.test(t.slice(0, 200)));
}
// Seed with files that make requests, then add data-layer files that wrap them, read bundled data
// (JSON, D1/KV bindings, file reads) or run on the server, so wrapper helpers like getX() count too.
const dataFileSet = new Set(sources.filter(isDataFile));
const LOCAL_DATA = /from\s+['"][^'"]+\.json['"]|\breadFile(Sync)?\(|getCloudflareContext|\benv\.(DB|KV|R2)\b|\.prepare\(\s*[`'"]SELECT|createClient\(|getCollection\(|getEntry\(|queryContent\(|useStaticQuery|graphql`/;
const I18N_FILE = /(^|\/)(i18n|locales?|lang|translations?|dictionaries)\//;
const onlyMessages = (f) => { const js = [...read(f).matchAll(/from\s+['"]([^'"]+\.json)['"]/g)].map((m) => m[1]); return js.length > 0 && js.every((x) => /messages|locales?|lang|translations?|dictionar/i.test(x)); };
for (const f of sources) if (!NOT_APP.test(f) && !I18N_FILE.test(f) && (DATA_DIR.test(f) || /\.server\.(ts|js)$/.test(f)) && /\.(ts|tsx|js|jsx|mjs)$/.test(f) && LOCAL_DATA.test(read(f)) && !onlyMessages(f)) dataFileSet.add(f);
for (let round = 0; round < 4; round++) {
  let grew = false;
  for (const f of sources) {
    if (dataFileSet.has(f) || NOT_APP.test(f) || !(DATA_DIR.test(f) || /\.server\.(ts|js)$/.test(f)) || !/\.(ts|tsx|js|jsx|mjs)$/.test(f)) continue;
    if ((graph.get(f) || []).some((e) => dataFileSet.has(e.to))) { dataFileSet.add(f); grew = true; }
  }
  if (!grew) break;
}
const dataFiles = [...dataFileSet];

function endpointsIn(text) {
  const eps = [];
  const re = /([`'"])((?:\$\{[^}`]+\})?(?:https?:\/\/[^\s`'"]*?)?\/(?:[A-Za-z0-9_\-.~:@]+|\$\{[^}`]+\})(?:\/(?:[A-Za-z0-9_\-.~:@]*|\$\{[^}`]+\}))*(?:\?[^`'"]*)?)\1/g;
  for (const m of text.matchAll(re)) {
    let p = m[2];
    if (/\.(png|jpe?g|svg|webp|gif|ico|css|js|woff2?|ttf|mp4|pdf)(\?|$)/i.test(p)) continue;
    if (/^\/\//.test(p) || /^\/(?:_next|static|images?|img|assets|fonts?|icons?)\//.test(p)) continue;
    p = p.replace(/^\$\{[^}]+\}/, '').replace(/\$\{[^}]+\}/g, ':param').replace(/^https?:\/\/[^/]+/, (h) => `${h}`);
    if (p.length < 3 || p.split('/').length < 2) continue;
    const before = text.slice(Math.max(0, m.index - 120), m.index);
    const target = /\b(fetch|axios|ky|got|request|ofetch|\$fetch|useFetch|useAsyncData|useSWR|useQuery|sanityFetch|(apiClient|httpClient|http|api|client|instance|axios|ky)\.(get|post|put|patch|delete|request|head))\s*(<[^>]*>)?\s*\(\s*$/.test(before)
      || /\b(url|endpoint|path|route|baseURL|baseUrl|api[A-Z]\w*|\w*(Url|URL|Endpoint|Path))\s*[:=]\s*$/.test(before) || /^\/?api\//.test(p) || /\$\{[^}]*(API|BASE|HOST|URL)[^}]*\}/i.test(m[2]);
    if (!target) continue;
    const ctx = text.slice(Math.max(0, m.index - 160), m.index + m[0].length + 160);
    const method = /\.(post)\s*[<(]|method\s*:\s*['"]POST/i.test(ctx) ? 'POST' : /\.(put)\s*[<(]|method\s*:\s*['"]PUT/i.test(ctx) ? 'PUT'
      : /\.(patch)\s*[<(]|method\s*:\s*['"]PATCH/i.test(ctx) ? 'PATCH' : /\.(delete)\s*[<(]|method\s*:\s*['"]DELETE/i.test(ctx) ? 'DELETE' : 'GET';
    eps.push({ path: p.split('?')[0], method, at: m.index });
  }
  return eps;
}
function exportsIn(text) {
  const out = [];
  const res = [
    /export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{=]+))?/g,
    /export\s+const\s+(\w+)\s*(?::\s*[^=]+)?=\s*(?:cache\(|unstable_cache\(|memoize\()?\s*(?:async\s*)?(?:\(([^)]*)\)|\w+)\s*(?::\s*([^=]+?))?\s*=>/g,
    /^\s+(?:public\s+|static\s+)*async\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\{/gm,
  ];
  for (const re of res) for (const m of text.matchAll(re)) out.push({ name: m[1], params: (m[2] || '').replace(/\s+/g, ' ').trim().slice(0, 120), returns: (m[3] || '').trim().slice(0, 120), at: m.index });
  return out.sort((a, b) => a.at - b.at);
}
function typesIn(text) {
  const types = {};
  const re = /(?:export\s+)?(?:interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+[^{]+)?\s*\{|type\s+(\w+)(?:<[^>]*>)?\s*=\s*\{|const\s+(\w+)\s*=\s*z\.object\(\s*\{)/g;
  for (const m of text.matchAll(re)) {
    const name = m[1] || m[2] || m[3];
    let i = m.index + m[0].length, depth = 1, start = i;
    while (i < text.length && depth) { const c = text[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
    const body = text.slice(start, i - 1);
    const fields = [];
    let d = 0, tok = '';
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      if (c === '{' || c === '(' || c === '[' || c === '<') d++;
      else if (c === '}' || c === ')' || c === ']' || c === '>') d--;
      if (d === 0) {
        tok += c;
        if (c === ';' || c === ',' || c === '\n') {
          const fm = /^\s*(?:readonly\s+)?['"]?([A-Za-z_$][\w$-]*)['"]?(\??)\s*:\s*([^;,\n]*)/.exec(tok);
          if (fm) fields.push(`${fm[1]}${fm[2]}: ${fm[3].trim().slice(0, 60)}`);
          tok = '';
        }
      } else tok += c;
    }
    const last = /^\s*(?:readonly\s+)?['"]?([A-Za-z_$][\w$-]*)['"]?(\??)\s*:\s*(.*)$/s.exec(tok);
    if (last && last[3].trim()) fields.push(`${last[1]}${last[2]}: ${last[3].trim().replace(/\s+/g, ' ').slice(0, 60)}`);
    if (fields.length) types[name] = fields.slice(0, 80);
  }
  return types;
}

const allTypes = {}; // name -> {file, fields}
for (const f of sources.filter((f) => /\.(ts|tsx)$/.test(f) && (DATA_DIR.test(f) || /types?\.ts$/.test(f)))) {
  for (const [n, fields] of Object.entries(typesIn(read(f)))) if (!allTypes[n] || allTypes[n].fields.length < fields.length) allTypes[n] = { file: f, fields };
}

const api = [];
for (const f of dataFiles) {
  const t = read(f);
  const exps = exportsIn(t);
  const eps = endpointsIn(t);
  const fns = exps.map((e, i) => {
    const end = i + 1 < exps.length ? exps[i + 1].at : t.length;
    const mine = eps.filter((x) => x.at >= e.at && x.at < end).map(({ path: p, method }) => `${method} ${p}`);
    const typeNames = [...(e.returns || '').matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1]).filter((n) => !['Promise', 'Array', 'Record', 'Partial', 'Pick', 'Omit', 'Readonly', 'Response', 'NextResponse'].includes(n));
    return { name: e.name, params: e.params, returns: e.returns, endpoints: [...new Set(mine)], types: typeNames.filter((n) => allTypes[n]).map((n) => ({ name: n, file: allTypes[n].file, fields: allTypes[n].fields })) };
  });
  const envVars = [...new Set([...t.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
  const fileEps = [...new Set(eps.map((x) => `${x.method} ${x.path}`))];
  api.push({ file: f, kind: /(^|\/)(app|pages)\/api\/|server\/api\/|\+server\./.test(f) ? 'site-endpoint' : /['"]use server['"]/.test(t.slice(0, 200)) ? 'server-action' : 'client', functions: fns.filter((x) => x.endpoints.length || x.types.length || /^(get|fetch|load|list|find|search|query|use)[A-Z]/.test(x.name)).slice(0, 60), endpoints: fileEps.slice(0, 80), envVars });
}
const apiByFile = new Map(api.map((a) => [a.file, a]));
const deepMemo = new Map();
function deepEndpoints(f, seen = new Set()) {
  if (deepMemo.has(f)) return deepMemo.get(f);
  if (seen.has(f)) return [];
  seen.add(f);
  const own = (apiByFile.get(f) || { endpoints: [] }).endpoints;
  const up = (graph.get(f) || []).filter((e) => dataFileSet.has(e.to)).flatMap((e) => deepEndpoints(e.to, seen));
  const all = [...new Set([...own, ...up])].slice(0, 40);
  deepMemo.set(f, all);
  return all;
}
for (const a of api) { const d = deepEndpoints(a.file).filter((x) => !a.endpoints.includes(x)); if (d.length) a.viaWrappers = d.slice(0, 20); }
const specs = allFiles.filter((f) => /(openapi|swagger)[^/]*\.(json|ya?ml)$|\.graphql$|\.gql$|schema\.graphql/i.test(f)).slice(0, 20).map((f) => {
  const t = read(f);
  let paths = [];
  if (/\.json$/.test(f)) { try { paths = Object.keys(JSON.parse(t).paths || {}); } catch { /* ignore */ } }
  else if (/\.ya?ml$/.test(f)) paths = [...t.matchAll(/^ {2}(\/[^\s:]*):\s*$/gm)].map((m) => m[1]);
  else paths = [...t.matchAll(/^\s*type\s+(\w+)/gm)].map((m) => `type ${m[1]}`);
  return { file: f, entries: paths.slice(0, 200) };
});
const envExample = firstExisting('.env.example', '.env.sample', '.env.template', '.dev.vars.example');
const envKeys = envExample ? [...read(envExample).matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]) : [];
const envFilesPresent = allFiles.filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/example|sample|template/.test(f)).concat(
  fs.readdirSync(root).filter((f) => /^\.env(\.[\w-]+)?$|^\.dev\.vars$/.test(f) && !/example|sample|template/.test(f))).filter((v, i, a) => a.indexOf(v) === i);

// ---------- routes ----------
function routeFromNextApp(f, appDir) {
  const rel = f.slice(appDir.length + 1);
  const dir = path.posix.dirname(rel);
  const segs = dir === '.' ? [] : dir.split('/');
  if (segs.some((s) => s.startsWith('@') || s.startsWith('(.') || s.startsWith('_'))) return null;
  return '/' + segs.filter((s) => !/^\(.*\)$/.test(s)).join('/');
}
function routes() {
  const out = [];
  for (const fw of frameworks) {
    if (fw.name === 'next' && fw.appDir) {
      for (const f of allFiles.filter((x) => x.startsWith(fw.appDir + '/'))) {
        const base = path.posix.basename(f);
        let kind = null;
        if (/^page\.(tsx|jsx|ts|js|mdx|md)$/.test(base)) kind = 'page';
        else if (/^route\.(ts|js)$/.test(base)) kind = /sitemap|robots|llms|feed|rss|manifest|og/i.test(f) ? 'seo-file' : 'handler';
        else if (/^(sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.(tsx|ts|js|jsx|xml|txt|png|jpg)$/.test(base)) kind = 'seo-file';
        else if (/^layout\.(tsx|jsx|ts|js)$/.test(base)) kind = 'layout';
        else if (/^not-found\.(tsx|jsx)$/.test(base)) kind = 'not-found';
        if (!kind) continue;
        const route = routeFromNextApp(f, fw.appDir);
        if (route === null) continue;
        out.push({ route: kind === 'seo-file' && !/^route\./.test(base) ? `${route === '/' ? '' : route}/${base.replace(/\.\w+$/, '')}` : route, file: f, kind });
      }
    }
    if (fw.name === 'next' && fw.pagesDir) {
      for (const f of allFiles.filter((x) => x.startsWith(fw.pagesDir + '/') && /\.(tsx|jsx|ts|js|mdx|md)$/.test(x))) {
        const rel = f.slice(fw.pagesDir.length + 1).replace(/\.\w+$/, '');
        if (/^_(app|document|error)$/.test(rel)) { out.push({ route: `(${rel})`, file: f, kind: 'layout' }); continue; }
        const isApi = rel.startsWith('api/');
        out.push({ route: '/' + rel.replace(/(^|\/)index$/, '').replace(/^\/$/, ''), file: f, kind: isApi ? 'handler' : 'page' });
      }
    }
    if (['nuxt', 'astro', 'gatsby', 'docusaurus'].includes(fw.name) && fw.pagesDir) {
      for (const f of allFiles.filter((x) => x.startsWith(fw.pagesDir + '/') && /\.(vue|astro|md|mdx|tsx|jsx|ts|js|html)$/.test(x))) {
        const rel = f.slice(fw.pagesDir.length + 1).replace(/\.\w+$/, '');
        const isEndpoint = /\.(ts|js)$/.test(f) && fw.name === 'astro';
        out.push({ route: '/' + rel.replace(/(^|\/)index$/, ''), file: f, kind: isEndpoint ? (/sitemap|robots|rss|feed/.test(f) ? 'seo-file' : 'handler') : 'page' });
      }
    }
    if (fw.name === 'nuxt') for (const f of allFiles.filter((x) => /^(server\/(api|routes)|app\/server\/api)\//.test(x))) out.push({ route: '/' + f.replace(/^(app\/)?server\/(api|routes)\//, (m, a, b) => (b === 'api' ? 'api/' : '')).replace(/\.\w+$/, '').replace(/\/index$/, ''), file: f, kind: 'handler' });
    if (fw.name === 'sveltekit' && fw.pagesDir) {
      for (const f of allFiles.filter((x) => x.startsWith(fw.pagesDir + '/'))) {
        const base = path.posix.basename(f);
        const kind = /^\+page\.svelte$/.test(base) ? 'page' : /^\+layout\.svelte$/.test(base) ? 'layout' : /^\+server\.(ts|js)$/.test(base) ? 'handler' : /^\+(page|layout)(\.server)?\.(ts|js)$/.test(base) ? 'loader' : null;
        if (!kind) continue;
        const dir = path.posix.dirname(f.slice(fw.pagesDir.length + 1));
        out.push({ route: '/' + (dir === '.' ? '' : dir.split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/')), file: f, kind });
      }
    }
    if ((fw.name === 'remix' || fw.name === 'react-router') && fw.pagesDir) {
      for (const f of allFiles.filter((x) => x.startsWith(fw.pagesDir + '/') && /\.(tsx|jsx|ts|js|mdx)$/.test(x))) {
        let rel = f.slice(fw.pagesDir.length + 1).replace(/\/route\.\w+$/, '').replace(/\.\w+$/, '');
        rel = rel.replace(/\./g, '/').replace(/(^|\/)_index$/, '').replace(/\$([\w]+)/g, ':$1').replace(/(^|\/)_[^/]*/g, '');
        out.push({ route: '/' + rel, file: f, kind: /\bloader\b|\baction\b/.test(read(f)) ? 'page+loader' : 'page' });
      }
    }
    if (fw.spa || fw.name === 'angular') {
      for (const f of sources) {
        const t = read(f);
        if (!/createBrowserRouter|<Route\b|RouterModule|createRouter\(|path:\s*['"]\//.test(t)) continue;
        for (const m of t.matchAll(/path\s*[:=]\s*\{?\s*['"]([^'"]+)['"]/g)) out.push({ route: m[1].startsWith('/') ? m[1] : '/' + m[1], file: f, kind: 'page' });
      }
    }
    if (fw.name === 'hugo') for (const f of allFiles.filter((x) => /^content\/.*\.(md|html)$/.test(x))) out.push({ route: '/' + f.replace(/^content\//, '').replace(/(_index|index)?\.(md|html)$/, ''), file: f, kind: 'page' });
    if (fw.name === 'jekyll' || fw.name === 'eleventy' || fw.name === 'static-html') {
      for (const f of allFiles.filter((x) => /\.(md|html|njk|liquid)$/.test(x) && !/^(_layouts|_includes|_site|node_modules|README)/i.test(x))) out.push({ route: '/' + f.replace(/(index)?\.(md|html|njk|liquid)$/, ''), file: f, kind: 'page' });
    }
  }
  const seen = new Set();
  return out.filter((r) => { const k = r.route + '|' + r.file; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.route.localeCompare(b.route));
}
const routeList = routes();

function reach(file, maxDepth = 5, maxFiles = 400) {
  const seen = new Set([file]);
  const q = [[file, 0]];
  const data = new Map();
  const components = new Set();
  while (q.length && seen.size < maxFiles) {
    const [f, d] = q.shift();
    for (const e of graph.get(f) || []) {
      if (dataFileSet.has(e.to) && d <= 2) {
        if (!data.has(e.to)) data.set(e.to, { names: new Set(), depth: d + 1, via: f });
        for (const n of e.names) data.get(e.to).names.add(n);
      }
      if (UI_EXT.test(e.to) && !dataFileSet.has(e.to)) components.add(e.to);
      if (!seen.has(e.to) && d < maxDepth) { seen.add(e.to); q.push([e.to, d + 1]); }
    }
  }
  return { data, components };
}

function pageInfo(r) {
  const t = read(r.file);
  const info = {
    route: r.route, file: r.file, kind: r.kind, zone: classify(r.file, currentZones),
    dynamic: /\[|:\w|\$\w/.test(r.route), localeSegment: /\[(locale|lang|lng)\]/.test(r.route),
    client: /^\s*['"]use client['"]/.test(t),
    metadata: /export\s+(const\s+metadata|async\s+function\s+generateMetadata|function\s+generateMetadata)|useHead\(|useSeoMeta\(|<svelte:head>|<Head>|<title>|\bhead\(\)|definePageMeta|<SEO\b|<Seo\b|NextSeo/.test(t),
    staticParams: /generateStaticParams|getStaticPaths|prerender|entries\(\)/.test(t),
    jsonLd: /ld\+json|JsonLd|jsonLd|schema-dts/.test(t),
    i18n: [...new Set([...t.matchAll(/(?:useTranslations|getTranslations|useTranslation|t)\(\s*['"]([\w.-]+)['"]\s*\)/g)].map((m) => m[1]))].slice(0, 10),
    revalidate: (/export\s+const\s+revalidate\s*=\s*(\w+)/.exec(t) || [])[1] || null,
  };
  const { data, components } = reach(r.file);
  info.data = [...data.entries()].map(([f, hit]) => {
    const entry = api.find((a) => a.file === f);
    const names = hit.names;
    const fns = entry ? entry.functions.filter((fn) => !names.size || names.has(fn.name)) : [];
    const eps = [...new Set(fns.flatMap((x) => x.endpoints))];
    const direct = (eps.length ? eps : names.size ? [] : (entry ? entry.endpoints : []));
    const deep = direct.length ? [] : deepEndpoints(f);
    return { file: f, via: hit.depth === 1 ? 'page' : hit.via, uses: [...names].slice(0, 20), endpoints: direct.slice(0, 20), throughHelpers: deep.slice(0, 12), types: [...new Set(fns.flatMap((x) => x.types.map((ty) => ty.name)))].slice(0, 10) };
  }).filter((d) => d.endpoints.length || d.throughHelpers.length || d.types.length || d.uses.some((n) => /^(get|fetch|load|list|find|search|query|use[A-Z])\w*/.test(n)))
    .sort((a, b) => (a.via === 'page' ? -1 : 0) - (b.via === 'page' ? -1 : 0));
  const own = endpointsIn(t);
  if (own.length && /fetch\(|axios|\$fetch|useFetch/.test(t)) info.data.unshift({ file: r.file, uses: ['(fetches directly in the page)'], endpoints: [...new Set(own.map((x) => `${x.method} ${x.path}`))].slice(0, 20), types: [] });
  info.components = [...components].slice(0, 40);
  return info;
}

// ---------- UI system ----------
function uiSystem() {
  const comps = sources.filter((f) => UI_EXT.test(f) && !routeList.some((r) => r.file === f) && !dataFileSet.has(f));
  const usage = comps.map((f) => ({ file: f, usedBy: importedBy.has(f) ? importedBy.get(f).size : 0 })).sort((a, b) => b.usedBy - a.usedBy);
  const byDir = {};
  for (const c of comps) { const d = path.posix.dirname(c).split('/').slice(0, 3).join('/'); byDir[d] = (byDir[d] || 0) + 1; }
  const cssFiles = allFiles.filter((f) => /\.(css|scss|pcss)$/.test(f) && !/\.module\./.test(f));
  const tokens = [];
  let tailwindV4 = false;
  for (const f of cssFiles) {
    const t = read(f);
    if (/@import\s+['"]tailwindcss['"]|@theme\b/.test(t)) tailwindV4 = true;
    for (const m of t.matchAll(/(--[\w-]+)\s*:\s*([^;]{1,80});/g)) if (tokens.length < 120) tokens.push({ file: f, name: m[1], value: m[2].trim() });
  }
  const tw = firstExisting('tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs');
  const twText = tw ? read(tw) : '';
  const fonts = [...new Set([
    ...sources.flatMap((f) => [...read(f).matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]next\/font\/google['"]/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean))),
    ...cssFiles.flatMap((f) => [...read(f).matchAll(/font-family\s*:\s*['"]?([^;'",]+)/g)].map((m) => m[1].trim())),
    ...allFiles.filter((f) => /\.(css|html|tsx|vue|astro)$/.test(f)).flatMap((f) => [...read(f).matchAll(/fonts\.googleapis\.com\/css2?\?family=([^&"')]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ').split(':')[0])),
  ])].filter((x) => !/^var\(|\$|inherit|^-apple|system-ui|sans-serif|serif|monospace/.test(x)).slice(0, 12);
  const screens = [];
  for (const m of (twText + cssFiles.map(read).join('\n')).matchAll(/(?:--breakpoint-([\w-]+)\s*:\s*([^;]+);|['"]?(sm|md|lg|xl|2xl|3xl)['"]?\s*:\s*['"](\d+px)['"])/g)) screens.push(`${m[1] || m[3]}=${(m[2] || m[4]).trim()}`);
  const named = (re) => comps.filter((f) => re.test(path.posix.basename(f)) || f.split('/').slice(0, -1).some((d) => re.test(d))).filter((f) => !/admin/i.test(f)).slice(0, 8);
  return {
    styling, uiKits, icons, tailwind: dep('tailwindcss') ? (tailwindV4 ? 'v4 (CSS @theme)' : `v3 (${tw || 'config'})`) : null,
    breakpoints: screens.length ? [...new Set(screens)] : dep('tailwindcss') ? ['sm=640px', 'md=768px', 'lg=1024px', 'xl=1280px', '2xl=1536px (Tailwind defaults)'] : [],
    fonts, cssFiles: cssFiles.slice(0, 20), tokens: tokens.slice(0, 80),
    designSystemDirs: Object.keys(byDir).filter((d) => /(^|\/)(ui|components\/ui|primitives|design-system|ds)(\/|$)/.test(d)),
    componentDirs: Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([dir, count]) => ({ dir, count })),
    mostUsed: usage.slice(0, 40),
    header: named(/^(site-?|main-?|global-?)?(header|navbar|nav-?bar|navigation|topbar|top-nav)(\b|$|[A-Z.])/i), footer: named(/^(site-?|main-?|global-?)?footer(\b|$|[A-Z.])/i),
    breadcrumbs: named(/breadcrumb/i), jsonLdHelpers: sources.filter((f) => /json-?ld|schema|structured/i.test(path.posix.basename(f)) || /application\/ld\+json/.test(read(f))).slice(0, 15),
    metadataHelpers: sources.filter((f) => /(seo|metadata|meta|head)\.(ts|tsx|js)$|\/seo\//i.test(f)).slice(0, 15),
  };
}

// ---------- content ----------
function content() {
  const msgFiles = allFiles.filter((f) => /\.json$/.test(f) && /(^|\/)(messages|locales?|lang|i18n|translations?|dictionaries)(\/|$)/i.test(f) && !/package|tsconfig/.test(f));
  const locales = [...new Set(msgFiles.map((f) => { const b = path.posix.basename(f, '.json'); const d = path.posix.basename(path.posix.dirname(f)); return /^[a-z]{2}([-_][A-Za-z]{2,4})?$/.test(b) ? b : /^[a-z]{2}([-_][A-Za-z]{2,4})?$/.test(d) ? d : null; }).filter(Boolean))];
  const msgDirs = [...new Set(msgFiles.map((f) => path.posix.dirname(f).replace(/\/[a-z]{2}([-_][A-Za-z]{2,4})?$/, '')))];
  let defaultLocale = null;
  for (const f of sources.filter((x) => /i18n|routing|middleware|proxy|nuxt\.config|astro\.config|next\.config|config/.test(x)).slice(0, 60)) {
    const m = /defaultLocale\s*[:=]\s*['"]([\w-]+)['"]/.exec(read(f)); if (m) { defaultLocale = m[1]; break; }
  }
  for (const f of ['next.config.js', 'next.config.mjs', 'next.config.ts', 'nuxt.config.ts', 'astro.config.mjs']) if (!defaultLocale && has(f)) { const m = /defaultLocale\s*[:=]\s*['"]([\w-]+)['"]/.exec(read(f)); if (m) defaultLocale = m[1]; }
  const md = allFiles.filter((f) => /\.(md|mdx|markdoc)$/.test(f) && !/(^|\/)(README|CHANGELOG|LICENSE|CLAUDE|AGENTS|CONTRIBUTING)\b|^docs?\/|^\.claude\//i.test(f));
  const mdDirs = [...new Set(md.map((f) => f.split('/').slice(0, 2).join('/')))].slice(0, 15);
  const contentJson = allFiles.filter((f) => /\.(json|ya?ml)$/.test(f) && /(^|\/)(content|data|copy|seo-content)\//.test(f) && !DATA_DIR.test(f.replace(/(^|\/)data\//, '$1x/'))).slice(0, 40);
  const publicDir = firstExisting('public', 'static', 'src/assets', 'assets');
  const images = allFiles.filter((f) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f));
  return {
    i18n: { libs: i18nLibs, locales, defaultLocale: defaultLocale || (locales.includes('en') ? 'en' : locales[0] || null), messageFiles: msgFiles.length, messageDirs: msgDirs, messagesGlob: msgDirs.map((d) => (msgFiles.some((f) => f.startsWith(d + '/') && f.split('/').length > d.split('/').length + 1) ? `${d}/**/*.json` : `${d}/*.json`)) },
    cms, markdownDirs: mdDirs, markdownFiles: md.length, contentDataFiles: contentJson,
    publicDir, images: { count: images.length, legacyFormats: images.filter((f) => /\.(png|jpe?g|gif)$/i.test(f)).length },
    robots: allFiles.filter((f) => /(^|\/)robots\.(txt|ts|js)$/.test(f)), sitemaps: allFiles.filter((f) => /sitemap/i.test(f)).slice(0, 30), llms: allFiles.filter((f) => /llms(-full)?\.txt/.test(f)),
    redirects: allFiles.filter((f) => /redirects?\.(json|ts|js|yml|yaml|csv)$|_redirects$/.test(f)).slice(0, 10),
  };
}

// ---------- zones ----------
function pureData(f) {
  const t = read(f);
  if (!t || t.length > 200000) return false;
  const code = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (/\bimport\s+(?!type\b)/.test(code) || /\b(function|await|async|fetch|process\.env|require\(|new\s+\w|class\s+\w|=>)/.test(code)) return false;
  const strings = (code.match(/(['"`])(?:\\.|(?!\1).){12,}\1/g) || []).length;
  return /export\s+(const|default)/.test(code) && strings >= 3;
}
function proposeZones() {
  const isJs = !!pkg;
  const srcRoots = ['src', 'app', 'pages', 'components', 'lib', 'layouts', 'views', 'templates'].filter(has);
  const protectedZ = [
    '# logic layer: data, API, state, server, config, tooling',
    `**/${'{api,apis,services,service,server,servers,store,stores,state,redux,slices,reducers,hooks,composables,lib,libs,utils,util,helpers,core,config,configs,constants,types,typings,models,schemas,schema,providers,provider,context,contexts,middleware,middlewares,auth,actions,queries,mutations,graphql,gql,db,database,workers,worker,scripts,tests,test,mocks,fixtures,cms,i18n,theme,analytics,tracking,plugins,sdk,clients}'}/**`,
    '**/admin*/**', '**/dashboard/**', '**/checkout/**', '**/billing/**', '**/account/**',
    '**/*{Provider,Providers,Context,Store,Reducer}.{tsx,jsx}', '**/{providers,provider,Provider}.{tsx,jsx}', '**/chunk-recovery.{tsx,jsx}',
    '**/*.server.*', '**/+page.{ts,js}', '**/+layout.{ts,js}', '**/+server.{ts,js}', '**/route.{ts,js}', '**/actions.{ts,js}', '**/loader.{ts,js}',
  ];
  if (isJs) protectedZ.push('**/*.{ts,js,mjs,cjs,mts,cts}');
  if (dep('next-sitemap')) protectedZ.push('public/sitemap*.xml', 'public/robots.txt');
  const content_ = content();
  const exceptions = [];
  const editable = [
    '# pages, page sections and components (presentation only)',
    ...srcRoots.map((d) => `${d}/**/*.{tsx,jsx,vue,svelte,astro,html,mdx,md}`),
    '# styles',
    ...srcRoots.map((d) => `${d}/**/*.{css,scss,sass,less,pcss}`),
    '# content and text',
    'content/**', 'src/content/**/*.{md,mdx,json,yaml,yml}', 'seo-content/**', 'blogs/**/*.{md,mdx}', 'posts/**', '_posts/**', 'data/**/*.{md,yaml,yml}',
    ...content_.i18n.messagesGlob,
    '# images and static files',
    'public/**', 'static/**', 'src/assets/**', 'assets/**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico}',
    '# the project map for this skill and local preview settings',
    '.claude/seo-editor/project-map.md', '.claude/launch.json',
  ];
  if (primary.name === 'hugo') editable.push('layouts/**', 'assets/**', 'i18n/**', 'archetypes/**');
  if (primary.name === 'jekyll') editable.push('_layouts/**', '_includes/**', '_data/**/*.{yml,yaml}', '*.md', '*.html', '_sass/**');
  if (primary.name === 'static-html' || primary.name === 'eleventy') editable.push('**/*.{html,md,njk,liquid,css}');
  for (const glob of content_.i18n.messagesGlob) exceptions.push('!' + glob);
  for (const f of sources.filter((x) => /\.(ts|js)$/.test(x) && !DATA_DIR.test(x) && pureData(x)).slice(0, 150)) { exceptions.push('!' + f); editable.push(f); }
  const shared = [
    '# site-wide parts: allowed, but check several pages after any change',
    '**/app/layout.{tsx,jsx}', '**/app/[locale]/layout.{tsx,jsx}', '**/app/[lang]/layout.{tsx,jsx}', '**/pages/_app.{tsx,jsx,js}', '**/pages/_document.{tsx,jsx,js}',
    'app.vue', 'app/app.vue', '**/layouts/**', 'src/routes/+layout.svelte', '_layouts/**',
    '**/{globals,global,app,main,index,base,tailwind}.{css,scss}', '**/styles/**',
    '**/components/ui/**', '**/ui/primitives/**', '**/ui/layouts/**', '**/design-system/**',
    '**/{Header,Footer,Navbar,NavBar,Nav,Navigation,SiteHeader,SiteFooter,TopBar,Menu,MegaMenu}*.{tsx,jsx,vue,svelte,astro}',
    '**/{header,footer,navbar,nav,navigation,site-header,site-footer}*.{tsx,jsx,vue,svelte,astro}',
    'public/robots.txt', 'static/robots.txt',
  ];
  return { protected: [...protectedZ, ...exceptions], shared, editable: [...new Set(editable)] };
}

// ---------- deploy / git ----------
function deploy() {
  const wf = allFiles.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f));
  const deployWf = wf.filter((f) => { const t = read(f); return /push:[\s\S]{0,200}branches:[\s\S]{0,80}\b(main|master|production)\b/.test(t) && /deploy|wrangler|vercel|netlify|firebase|pages|s3 sync|gh-pages|rsync|ssh/i.test(t); });
  if (deployWf.length) return { auto: true, workflows: deployWf, note: `Deploys automatically when main changes (GitHub Actions: ${deployWf.join(', ')}).` };
  if (has('vercel.json') || dep('vercel') || has('netlify.toml')) return { auto: null, note: 'Hosting on Vercel/Netlify usually deploys automatically from main; confirm with the developer.' };
  if (hosting.includes('cloudflare')) return { auto: null, note: 'Cloudflare hosting: if Workers/Pages Git integration is on, main deploys automatically; otherwise a developer deploys. Confirm with the developer.' };
  return { auto: null, note: 'Deployment method not detected; ask the developer how main goes live.' };
}
function gitInfo(cfg) {
  const remote = cfg.branches.remote;
  const originHead = (gitOut(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], root) || '').replace(`${remote}/`, '') || null;
  const hooks = {};
  for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
    const f = firstExisting(`.husky/${h}`, `.githooks/${h}`);
    if (!f) continue;
    const t = read(f);
    const does = [/lint-staged/.test(t) && 'lint-staged', /\b(eslint|lint)\b/.test(t) && !/lint-staged/.test(t) && 'lint', /\btsc\b|typecheck|type-check/.test(t) && 'type check',
      /\b(test|vitest|jest)\b/.test(t) && 'tests', /\bbuild\b/.test(t) && 'full build (slow)', /commitlint/.test(t) && 'commit message rules', /size/.test(t) && 'size check'].filter(Boolean);
    hooks[h] = does.length ? does.join(' + ') : 'custom script';
  }
  return {
    remoteUrl: gitOut(['remote', 'get-url', remote], root), defaultBranch: originHead,
    mainExists: refExists(root, `refs/remotes/${remote}/${cfg.branches.main}`) || refExists(root, `refs/heads/${cfg.branches.main}`),
    workBranchOnline: refExists(root, `refs/remotes/${remote}/${cfg.branches.work}`),
    hooks, commitlint: allFiles.some((f) => /commitlint|\.commitlintrc/.test(f)) || !!dep('@commitlint/cli'),
    syncWorkflow: allFiles.some((f) => /^\.github\/workflows\/.*sync.*seo/i.test(f)),
  };
}

// ---------- assemble ----------
const loaded = loadConfig(root);
const currentZones = loaded.exists ? loaded.config : { zones: proposeZones() };
const ui = uiSystem();
const cont = content();
const inventory = {
  generatedAt: new Date().toISOString(),
  commit: gitOut(['rev-parse', '--short', 'HEAD'], root),
  project: pkg && pkg.name || path.basename(root),
  stack: { frameworks, packageManager: pm, lockfiles: locks, typescript: !!dep('typescript'), node: (pkg && pkg.engines && pkg.engines.node) || (has('.nvmrc') ? read('.nvmrc').trim() : null), hosting, monorepo: !!(pkg && pkg.workspaces) || has('pnpm-workspace.yaml') && /packages:/.test(read('pnpm-workspace.yaml')) },
  commands: commands(),
  devServer: { port: devPort() },
  routes: routeList.map(pageInfo),
  api: { files: api, specs, envExample, envKeys, envFilesPresent, apiEnvKeys: envKeys.filter((k) => /API|URL|ENDPOINT|HOST|GRAPHQL|CMS|SANITY|CONTENTFUL|STRAPI/.test(k)) },
  types: Object.fromEntries(Object.entries(allTypes).slice(0, 300).map(([k, v]) => [k, v])),
  ui, content: cont, deploy: deploy(), git: gitInfo(loaded.config),
  zonesProposal: proposeZones(),
};
const outFile = path.join(scratchDir(root), 'inventory.json');
writeJson(outFile, inventory);

// ---------- config ----------
function configFromInventory(base) {
  const c = JSON.parse(JSON.stringify(base));
  c.project = c.project || inventory.project;
  c.packageManager = pm;
  c.stack = { framework: primary.name, version: primary.version || null, router: primary.router || null, styling, uiKits, i18n: i18nLibs, cms, hosting };
  const cmds = inventory.commands;
  c.commands = { ...cmds, ...(base.commands || {}) };
  for (const k of ['install', 'lint', 'typecheck', 'test', 'build', 'dev', 'start']) if (base.commands && base.commands[k] === undefined) c.commands[k] = cmds[k];
  c.devServer = { ...inventory.devServer, ...(base.devServer || {}), samplePaths: (base.devServer && base.devServer.samplePaths && base.devServer.samplePaths.length > 1) ? base.devServer.samplePaths : samplePaths() };
  c.content = { ...(base.content || {}), i18nMessages: cont.i18n.messagesGlob, defaultLocale: cont.i18n.defaultLocale, locales: cont.i18n.locales, cms };
  c.deploy = { ...inventory.deploy, ...(base.deploy || {}) };
  if (inventory.git.defaultBranch && inventory.git.defaultBranch !== c.branches.main) c.notes = [...new Set([...(c.notes || []), `The repository's default branch is "${inventory.git.defaultBranch}", but SEO changes publish to "${c.branches.main}". Confirm this with the owner.`])];
  return c;
}
function samplePaths() {
  const pages = inventory.routes.filter((r) => r.kind === 'page' || r.kind === 'page+loader');
  const prefix = pages.some((p) => p.localeSegment) && cont.i18n.defaultLocale ? `/${cont.i18n.defaultLocale}` : '';
  const statics = pages.filter((p) => !p.dynamic || p.localeSegment && !/\[(?!locale|lang|lng)/.test(p.route)).map((p) => p.route.replace(/\/\[(locale|lang|lng)\]/, prefix) || '/');
  return [...new Set(['/', ...statics])].filter((p) => !/admin|dashboard|account|checkout|login|signup|embed/.test(p)).slice(0, 12);
}

let configNote = '';
if (args['write-config'] && !loaded.exists) {
  const cfg = configFromInventory({ ...DEFAULT_CONFIG, zones: proposeZones() });
  writeJson(path.join(root, CONFIG_REL), cfg);
  configNote = `Created ${CONFIG_REL} (review the zones with the developer).`;
} else if (args['update-config'] && loaded.exists) {
  const raw = readJson(path.join(root, CONFIG_REL));
  const cfg = configFromInventory(raw);
  cfg.zones = raw.zones; cfg.contacts = raw.contacts; cfg.branches = raw.branches; cfg.publish = raw.publish;
  writeJson(path.join(root, CONFIG_REL), cfg);
  configNote = `Updated detected fields in ${CONFIG_REL} (zones, contacts, branches and publish mode kept).`;
} else if (args['write-config'] && loaded.exists) configNote = `${CONFIG_REL} already exists; left unchanged (use --update-config to refresh detected fields).`;

// ---------- output ----------
if (args.route) {
  const want = String(args.route);
  const hits = inventory.routes.filter((r) => r.route === want || r.file === want || r.route.includes(want));
  emit(hits, hits.map((r) => [
    `${r.route}  [${r.kind}] ${r.file}  (zone: ${r.zone})`,
    `  metadata: ${r.metadata ? 'yes' : 'no'} | static params: ${r.staticParams ? 'yes' : 'no'} | JSON-LD: ${r.jsonLd ? 'yes' : 'no'} | client component: ${r.client ? 'yes' : 'no'}${r.i18n.length ? ` | text namespaces: ${r.i18n.join(', ')}` : ''}`,
    ...r.data.map((d) => `  data via ${d.file}${d.uses.length ? ` (${d.uses.join(', ')})` : ''}${d.via !== 'page' ? ` - used inside ${d.via}` : ''}\n    endpoints: ${d.endpoints.join(', ') || (d.throughHelpers.length ? 'through helpers: ' + d.throughHelpers.join(', ') : '-')}\n    types: ${d.types.map((t) => `${t} {${(inventory.types[t] || { fields: [] }).fields.slice(0, 25).join('; ')}}`).join(' | ') || '-'}`),
    `  renders: ${r.components.slice(0, 15).join(', ')}`,
  ].join('\n')).join('\n\n') || `No route matches "${want}".`);
  process.exit(0);
}

const pages = inventory.routes.filter((r) => /page/.test(r.kind));
const lines = [
  `Project: ${inventory.project} @ ${inventory.commit}`,
  `Stack: ${frameworks.map((f) => `${f.name}${f.version ? ' ' + f.version : ''}${f.router ? ` (${f.router} router)` : ''}`).join(', ') || 'unknown'} | ${pm}${locks.length > 1 ? ` (lock files: ${locks.join(', ')} - confirm which one is used)` : ''} | ${inventory.stack.typescript ? 'TypeScript' : 'JavaScript'}`,
  `Styling: ${[...styling, ...uiKits].join(', ') || '-'} | icons: ${icons.join(', ') || '-'} | fonts: ${ui.fonts.join(', ') || '-'}`,
  `i18n: ${i18nLibs.join(', ') || 'none'}${cont.i18n.locales.length ? ` | ${cont.i18n.locales.length} locales (default ${cont.i18n.defaultLocale}) in ${cont.i18n.messageDirs.join(', ')}` : ''} | CMS: ${cms.join(', ') || 'none'}`,
  `Hosting: ${hosting.join(', ') || '-'} | Deploy: ${inventory.deploy.note}`,
  `Commands: ${Object.entries(inventory.commands).filter(([k, v]) => v && k !== 'extraChecks').map(([k, v]) => `${k}=\`${v}\``).join(' ')}`,
  inventory.commands.extraChecks.length ? `Project checks found: ${inventory.commands.extraChecks.map((x) => x.name).join(', ')}` : '',
  `Git: default branch ${inventory.git.defaultBranch || '?'} | ${loaded.config.branches.work} online: ${inventory.git.workBranchOnline ? 'yes' : 'no'} | hooks: ${Object.entries(inventory.git.hooks).map(([k, v]) => `${k}: ${v}`).join(' ; ') || 'none'}`,
  `Routes: ${pages.length} pages, ${inventory.routes.filter((r) => r.kind === 'handler').length} API/handlers, ${inventory.routes.filter((r) => r.kind === 'seo-file').length} SEO files (sitemaps/robots/og)`,
  ...pages.slice(0, 60).map((r) => `  ${r.route}${r.data.length ? '  <- ' + r.data.slice(0, 6).map((d) => (d.uses.slice(0, 3).join('/') || path.posix.basename(d.file)) + (d.endpoints.length ? ` [${d.endpoints.slice(0, 2).join(', ')}]` : d.throughHelpers.length ? ` [via helpers: ${d.throughHelpers.slice(0, 2).join(', ')}]` : '')).join(', ') : ''}`),
  pages.length > 60 ? `  ... ${pages.length - 60} more (see inventory.json)` : '',
  `Data layer: ${api.length} files, ${new Set(api.flatMap((a) => a.endpoints)).size} endpoints, ${Object.keys(allTypes).length} data types${specs.length ? `, specs: ${specs.map((s) => s.file).join(', ')}` : ''}`,
  ...api.filter((a) => a.endpoints.length).slice(0, 25).map((a) => `  ${a.file} [${a.kind}]: ${a.endpoints.slice(0, 6).join(', ')}${a.endpoints.length > 6 ? ' ...' : ''}`),
  `Env: example=${envExample || 'none'} | present: ${envFilesPresent.join(', ') || 'NONE (the site may not run locally without them)'}`,
  `UI: design-system dirs ${ui.designSystemDirs.join(', ') || '-'} | header ${ui.header.join(', ') || '-'} | footer ${ui.footer.join(', ') || '-'}`,
  `Most-used components: ${ui.mostUsed.slice(0, 12).map((c) => `${path.posix.basename(c.file)}(${c.usedBy})`).join(', ')}`,
  `SEO files: robots ${cont.robots.join(', ') || '-'} | sitemaps ${cont.sitemaps.length} | llms ${cont.llms.join(', ') || '-'} | redirects ${cont.redirects.join(', ') || '-'}`,
  `Inventory saved: ${path.relative(root, outFile)}`,
  configNote,
].filter(Boolean);
emit(inventory, lines.join('\n'));
