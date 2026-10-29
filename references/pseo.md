# Programmatic SEO (page sets) on a code-based site

Adapted from the programmatic-seo skill (`vendor/programmatic-seo/`). The playbooks (templates, curation,
comparisons, locations, personas, integrations, glossary, directory, profiles...) are in
`vendor/programmatic-seo/references/playbooks.md`.

## The two hard rules here

1. **Every page in the set is fed by real data the site already has** (API/data layer) plus genuine
   editorial content. If the data that would make each page unique isn't available, the set can't be built
   properly yet: say so and send the backend message. Never fill pages with typed-in, invented or "sample"
   data, and never copy a page and swap one word (doorway pages).
2. **The template is a page file; the data stays in the data layer.** You may create a dynamic route page
   (e.g. `app/[locale]/airports/[code]/page.tsx`) that calls existing data functions the way other dynamic
   pages already do (often including `generateStaticParams`/`getStaticPaths` built from an existing list
   function). You may not add new fetching code, endpoints or data files that imitate the API.

## Process

1. **Pattern and intent.** What repeating query is targeted ("[service] in [city]", "[x] vs [y]",
   "[airline] seat maps")? How many combinations? Is there real demand (Search Console, keyword tools if
   available)? Is a page per combination better than one strong page?
2. **Data audit.** List the fields each page needs. For each: where it comes from (function, endpoint,
   type) and how many items actually have it. Use `analyze.mjs --route` on an existing similar page, and
   `data-and-api.md` to check. Decide: available / needs frontend wiring / not in API.
3. **Plan, then confirm with the editor.** URL pattern (subfolder, matching existing conventions), page
   count, the sections each page has, which parts change per page (data-driven sections, conditional blocks),
   hub page and internal links, indexing rule for thin items (skip or `noindex` items without enough data),
   what the developer must provide. Wait for a go-ahead.
4. **Build the template** from the site's existing sections. Make sections conditional on data (hide a
   section when the item has no data for it; never show empty boxes or zeros). Unique title/description/H1
   per page built from fields. Breadcrumbs and schema via the site's helpers.
5. **Hub and links.** A hub/index page listing the set (or an existing hub updated), links between related
   items (same region/category), and links from relevant existing pages.
6. **Sitemaps.** If the site's sitemap is generated from data/routes, check the new URLs appear. If it
   needs a code change, request it (developer message 3).
7. **Test a sample.** `seo_check.mjs` on at least 5-10 pages across the set (it flags duplicate titles,
   descriptions, canonicals across them), `--links` on the hub, UI check on 2-3 pages with the most and the
   least data. Build must pass: static generation of every page is part of the build.
8. **Launch small.** Prefer publishing the strongest 20-50 pages first when the set is large (if the data
   functions allow limiting), then expand after they index.

## Quality bar per page

- Unique, useful value specific to that item (data, comparisons, insights), not just the name swapped.
- Answers the search intent of its query.
- Title/H1/description unique and specific; no keyword stuffing.
- Reachable from the site (no orphans), in the sitemap, self-canonical, indexable (unless deliberately not).
- Loads fast; content in server HTML.

## Common mistakes

Thin pages from swapped variables; pages for combinations nobody searches; two pages targeting the same
query; stale or empty data; building for Google instead of users; launching thousands of pages at once.
