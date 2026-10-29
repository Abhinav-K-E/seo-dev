# Mapping the project: pages, UI parts and the API layer

The project map is what lets the skill work on any stack: it records where text lives, which parts are
safe to edit, what each page shows and **which data each page can reach**, so "is this data available?"
has a real answer. Build it during setup; refresh it when the logic layer changes.

## 1. Auto-detect

```
node S/analyze.mjs                 # summary + .seo-editor/inventory.json (full detail)
node S/analyze.mjs --route <route> # one page: file, zone, metadata/schema, text keys, data functions -> endpoints -> fields, sections
```

The inventory covers: frameworks and versions, package manager, commands (install, lint, typecheck, test,
build, dev, start, the project's own check scripts), hosting/deploy hints, git hooks, every route (pages,
API handlers, SEO files like sitemaps/robots/OG images), per-page data (functions, endpoints, types) found by
following imports, the data layer (files, exported functions, endpoints, env variable names, specs), data
types with their fields, the UI system (styling, UI kit, icons, fonts, design tokens, breakpoints, component
folders, most-used components, header/footer, schema and metadata helpers), content sources (i18n locales and
message files, markdown/MDX, CMS, content data files, images, robots, sitemaps, redirects), and a proposed
zone split. It is static analysis: treat it as a strong lead and confirm by reading the files.

## 2. Analyse each part properly

For a big site, split the reading (with subagents if available, otherwise one after another):

- **Pages and templates**: group routes into page types (home, landing, blog list/post, product/feature,
  directory/detail templates, tools, legal). For each type: the page file, its main sections, where its
  title/description/schema come from (helper names), where its text lives (translation namespace, CMS,
  inline), and one or two sample URLs (for dynamic routes, take real slugs from the sitemap or list page).
- **UI system**: layout wrappers, container/section pattern, typography scale, colour tokens, spacing, the
  component library (buttons, cards, accordions/FAQ, breadcrumbs, CTAs), header/footer/nav, dark mode,
  breakpoints, icons. Note the 5-10 sections that new pages should be built from.
- **API / data layer**: base clients and where their base URL comes from (env names only, never values),
  each data function pages use, its endpoint and response fields (from types or a sample GET), server vs
  browser fetching, caching/revalidation, CMS queries. Summarise "data available per page type" as plain
  field lists. Note obvious gaps the editor is likely to ask about.
- **SEO plumbing**: metadata helpers and title template, canonical/hreflang helpers, schema helpers, sitemap
  and robots generation, redirects location, `llms.txt`, OG image generation, i18n routing (prefix rules).
- **Run it**: start the preview, open the main page types at 375/768/1280, run `seo_check.mjs` on one URL per
  type. Note existing SEO and UI problems as a baseline list (the editor can fix presentation ones).

## 3. Write `.claude/seo-editor/project-map.md`

Use this template. Keep it factual and short (aim for 150-400 lines); the inventory has the long lists.

```markdown
# Project map: <site name>
Mapped at commit <short sha> on <date>. Refresh when the logic layer changes (see project-analysis.md).

## At a glance
- Stack: <framework + version, router>, <styling>, <UI kit>, <i18n: library, N locales, default>, <CMS>
- Live site: <url>  | Local preview: <command> on port <n> | Sample paths: <list>
- Checks: <lint/typecheck/test/build commands>; pre-commit: <...>; pre-push: <...> (takes ~N min)
- Publishing: <merge to main | pull request>; goes live: <automatic deploy | developer deploys>

## Page types
| Page type | Route / file | Text lives in | Metadata & schema | Data (functions -> fields) | Sample URL |
|---|---|---|---|---|---|

## Where text lives
- Translations: <glob>, namespaces per page type, how keys are named, rule: update all <N> locales
- CMS-managed content: <what>, edited at <where>
- Inline text: <which pages>

## Data available per page type
### <page type>
- From `<function>` (`GET <endpoint>`): <field: meaning>, ...
- Not available (known gaps): <...>

## UI system
- Layout/container pattern: <...>  | Section components to reuse: <...>
- Typography / colours / spacing tokens: <...> | Breakpoints: <...> | Dark mode: <yes/no>
- Header/footer/nav: <files> (shared) | Buttons/cards/FAQ/breadcrumbs: <components>

## SEO plumbing
- Title template / metadata helper: <...> | Canonical/hreflang: <...> | Schema helpers: <...>
- Sitemaps: <how generated, editable or not> | Robots: <...> | Redirects: <where, who changes them>

## Zones (summary of config.json)
- Editable: <...> | Shared (check site-wide): <...> | Protected (developer): <...>

## Baseline issues found during mapping
- <page>: <issue> (<presentation: SEO editor can fix | logic: developer>)

## Contacts
- Backend: <name> | Frontend: <name>
```

## 4. Keep it fresh

At session start the skill compares the map's commit with main: `git diff --stat <mapped sha> <remote>/<main>`
limited to protected paths. If data functions, types or routes changed, re-run `analyze.mjs`, update the
affected sections of the map (editable file), bump the commit/date line, and save it as
`docs(seo-editor): refresh project map`. If the developer changed the zone config, follow the new config.
