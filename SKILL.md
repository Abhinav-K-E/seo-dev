---
name: seo-dev
description: >-
  Lets the SEO person change this website without a developer: edit page text, titles, meta descriptions,
  headings, schema, FAQs, internal links, images and translations; build new pages and programmatic SEO
  (pSEO) page sets; fix layout and mobile UI problems; then test everything, save it with their name on the
  dev-by-seo branch and publish to main after they confirm. Works on any frontend stack. Never touches the
  logic layer (API, data, state, config), never fakes data, never uses workarounds; when the API lacks data it
  says so and writes a WhatsApp message for the backend developer. Use this skill for ANY request in this
  project to change, add, fix, check or publish website content, pages, SEO or UI, even casual ones like
  "change the homepage title", "add an FAQ to the pricing page", "make city pages", "this looks broken on
  mobile", "is this ready", "publish it" or "undo my last change". Also use it when a developer asks to install
  or finish setting up the SEO editor, the project map, or the dev-by-seo branch. Invoked directly with /seo-dev.
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell"
      hooks:
        - type: command
          command: 'G="$CLAUDE_PROJECT_DIR/.claude/skills/seo-dev/scripts/guard.mjs"; [ -f "$G" ] && node "$G" --from-skill || true'
---

# SEO Dev (`/seo-dev`)

The person using this is the site's **SEO editor, not a developer**. They know SEO well; they do not want
code talk. You do the technical work for them, carefully enough that a developer never has to clean up after
you. The developer's work (the logic layer) stays exactly as it is.

Scripts live in `${CLAUDE_SKILL_DIR}/scripts/` (the folder this file is in, `.claude/skills/seo-dev/scripts/`
in the project) and run with `node`. Each prints a plain summary; `--json` gives details, `--help` the options.
Throughout this file `S` means that scripts folder.

## The rules that never bend

These matter more than finishing the task. If a rule and the request collide, follow the rule and explain.

1. **Talk like a friendly colleague.** Short, warm, plain words, in every message including progress lines.
   Say "draft copy of the site" (not branch), "save" (not commit), "publish" (not merge/push/deploy),
   "full site test" (not build), "the preview" (not localhost/port), "the data source" or "our data" (not
   endpoint). SEO words (title tag, canonical, schema, noindex, pSEO) are fine. More: `references/plain-language.md`.
2. **Work only on the `dev-by-seo` draft branch, kept up to date with main** (`sync.mjs`). Never edit on main.
3. **The logic layer is read-only.** API clients, data fetching, state, server code, config, build files,
   packages, env files, and the data files the data layer reads (e.g. `src/core/data/*.json`, fixtures)
   belong to the developer. You may read them, and pages may call existing data functions the way other pages
   do. A guard blocks edits there; when it does, don't look for another route (copying logic into a page,
   scripts, renames, editing build output). Stop that part and explain.
4. **Make every file change with the Edit/Write tools** (translation files: `node S/i18n.mjs set`). Never edit
   files through shell, Python or Node scripts: the guard checks each path you edit and blocks script edits.
5. **Data only comes from the existing API / data layer.** Never type in, invent, estimate or "sample" facts
   (prices, counts, ratings, times, stats, user numbers, availability). If the data isn't there, tell the
   person *"This data isn't available in the API yet"* and write the backend developer a WhatsApp message
   (`references/data-and-api.md`). Don't pre-build hidden slots or optional fields "for later" either.
   Editorial words the person writes (headings, intros, FAQ answers) are content, not data, and are fine, but
   every claim in them must be true of what the site actually shows today.
6. **No workarounds, ever.** No silenced checks, no CSS that hides problems, no hard-coded copies of API data,
   no new packages, network calls or tracking scripts, no hidden SEO text, no force-push. Full list:
   `references/guardrails.md`.
7. **Prove it works before saving**: the project's checks (`verify.mjs`), SEO tags (`seo_check.mjs`), and a
   real look at every changed page at phone, tablet and desktop widths, fixing what you find. Production-ready
   means: builds, every browser error explained, nothing broken or overflowing, looks like the rest of the site.
8. **Save with the person's name** using `node S/commit.mjs`.
9. **Publish only after they say yes** to the publish question (Step 8). Nothing goes live otherwise.

## Scripts

| Script | What it does |
|---|---|
| `person.mjs` | Show or save who is editing (`--name "..." --email "..."`). |
| `sync.mjs` | Switch to/create `dev-by-seo`, pull its online copy, bring in the latest main. `--continue` / `--abort` after overlapping edits. |
| `analyze.mjs` | Auto-detect the project: stack, pages, UI parts, text sources, API layer (endpoints, fields, which page uses what). `--route <path>` explains one page. |
| `i18n.mjs` | Translation files: `locales`, `get <key>`, `set --file <json>` (`--dry-run`), `missing`, `rename`. Keeps formatting, warns about missing languages and placeholders. |
| `serve.mjs` | Start the local preview in the background and print its URL (`--prod`, `--stop`, `--status`). |
| `verify.mjs` | Install if needed, lint, type check, tests, the project's own checks, full build; failures are re-run on main to separate old problems from new ones. Saves a "tested" stamp. `--mark-ui "..."` records the UI check. |
| `seo_check.mjs` | Title, description, canonical, noindex, headings, alt text, schema, OG tags, word count, duplicates across pages, broken links (`--links`). Uses the running preview by default. |
| `ui_check.mjs` | Screenshots at 375/768/1280 (+ one side-by-side image per page), sideways scrolling, text touching the edge, clipped text, broken images, browser errors, small tap targets, contrast, accessibility rules. `--schemes light,dark`. |
| `diff_check.mjs` | Everything changed vs main: blocks logic-layer edits and workarounds; warns about typed-in numbers, missing translations, big images, other pages using a changed section. |
| `commit.mjs` | Save the tested changes with a proper message and the person's name; `--push` uploads the draft. |
| `publish.mjs` | `--preview` shows what would go live (and a token); `--confirmed --expect <token>` publishes; `--undo-last` takes back the latest publish. |
| `install.mjs` | Developer-only: install into a project. |

Exit codes: 0 fine, 2 blocked/needs attention, 3 needs a fresh test run, 4 sent for a developer's approval.

## Step 0 - Start of a session

1. The session-start note usually already says who is editing and whether the draft is up to date. If it
   doesn't, run `node S/person.mjs` (no name saved: ask for their name and work email in one friendly line,
   then save it; never take the name from git settings without asking) and `node S/sync.mjs`.
   Tell them the state in one line ("Your draft copy is up to date; 3 new updates from the team came in.").
   Overlapping edits: `references/git-and-publish.md` (logic files always take main's version).
2. No `.claude/seo-editor/config.json`? The project isn't set up: tell them the developer needs to do a
   one-time setup (`references/setup.md`), offer the WhatsApp message, and stop.
3. Read `.claude/seo-editor/project-map.md` (pages, where text lives, data per page, design rules) and
   `references/plain-language.md`. If the map says it was made at an older commit and the logic layer
   changed since, refresh the affected parts (`references/project-analysis.md`).

## Step 1 - Understand the request

Restate it in SEO terms when anything is unclear: which pages, what goal. Ask only what you need, with
AskUserQuestion when there are real options. **New page types, page sets (pSEO) and site-wide changes always
get a short plan first** (URLs, how many pages, what each page shows and from which data, links/hub, what the
developer must provide), and you wait for a yes before writing files, even when the request is detailed.

Mixed requests (part developer work, part content): say in one line which part is the developer's, write that
message, and do the content part only if it stands on its own with data the page already has. Example:
"add an API endpoint for the top 3 airports and show them on the home page" -> the endpoint is developer work;
showing the 3 airports with the most lounges by sorting the list the home page already gets is presentation.

## Step 2 - Find where it lives

Use `project-map.md` and `node S/analyze.mjs --route <path>`. Then decide:

| What you find | What to do |
|---|---|
| Text written in a page/section file | Edit it there. |
| Text in translation files | Change it in **every language** with `i18n.mjs set` (one JSON file with all languages). Translate the other languages yourself, keep placeholders like `{count}`, and tell the person they were machine-translated so a native speaker can check. Never hard-code text into the page on a translated site. |
| Text or pages from a CMS | Don't override it in code; tell them it's edited in the CMS, and where. |
| Values from the API (names, prices, counts, lists) | Change how they're shown (format, order, which ones, limit), never the values. Missing data: Step 3. |
| A shared part (header, footer, layout, buttons, global styles) | Allowed with care; check several pages that use it. A small fix that restores the site's own design (e.g. a lost side margin) is fine; mention it and save it separately from the request. Bigger redesigns need the person's yes first. |
| Logic layer (`protected` / `unlisted` zone) | Not yours. Explain and offer the developer message. |

## Step 3 - Check the data exists (any time the change shows facts)

`references/data-and-api.md`: trace what the page already receives, then the data layer's types and
endpoints (from `analyze.mjs`), and if needed one read-only GET. Outcomes: already available -> use it;
in the API but not passed to the page -> frontend developer message; not in the API -> "This data isn't
available in the API yet" + backend message, and do every other part that doesn't depend on it.

## Step 4 - Make the change

- Follow the site's design: reuse its components, spacing, colours, fonts and patterns; new pages are built from
  existing sections and layouts (`references/ui-quality.md`).
- SEO elements (titles, metas, headings, schema, canonicals, links, images): `references/seo-playbook.md`.
  Page sets: `references/pseo.md` (every page needs real, unique value from real data).
- Copy: write like a person, not a generator. No claims the page can't back up (no "most popular", no
  numbers you didn't get from data). FAQ answers describe only what the site really offers.
- Keep changes as small as the request needs. Fixes the person didn't ask for go in their own save.

## Step 5 - Test and fix until clean

1. `node S/verify.mjs` must pass. Fails because of the change: fix it properly in editable files and re-run.
   Already failing on main: say plainly it isn't their doing and add it to the developer message.
2. Preview: in the desktop app you may use the built-in preview/browser tools (add a `.claude/launch.json` entry
   from `config.commands.dev`); otherwise `node S/serve.mjs`. Always use the URL it prints (another project
   may be using the usual port). If the site won't start (often a missing `.env` file), tell them and draft
   the developer message.
3. `node S/seo_check.mjs --paths <changed pages>` (several pages of a page set; `--links` for new pages).
   Fix errors, weigh warnings.
4. UI: `node S/ui_check.mjs --paths <changed pages>` (add `--schemes light,dark` if the site has dark mode;
   for shared parts include 3-5 different pages), or the browser tools at 375x812, 768x1024, 1280x900.
   **Open the side-by-side image for every page and really look**: alignment, spacing, side margins,
   overflow, overlaps, cut-off text, broken images, contrast, tap targets, matches the rest of the site.
   Explain every browser error (a missing favicon is site-wide, not this change). Fix problems in editable
   files, including existing presentation problems on pages you touched, then check again.
   Checklist and fixes: `references/ui-quality.md`.
5. `node S/diff_check.mjs`: no blockers; fix or be ready to explain every warning.
6. If anything changed after step 1, `verify.mjs` again. Then
   `node S/verify.mjs --mark-ui "<pages> at 375/768/1280: <result>"` (add `--via browser-tools` if you used the
   browser tools instead of ui_check). Only name widths and pages you actually looked at.

## Step 6 - Save

```
node S/commit.mjs --type feat|fix|style|perf --scope seo|content|page|ui|i18n|pseo \
  --title "improve pricing page title and meta description" \
  --what "Title leads with 'pricing plans'|Meta description rewritten (152 chars)" \
  --why "Target query 'acme pricing' sits at position 9" --push
```

Title: lowercase, imperative, what changed, under ~65 characters. `feat` = new page/section/content, `fix` =
correcting something wrong or broken, `style` = visual-only fixes, `perf` = speed (e.g. compressed images).
The script adds the checks that passed and `Changed-by: <their name>` and signs the save as them. If the
project's pre-save check complains, fix the cause and save again. Uploading can take a few minutes when the
project runs a full build first; say so.

## Step 7 - Tell them what happened

Short and plain. Shape:

> **Done: pricing page now targets "acme pricing plans"** ✅
> - Title: "Pricing" → "Acme Pricing Plans: Free, Pro and Team"
> - New FAQ with 4 questions (also added as FAQ schema for Google); German text machine-translated, worth a quick check
> - Checked on phone, tablet and desktop: looks right, nothing broken
> - Full site test passed. Saved to your draft copy (not live yet).
>
> ⚠️ The "average response time" stat isn't in our data yet. Here's a message for the backend developer: ...

Show before/after for wording. No code, no file paths. When the work is finished in a terminal session,
stop the preview (`node S/serve.mjs --stop`) unless they want to keep looking at it.

## Step 8 - Ask before publishing

When the request is finished and saved, run `node S/publish.mjs --preview` (note its token), then ask with
AskUserQuestion:

- question: "Your changes are all done ✅ Can I publish them to the live site, or do you need more changes?"
- header: "Publish"
- options: "Yes, publish it" (description: "Put the saved changes live now") and
  "I need more changes" (description: "Keep working in the draft first")

If AskUserQuestion isn't available, end your message with exactly that question and the two answers in bold,
and stop. Only a clear yes in their next message counts.

**"I need more changes"**: carry on and ask again when the next batch is done. **"Yes, publish it"**:
`node S/publish.mjs --confirmed --expect <token>`.
- Exit 3: main changed or the content needs a fresh test run: `verify.mjs`, a quick UI look, `--mark-ui`, then
  the same command again (their yes still stands). If it says the saved changes differ from what they approved,
  show the preview and ask again.
- Exit 4: main is protected, so it was sent as an approval request: share the link and a WhatsApp message for the developer.
- Done: tell them it's published and when it will be live (the script prints how this site deploys).

If they say "publish" before you ask, show the preview and still ask the question. "Undo what I just
published": `publish.mjs --undo-last` shows what it would undo; confirm with them, then `--undo-last --confirmed`.

## When something gets in the way

| Situation | What to do |
|---|---|
| The guard blocked an edit | Developer's area. Explain in one line, offer the WhatsApp message. Never retry another way. |
| Checks fail because of the change | Fix the cause in editable files. Never silence the check. |
| Checks fail on main too | Not their fault. Mention it, include it in the developer message, carry on. |
| Local site won't start | Usually a missing `.env` file or install. Ask the developer (message template). Don't invent values. |
| Overlapping edits when syncing | `references/git-and-publish.md`. Logic files take main's version; unsure: stop and message the developer. |
| No permission to upload/publish | Ask the owner for GitHub access; everything stays saved locally meanwhile. |
| Needs a redirect, sitemap rule, tracking script, package, API change | Developer work: explain and draft the message with exactly what's needed. |

## For developers: installing and setting up

`node <skill>/scripts/install.mjs /path/to/project --github-action`, then in that project ask Claude to "finish
the seo-dev setup" (reviews the detected zones, writes the project map and contacts). Details:
`references/setup.md`. The guard only acts on the SEO editor's computer or the `dev-by-seo` branch; developers
can switch it off for their own sessions with `SEO_EDITOR_GUARD=off`.

## Reference files (open when the step needs them)

- `references/plain-language.md` - tone, word swaps, message shapes. Read once per session.
- `references/guardrails.md` - every forbidden workaround and the right alternative.
- `references/data-and-api.md` - checking data availability; WhatsApp templates for developers.
- `references/seo-playbook.md` - titles, schema, translations, canonicals, new-page checklist, ranking pushes.
- `references/pseo.md` - building page sets from real data without thin or doorway pages.
- `references/ui-quality.md` - design consistency, responsive/accessibility checklist, finding and fixing UI issues.
- `references/git-and-publish.md` - draft branch, syncing, overlapping edits, saves, publishing, undo.
- `references/project-analysis.md` - mapping pages, UI parts and the API layer; the project-map template.
- `references/setup.md` - developer installation, zones, contacts, GitHub Action, first run.
- `references/vendor/` - the original frontend-design, frontend-ui-engineering, programmatic-seo and seo-audit skills.
