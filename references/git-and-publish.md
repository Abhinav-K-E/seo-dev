# Draft branch, saving and publishing

Contents: the model · syncing · overlapping edits · saving (commit messages) · publishing · approval mode ·
undo · the GitHub Action · things never to do

## The model

- `main` is what goes live. Developers work on it (or merge into it).
- `dev-by-seo` is the SEO editor's draft copy. All SEO work happens there.
- `dev-by-seo` always contains the latest `main`: the GitHub Action merges main into it on every push, and
  `sync.mjs` does the same at the start of every session and before publishing.
- Rule that makes this safe: **on `dev-by-seo`, logic-layer files are always identical to `main`.** Only
  editable/shared files differ. `diff_check.mjs` and `sync.mjs --continue` enforce it.
- Publishing merges `dev-by-seo` into `main` after the editor confirms.

Names come from `.claude/seo-editor/config.json -> branches` (work, main, remote).

## Syncing

`node S/sync.mjs` switches to the draft branch (creating it from main if needed), pulls the online copy of
the draft (other computer, or the GitHub Action) and merges the latest main. Unsaved edits are carried along
(git autostash). Report the result in one line. Run it:

- at the start of every session (the SessionStart hook usually already did; it never resolves conflicts),
- before a big new piece of work if the session has been open a long time,
- automatically inside `publish.mjs`.

## Overlapping edits (merge conflicts)

`sync.mjs` stops and lists files as `CONFLICT [zone] path`.

1. **Logic-layer files** (`protected`, `unlisted`): always take main's version:
   `git checkout <remote>/<main> -- <file>` (allowed by the guard: it restores a file).
2. **Content files** (`editable`, `shared`): open the file, keep both sides' intent. Usually main changed
   structure/code and the draft changed wording: keep main's code and re-apply the editor's wording. If the
   two sides changed the same sentence differently, ask the editor which wording to keep (AskUserQuestion,
   showing both). Remove every conflict marker (`<<<<<<<`, `=======`, `>>>>>>>`).
3. Translation JSON: merge key by key, keep valid JSON, keep every locale's keys in sync.
   If the person's current request rewrites that same text anyway, finish the merge with main's version, then
   apply the new wording as part of the request, and tell them, e.g. "You and Meera both changed this heading;
   it now says what you asked for today."
4. `node S/sync.mjs --continue`. It refuses if markers remain or a logic file differs from main.
5. Run `verify.mjs` afterwards; the combined result is new content.

If a conflict is in code you don't understand, or both sides changed logic inside a page file, stop:
`node S/sync.mjs --abort`, tell the editor in plain words, and send message 5 from `data-and-api.md`.

## Saving (commit messages)

`commit.mjs` refuses unless: on the draft branch, no merge open, no blockers in `diff_check`, the exact
content passed `verify.mjs`, and the UI check is recorded. It signs the commit with the editor's name (author
and committer) and adds trailers. Message format (Conventional Commits, so commitlint-style hooks pass):

```
<type>(<scope>): <what changed, lowercase, imperative, no full stop>

What changed:
- <plain bullet>
- <plain bullet>

Why:
- <SEO reason: target query, issue fixed, data>

Checked: lint ok, types ok, tests ok, build ok, UI checked
Changed-by: Asha Rao <asha@example.com> (SEO)
```

| type | when | example title |
|---|---|---|
| `feat` | new page, section, content, schema, page set | `feat(pseo): add city pages for 48 coworking locations` |
| `fix` | correcting wrong/broken things (titles, links, layout bugs) | `fix(seo): remove duplicate H1 on blog posts` |
| `style` | visual-only polish | `style(ui): tighten pricing card spacing on mobile` |
| `perf` | speed (image compression, lighter media) | `perf(images): compress hero images to webp` |
| `docs` | the project map | `docs(seo-editor): refresh project map` |

Scopes: `seo`, `content`, `page`, `ui`, `i18n`, `pseo`, `images`, `schema`. One save per logical change;
several small related edits can share one save. If the project's pre-save hook (lint-staged, formatter)
changes files, `commit.mjs` says so: run `verify.mjs` again before publishing.

## Publishing

`publish.mjs --preview` lists the saved changes and files that would go live, unsaved edits, whether the
current content is tested, and a **token** for that set of saved changes. Ask the publish question, then run
`publish.mjs --confirmed --expect <token>` (only after "Yes, publish it"); if anything new was saved since
the preview it refuses, so the person always approves exactly what goes live:

1. fetches; if main moved, merges it into the draft and exits 3 -> re-run `verify.mjs`, quick UI look,
   `--mark-ui`, then `--confirmed` again;
2. re-runs the change review (`diff_check`); refuses on blockers;
3. requires a passing test stamp and a UI check for exactly this content;
4. creates the merge commit `Publish SEO changes from dev-by-seo` (lists every change, `Published-by:`
   trailer) without touching the working folder, and pushes it to main and the draft branch together
   (`--atomic`: both or neither). The project's pre-push hook may run a full build first;
5. if main is protected, it automatically opens (or updates) a pull request instead (exit 4).

After publishing, say how it goes live (`config.deploy.note`, printed by the script), e.g. "deploys
automatically in a few minutes" or "the developer's next deploy puts it live".

## Approval mode

If `config.publish.mode` is `"pull-request"` (or main is protected), publishing pushes the draft and opens a
pull request with `gh` (GitHub CLI, if signed in). Share the link and WhatsApp message 6 for the developer.
If `gh` isn't signed in, the draft is still uploaded: tell the editor, and give the developer the branch name.

## Undo

`publish.mjs --undo-last` checks that the latest commit on main is an SEO publish and shows what it would
undo; after the editor confirms, `--undo-last --confirmed` pushes a revert to main and brings it into the
draft, so the draft matches the live site again. If anything else landed on main after the publish, it
refuses: undoing would touch other people's work, so message the developer instead.

To undo something saved but not yet published: edit the files back (or `git restore --source <commit> -- <file>`
for editable files), test, and save again. Never reset or rewrite history.

## The GitHub Action

`assets/sync-dev-by-seo.yml` (installed as `.github/workflows/sync-dev-by-seo.yml` by `install.mjs
--github-action`) runs on every push to main: creates the draft branch if missing, merges main into it,
pushes; on overlapping edits it opens an issue instead. Pushes made by the action do not trigger other workflows.

## Never

Raw `git commit`/`git push`/`git merge` (the guard blocks them in SEO mode), force-push, `reset --hard`,
rebasing, deleting branches, switching to main, `--no-verify`, `HUSKY=0`, or deploy commands (`wrangler
deploy`, `vercel --prod`, `npm run deploy`). Going live happens only through `publish.mjs` and the site's
own pipeline.
