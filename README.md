# seo-dev

A Claude Code skill (`/seo-dev`) that lets a site's **SEO person** change the website without a developer:
page text, titles, meta descriptions, headings, schema, FAQs, internal links, images, translations, new pages,
programmatic SEO page sets and mobile/UI fixes. Claude does the technical work, tests it, saves it under the
SEO person's name and publishes only after they say yes. The developer's logic layer is never touched.

Built for Next.js sites first, with auto-detection for Nuxt, Astro, SvelteKit, Remix/React Router, Gatsby,
Vite SPAs, Hugo, Jekyll and static HTML.

## How it works

- **Draft branch.** All work happens on `dev-by-seo`, which is kept up to date with `main` (at the start of every
  session, before publishing, and by an optional GitHub Action on every push to main).
- **Logic layer stays read-only.** A one-time project map (`.claude/seo-editor/config.json`) splits the project
  into editable (pages, sections, styles, content, translations, images), shared (layouts, header/footer, UI
  primitives) and protected (API, data, state, server code, config, packages, env) zones. A `PreToolUse` hook
  blocks edits to protected files and risky commands on the SEO editor's computer; developers are unaffected.
- **No made-up data.** If a change needs data the API doesn't have, Claude says "This data isn't available in
  the API yet" and writes a ready-to-paste WhatsApp message for the backend developer (fields, endpoint,
  example response, reason).
- **No workarounds.** No silenced checks, no CSS hacks, no hard-coded copies of API data, no new packages or
  network calls, no hidden SEO text. `diff_check.mjs` reviews every change before it is saved or published.
- **Tested before saving.** The project's own lint, type check, tests and full build (failures are compared
  with main so old problems aren't blamed on the editor), an SEO tag check, and a UI check at 375/768/1280 px
  with screenshots and a side-by-side image per page.
- **Saved with their name.** Conventional commit messages (`feat(seo): ...`) with what/why, the checks that
  passed and a `Changed-by:` trailer, authored by the SEO editor.
- **Publish with a button.** "Your changes are all done ✅ Can I publish them to the live site, or do you need
  more changes?" → `Yes, publish it` / `I need more changes`. Protected `main` falls back to a pull request.
- **Plain language.** Claude talks to the SEO editor without developer jargon ("draft copy", "save", "publish").

It folds in four public skills, included unmodified with their licenses under `references/vendor/`:
frontend-design (anthropics/skills), frontend-ui-engineering (addyosmani/agent-skills), programmatic-seo and
seo-audit (coreyhaines31/marketingskills).

## Install

Personal (makes `/seo-dev` available in every project on your computer):

```bash
git clone https://github.com/Abhinav-K-E/seo-dev ~/.claude/skills/seo-dev
```

Into a website project (once, by the developer; the SEO editor then gets the skill and hooks with the repo):

```bash
node ~/.claude/skills/seo-dev/scripts/install.mjs /path/to/project --github-action
```

Then open that project in Claude Code and say "finish the seo-dev setup": Claude reviews the detected zones with
you, writes the project map and contacts. Commit `.claude/` (and the workflow) to main and create the draft
branch (`git push origin main:refs/heads/dev-by-seo`). Details: `references/setup.md`.

Requirements: Node 18+, git 2.27+, Claude Code, Google Chrome (for UI checks; a small driver is installed once
into `~/.cache/seo-dev`), optional `gh` CLI for approval requests.

## Using it

The SEO editor opens the project folder in Claude Code and types `/seo-dev` or just asks:

- "make the airports page rank better for 'airport guide'"
- "add an FAQ to the pricing page"
- "create a lounges page for every airport"
- "the pricing table goes off the screen on my phone"
- "ok, publish it" / "undo what I just published"

## What's inside

```
SKILL.md                 workflow and rules Claude follows
scripts/                 analyze, guard, session_start, sync, verify, serve, seo_check, ui_check,
                         diff_check, i18n, commit, publish, person, install (Node, no dependencies)
references/              plain language, guardrails, data & API (WhatsApp templates), SEO playbook,
                         pSEO, UI quality, git & publish, project analysis, setup, vendor/ originals
assets/                  GitHub Action that keeps dev-by-seo merged with main
evals/                   test cases (claude plugin eval format)
```

## Status and known limitations

Tested end to end on a Next.js test site: in 9 headless sessions acting as the SEO editor, every check passed
(work on the draft branch, logic layer untouched, no invented data, WhatsApp requests, saves signed by the
editor, UI checked, publish only after "Yes, publish it"). An independent review then found gaps that are
**not fixed yet**, so try it on a test copy of a site before handing it to an SEO editor:

- The shell-command part of the guard can be bypassed by unusual commands (git aliases and `-c` options,
  redirects without spaces, command substitution, some PowerShell cmdlets). The save and publish steps still
  refuse logic-layer changes to tracked files, but server-side branch protection on `main` is strongly
  recommended as a backstop.
- The test stamp can treat a run as tested while logic files were changed during it, and "already failing on
  main" is decided per check rather than per error.
- `sync.mjs --continue` stages untracked files into the merge commit.
- The analyzer's zone proposal needs manual review on plain-JS Next.js, SvelteKit (`src/lib`), Vite SPAs
  (`index.html`), Nuxt auto-imports and monorepos (`apps/web`).
- The guard does not fail closed when Node is missing from the hook's PATH; Windows support is untested.
