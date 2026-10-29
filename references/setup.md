# Setup (developer, once per project) and first run (SEO editor)

This part is for the developer/owner, so technical language is fine here. The SEO editor never needs it.

## What gets installed

```
<project>/
├── .claude/
│   ├── skills/seo-dev/        the skill (committed, so the SEO editor gets it with the repo)
│   ├── settings.json                  + PreToolUse guard and SessionStart hooks (merged, not overwritten)
│   └── seo-editor/
│       ├── config.json                zones, branches, publish mode, commands, contacts (committed)
│       ├── project-map.md             human-readable map, written by Claude (committed, editable by the skill)
│       └── person.local.json          SEO editor's name/email (local only, git-excluded automatically)
├── .github/workflows/sync-dev-by-seo.yml   optional: keeps dev-by-seo merged with main
└── .seo-editor/                       logs, screenshots, reports, test stamps (local only, git-excluded)
```

Local-only files are excluded through `.git/info/exclude`, so `.gitignore` is not changed.

## Install

```bash
node /path/to/seo-dev/scripts/install.mjs /path/to/project --github-action
```

Options: `--work dev-by-seo` `--main main` `--mode merge|pull-request` `--no-hooks`. The installer copies the
skill, merges hooks, writes the action, and runs `analyze.mjs --write-config` for a first config.

Then open the project in Claude Code and say **"finish the seo-dev setup"**. Claude should:

1. Run `node S/analyze.mjs` and walk through the summary with you.
2. **Review the zones** in `.claude/seo-editor/config.json` with you (see below), especially mixed folders
   (`features/*`), SEO helpers (`core/seo` metadata builders: protected by default), robots/sitemap files,
   redirects data files, and app areas that aren't SEO pages (admin, dashboard, embeds).
3. Confirm `branches.main` (the analyzer warns when the repo's default branch differs, e.g. `dev`), the
   publish mode, `siteUrl`, `devServer.samplePaths`, `commands` (and which `extraChecks` are `required`).
4. Ask for the contacts (`contacts.backend.name`, `contacts.frontend.name`) used in WhatsApp messages.
5. Set `deploy.auto`/`deploy.note` (how main goes live) so the editor is told the truth after publishing.
6. Map the project and write `.claude/seo-editor/project-map.md` (`project-analysis.md`).
7. Commit `.claude/` (+ the workflow) to main, push, and create the draft branch:
   `git push origin main:refs/heads/dev-by-seo`.

In the owner's own session the guard is inactive (no person file, not on the draft branch), so Claude can
edit the config there. Set `SEO_EDITOR_GUARD=off` in your shell if you ever work on `dev-by-seo` yourself.

## Zones (config.json -> zones)

Three gitignore-style lists (globs, `**` any folders, `{a,b}` alternatives, `!` exceptions, `#` comments;
brackets are literal so `app/[locale]/page.tsx` works as written). Precedence:
**always-protected (built in) > protected > shared > editable > anything else (treated as protected).**

- `editable`: pages, page sections and presentational components, styles, content/markdown, translation
  files, public images. New files matching these globs can be created (new pages).
- `shared`: site-wide presentational parts (root layouts, header/footer/nav, design-system primitives,
  global CSS, static robots.txt). Allowed, but the skill checks several pages after changes.
- `protected`: data/API clients, hooks, stores, server code, API routes, auth/admin/account areas, config,
  constants, i18n config code, every `.ts/.js` file by default (React/Vue/Svelte projects keep logic there),
  except pure-content modules the analyzer detects (listed as `!path` exceptions + editable).

Built-in always-protected (cannot be loosened by config): `.claude/` (except `project-map.md`,
`launch.json`, the person file), `.git/`, CI (`.github/` ...), git hooks, `package.json` and lock files,
env files and keys, tsconfig/jsconfig, every `*.config.*`, lint/format configs, hosting configs (wrangler,
vercel, netlify, firebase, Docker), middleware/proxy/instrumentation, `node_modules`, `*.d.ts`, tests,
database/migration folders. Build output (`.next/`, `dist/` ...) is never editable.

Check a decision: `node -e "import('<skill>/scripts/lib.mjs').then(l=>{const {config}=l.loadConfig(process.cwd());console.log(l.classify('src/app/[locale]/page.tsx',config))})"`.

## Other config fields

| Field | Meaning |
|---|---|
| `branches.work` / `main` / `remote` | Draft branch, publish target, remote name |
| `publish.mode` | `merge` (push to main after the editor confirms) or `pull-request` (always ask a developer) |
| `commands.*` | install, lint, typecheck, test, build, dev, start; `extraChecks: [{name, cmd, required}]` |
| `devServer.port`, `devServer.samplePaths` | Local preview port and representative pages for checks |
| `content.i18nMessages`, `defaultLocale`, `locales` | Translation files the skill keeps in sync |
| `deploy.auto`, `deploy.note` | What the editor is told after publishing |
| `contacts.backend` / `frontend` | Names (and optional WhatsApp numbers) for messages |
| `commit.assistantTrailer` | `true` adds `Assisted-by: Claude` to commits (default off) |

## Access the SEO editor needs

- GitHub (or other host) account with read access to the repo and push access to `dev-by-seo`, plus push to
  `main` for `merge` mode (or keep main protected and use `pull-request` mode / automatic PR fallback).
- Git, Node (the project's version), the package manager (pnpm via `corepack enable`), Google Chrome (for
  UI checks), optional `gh` CLI signed in for approval requests.
- The local env file the site needs to run (`.env.local` etc.). The skill never invents env values.
- Claude Code with the project folder trusted (hooks only run after the workspace trust prompt).

## First run for the SEO editor

1. Clone the repo, open it in Claude Code, accept the trust prompt, say hi.
2. The skill asks their name and email once (`person.mjs`), creates/switches to `dev-by-seo`, installs
   dependencies on the first test run, and is ready.
3. From then on every session starts by bringing in the latest main.

## Next.js 16 note

`next dev` writes `AGENTS.md` and `CLAUDE.md` into the project root for AI tools. The skill never saves them and
`serve.mjs --stop` removes the copies it caused, but setting `agentRules: false` in `next.config` (or adding the
two files to `.gitignore`) keeps the editor's folder clean. Use contact names without role suffixes in
`contacts` (the role is already the key).

## Updating the skill later

Re-run `install.mjs` against the project (it replaces the skill folder, keeps config and map), then commit.
