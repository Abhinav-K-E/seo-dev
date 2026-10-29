# Guardrails: no workarounds

A workaround is anything that makes the request *look* done while skipping the proper path: it passes today
and breaks, misleads or costs the developers later. The owner has forbidden them completely. When the proper
path isn't available to the SEO editor, the correct result is: do what you can properly, explain the rest in
plain words, and hand the developer a precise message (`data-and-api.md`).

The guard hook and `diff_check.mjs` catch many of these automatically, but not all. Treat this list as the
standard even where nothing stops you.

## Code and checks

| Never | Why | Instead |
|---|---|---|
| `--no-verify`, `HUSKY=0`, skipping hooks | The project's checks are the safety net | Fix what the check reports |
| `@ts-ignore`, `@ts-expect-error`, `as any`, `eslint-disable` | Hides a real error | Fix the type/lint error in the editable file, or ask the developer if the cause is in the logic layer |
| Deleting, skipping or loosening tests or lint rules | Removes protection for everyone | Fix the cause |
| Editing build output (`.next/`, `dist/`) or `node_modules` | Lost on the next build; not the real source | Change the source file |
| Adding/updating/removing packages | Changes the project setup | Use what the project has; ask the developer |
| New `fetch`/`axios` calls, API URLs, env variables, server actions | That's the logic layer | Use existing data functions; otherwise developer message |
| Copying a function out of the logic layer into a page to change it | Two versions of the truth | Developer message |
| Editing a protected file through the shell, scripts, renames or moves | Same edit, different door | Stop; developer message |
| Editing any file through Python/Node/shell scripts (even editable ones) | The guard can't see which files change | Edit/Write tools; `i18n.mjs` for translation files |
| Changing `.claude/` settings or the guard | Removes the protection | Never |
| Force-push, rewriting history, deleting branches, pushing to main directly | Can destroy others' work | `commit.mjs`, `publish.mjs` |

## Data and content

| Never | Why | Instead |
|---|---|---|
| Hard-coding values that come from the API | Goes stale silently; hides missing data | Show existing fields or say "not available in the API yet" |
| Fake/sample/placeholder data on real pages ("Lorem", "4.8 ★", "1,000+ users") | Misleads users and Google | Real data or no claim |
| Hidden slots, optional fields or commented-out lines "ready for the numbers later" | Unused code that someone fills by hand | Developer message with the field spec; build it when the data exists |
| Unbacked popularity or superlative claims ("most popular", "trusted by thousands", "#1") | Same as invented numbers | Describe the plan/page by what it actually offers |
| Editing bundled data files the data layer reads (`data/*.json`, fixtures) | They are the API's data | Data request to the backend developer |
| FAQ answers or copy that describe features the site doesn't show | Misleads users; schema then repeats the false claim | Check the page; only describe what's really there |
| Inventing statistics, quotes, reviews, author credentials | Dishonest; E-E-A-T risk | Use real sources; ask the editor for facts |
| Overriding CMS content in code | Editors can no longer change it in the CMS | Edit it in the CMS |
| Hard-coding English text on a translated site | Breaks other languages | Add to every locale's translation file |

## UI

| Never | Why | Instead |
|---|---|---|
| Hiding a broken element (`display:none`, `opacity:0`, off-screen) | Problem still there; may hide content from users | Fix the layout properly |
| `overflow-x: hidden` on body/html to stop sideways scrolling | Masks the element that is too wide | Find the overflowing element and fix its width/wrapping |
| `!important` fights, magic pixel offsets, inline styles | Fragile; breaks the design system | Use the project's classes, tokens and components |
| One-off colours/fonts/spacing not in the design system | Page stops looking like the site | Use existing tokens |
| Fixing only one screen width | Breaks the others | Check 375 / 768 / 1280 after every fix |

## SEO (black-hat counts as a workaround)

| Never | Instead |
|---|---|
| Hidden text or links, keyword stuffing, tiny/same-colour text | Visible, useful copy |
| Doorway pages: near-duplicate pages with a word swapped | Pages with genuinely unique data/value, or one strong page |
| Cloaking (different content for Googlebot) | Same content for everyone |
| Fake reviews/ratings in schema, schema that doesn't match the visible page | Schema only for content that is on the page |
| `noindex`/canonical tricks to "fix" duplicates you created | Don't create the duplicates |
| Deleting/renaming a ranking page without a redirect | Keep the URL; if it must move, ask the developer for a 301 first |

## When the proper path is blocked

1. Finish everything in the request that can be done properly.
2. Tell the editor in one or two plain sentences what couldn't be done and why (no jargon).
3. Give the right WhatsApp message with exactly what the developer needs to do.
4. Don't publish half-features that only make sense with the missing part.
