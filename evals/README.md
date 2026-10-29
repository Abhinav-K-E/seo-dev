# Test cases

These cases expect the **SkyGuide fixture**: a small Next.js site with the skill installed, a project map and
`.claude/seo-editor/person.local.json` for an SEO editor named Asha Rao, a bare remote with `main` and `dev-by-seo`.
Rebuild it from any small Next.js site:
pages `/`, `/airports`, `/airports/[code]`, `/pricing` (with a fixed-width table), data in `src/core/api/airports.ts`
(fields: code, name, city, country, terminals, lounges), translations in `src/messages/{en,de}.json`.

Run with Claude Code from the fixture's folder: `claude plugin eval <path-to-skill> --allow-tools Write,Edit,Bash`.
These are real, billed model runs.
