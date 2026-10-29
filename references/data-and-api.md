# Data and the API

Contents: the rule · how to check if data exists · deciding · WhatsApp messages (backend data, frontend
wiring, env/access, conflicts, approval, already-broken checks) · examples

## The rule

Facts on the site come from the API (or the project's existing data layer: CMS, database bindings, bundled
data files the developers maintain). The SEO editor decides **what is shown and how it reads**; the data
layer decides **what the values are**. So:

- Showing a field the page already receives in a new place or format: fine.
- Writing editorial text (intros, headings, FAQ answers, explanations, comparisons in words): fine. It is
  the editor's content, not data. Keep claims honest; never invent numbers inside prose either.
- Typing values that should come from the API into code or content files (prices, ratings, counts, delays,
  distances, opening hours, stock, dates, rankings, "1,234 routes", "updated daily"): **not allowed**, even
  "just for now". Stale hard-coded facts are wrong facts, and they hide the missing data from the team.
- Calling a new endpoint, adding a fetch, changing an API client, or adding a field mapping: logic-layer work.
- Bundled data files that the data layer reads (`*/data/*.json`, fixtures, mocks, seeds, CMS exports) count as the
  API. Never edit them and never suggest the editor fills them in.
- Sorting, filtering or limiting a list the page already receives, using fields it already has ("show the 3
  airports with the most lounges"), is presentation and fine in the page file. A new data source is not.
- When data is missing, add **no code for it at all**: no hidden or conditional sections, no optional type fields,
  no `?.` lookups for fields that don't exist, no "fill in later" slots. Put the suggested field name and shape in
  the developer message instead, and build the section once the data exists.
- Business numbers nobody has given you (user counts, ratings, "trusted by") are data too. If the editor gives a
  verified figure and says where it comes from, it may go into copy as their content; otherwise don't use it.

## How to check if the data exists

Work from the page outward. Stop at the first step that answers the question.

1. **What does the page get today?** `node S/analyze.mjs --route <route>` lists the data functions the page
   and its sections use, their endpoints and their data types (fields). Open the page file and follow the
   variables that reach the JSX/template: often the field is already in the response but not displayed.
2. **What does the data layer offer?** Read the types/interfaces and API functions listed (and
   `.seo-editor/inventory.json` -> `api.files`, `types`). Look for the field under any reasonable name
   (`avg_delay`, `averageDelayMinutes`, `delayStats`...). Check OpenAPI/GraphQL specs if the inventory lists any.
3. **What does the API actually return?** If types are loose (`any`, generic `Record`), look at a real
   response with a read-only GET against the development/staging API the project already uses (base URL from
   the env file the site uses; never print secrets in chat). The guard only allows read-only requests.
   Opening the running page and inspecting what the browser receives also works.
4. **Is it the same for every page in the set?** For page sets, check several items: a field that is empty
   for most items is "not available" for SEO purposes.

## Deciding

| Finding | Outcome | Who |
|---|---|---|
| Field already reaches the page | Use it. Format it with the site's existing helpers if there are any. | You |
| Field is in the API response, but the page's data code doesn't pass it on | Frontend logic change needed | Frontend developer |
| Field doesn't exist in the API (or is empty for most items) | Data not available | Backend developer |
| Request needs writing to the API (forms, saving, tracking) | Not SEO editing | Developer |

Tell the editor plainly, e.g.: *"This data isn't available in the API yet, so I can't show it without making
it up. I've written a message for the backend developer below. Everything else in your request is done."*
Then do the rest of the request that doesn't depend on the missing data. Don't leave empty placeholders or
"coming soon" blocks on live pages unless the editor explicitly asks for a visible placeholder section with
no fake values, and even then mention it in the summary.

## WhatsApp messages

Write them so they can be pasted straight into WhatsApp. WhatsApp formatting: `*bold*`, `_italic_`,
`~strike~`, `` `inline code` ``, triple backticks for a code block, lines starting with `- ` for lists,
`1. ` for numbered lists, `> ` for quotes. Keep it scannable: a title line, short sections, concrete field
names, an example, why it matters, and who asked. Use the contact names from `config.json -> contacts`.

Show the message inside a fenced block that starts with **four backticks** and the word `text`, so the
editor can copy it with all symbols intact. Offer to copy it to their clipboard (`pbcopy` on Mac, `clip` on
Windows) and only do it when they say yes. Never send it yourself.

### 1. Backend: data not in the API

````text
*🔧 Data request – <Site name>*

Hi <Backend developer name> 👋
I'm working on *<page or page set, e.g. airport pages /airports/[code]>* and need data the API doesn't provide yet.

*What's needed*
- `<field_name>` – <what it is, unit> – e.g. `23` (<unit>)
- `<field_name>` – <what it is> – e.g. `"Terminal 4"`

*Where*
- Add to: `GET <existing endpoint, e.g. /api/v1/airports/{code}>`
  _(or a new endpoint, suggestion: `GET /api/v1/airports/{code}/delays`)_
- Needed for: <how many items, e.g. all ~3,000 airports>
- Freshness: <e.g. updated daily is fine>

*Example response*
```
{
  "code": "JFK",
  "<field_name>": 23,
  "<field_name_2>": "Terminal 4"
}
```

*Why*
<one or two lines in SEO terms, e.g. "These pages are thin today; a unique delay stat per airport gives Google a reason to rank each one (target: 'JFK delays', 'LAX on-time rate')">

*Priority:* <High / Medium / Low>
*Requested by:* <SEO editor name> (SEO)

Once it's live in the API, tell me and I'll add it to the pages 🙏
````

### 2. Frontend developer: data exists but isn't passed to the page

````text
*🧩 Small frontend data change – <Site name>*

Hi <Frontend developer name> 👋
The API already returns `<field>` from `GET <endpoint>`, but <page/route> doesn't receive it.

*Needed*
- Pass `<field>` (and `<field2>`) through `<data function, e.g. getAirport() in src/core/api/airports.ts>`
  so the page can show it
- Type: `<field>: <type>` on `<TypeName>`

*Why*
<SEO reason>

*Requested by:* <name> (SEO). I'll handle the page design once it's there 🙏
````

### 3. Developer: logic-layer change (redirects, sitemap rules, tracking, config, packages)

````text
*🛠️ Change request – <Site name>*

Hi <Developer name> 👋
For SEO I need a change in the developer area:

*What*
- <exact change, e.g. 301 redirect `/old-guide` → `/guides/seat-maps`>
- <second item>

*Why*
<SEO reason, e.g. "the old URL has backlinks and now returns 404">

*Priority:* <High / Medium / Low>
*Requested by:* <name> (SEO)
````

### 4. Developer: local setup / access problems

````text
*🔑 Setup help – <Site name>*

Hi <Developer name> 👋
I can't run the site on my computer yet to check my SEO changes.

*Needed*
- <e.g. the `.env.local` file for local development (the site stops with "Missing NEXT_PUBLIC_API_URL")>
- <e.g. push access to the `dev-by-seo` branch on GitHub for <GitHub username>>

Thanks! 🙏 – <name> (SEO)
````

### 5. Developer: overlapping edits the skill couldn't resolve safely

````text
*⚠️ Draft branch needs a hand – <Site name>*

Hi <Developer name> 👋
Bringing the latest `main` into `dev-by-seo` hit overlapping edits I shouldn't decide alone:
- `<file>` – <what each side changed, in a few words>

Could you merge `main` into `dev-by-seo` and keep both changes? My SEO edits are saved on the branch.
– <name> (SEO)
````

### 6. Developer: please approve a publish (pull-request mode or protected main)

````text
*✅ SEO changes ready for review – <Site name>*

Hi <Developer name> 👋
These SEO changes are tested (lint, types, tests, full build, UI on phone/tablet/desktop) and waiting for your approval:
<link to the pull request>

*What changes*
- <change 1>
- <change 2>

Thanks! 🙏 – <name> (SEO)
````

### 7. Developer: a check was already failing on main

````text
*🐞 Heads-up – <Site name>*

Hi <Developer name> 👋
While testing my SEO changes I noticed `<check, e.g. pnpm lint>` already fails on `main` (not from my changes):
```
<2–6 key lines of the error>
```
My changes are fine and published/saved. Could you take a look when you can? – <name> (SEO)
````

## Examples

- *"Show each airline's on-time percentage on its page."* `analyze.mjs --route /airlines/[slug]` shows the
  page uses `getAirlineBySlug()` returning `Airline {code, name, logo, country}`. No on-time field in the
  type or a sample response -> not available -> message 1 asking for `on_time_pct` on `GET /airlines/{slug}`.
- *"Add the airline's founding year to the about section."* The type has `founded: number` and the page
  receives the object, but only shows `name` -> available -> display it.
- *"Put 'Prices from $49' in the hero."* Prices are data. If the page has `minPrice`, show it formatted;
  otherwise not available (message 1). Never type "$49".
- *"Add an API endpoint for the top 3 airports and list them on the home page."* The endpoint is developer work
  (message 3). Listing the 3 airports with the most lounges by sorting what the home page already gets is
  presentation: do that part and say the endpoint itself was left to the developer.
- *"Write an intro paragraph for each city page."* Editorial content: fine, but it must be genuinely
  specific per city. If the specifics would need data (attractions, stats), see `pseo.md`.
