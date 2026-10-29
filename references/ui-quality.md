# UI quality: looking native, working everywhere

Combines the frontend-design and frontend-ui-engineering skills (`vendor/`) for an editor working inside
an existing site. Contents: the design rule · building new pages and sections · the quality floor ·
the UI check procedure · finding and fixing common problems · a11y checklist

## The design rule for an existing site

The site already has a visual identity. **Consistency beats novelty**: new and changed parts must look like
they were always there. Use the project's components, spacing scale, colour and font tokens, corner radii,
icon set and section patterns (`project-map.md` -> UI system; `analyze.mjs` -> `ui`).

frontend-design's "distinctive, non-generic" guidance applies inside that identity: avoid the generic
AI-page look (identical rounded cards everywhere, gradient washes, ALL-CAPS eyebrows over every heading,
fake "01/02/03" numbering on things that aren't steps, an arrow on every link, fade-in on every section) and
use the site's own vocabulary instead. Only when the editor asks for a genuinely new kind of page with no
existing pattern, make a short design plan in the site's tokens (layout sketch, which components, how it
adapts to phone) and show it before building. Never introduce new fonts, colours or a new UI library.

Copy in UI: plain, specific, active ("See seat maps", not "Submit"); the same name for an action everywhere;
error and empty states say what happened and what to do.

## Building new pages and sections

- Start from the closest existing page of the same kind; reuse its layout, sections and metadata pattern.
- Compose existing components; don't fork a component to tweak it (if a shared component needs a new
  option, that's a careful shared-zone change, or a developer request if it involves logic).
- Keep components small and presentational. Simple UI state (accordion open/closed, tabs) is fine;
  anything that loads, saves or computes data is logic.
- Respect the spacing scale and type hierarchy (one H1, H2 for sections). No arbitrary pixel values,
  inline styles or `!important`.
- Handle real-data variation: long names, missing images, empty lists, very long lists.

## The quality floor (every change)

- Works at **375, 768 and 1280 px** (check 320 and 1440 when layout is tight or wide).
- No sideways scrolling, overlaps, cut-off text or broken images.
- No new errors in the browser console.
- Keyboard: every link/button reachable with Tab, focus visible; icon-only buttons have a label.
- Contrast at least 4.5:1 for body text (3:1 for large text); not colour alone for meaning.
- Images: alt text, sized to avoid layout jump, optimised.
- Dark mode (if the site has it) still readable.
- Respects reduced motion if adding animation (better: don't add animation).

## The UI check procedure

1. Open each changed page (and for shared-zone changes, 3-5 different pages that use the part) in the
   local preview.
2. With browser tools (desktop app built-in browser, Claude in Chrome, Playwright MCP): resize to 375x812,
   768x1024, 1280x900; take a full-page screenshot at each; read console errors; check
   `document.documentElement.scrollWidth > innerWidth` for sideways scroll.
   Or `node S/ui_check.mjs --paths <p1,p2> [--schemes light,dark]`: screenshots in `.seo-editor/screenshots/`,
   one `*-sheet.png` per page with all widths side by side (open these), report in
   `.seo-editor/reports/ui-check.json`. It opens FAQs/accordions and hides framework dev badges first.
3. **Look at the screenshots yourself.** Automated checks miss misalignment, awkward wrapping, crowded
   spacing, inconsistent styles, things that look off-brand. Compare with an existing similar page.
4. Fix, then re-check the widths you fixed and the others (fixes for one width often break another).
5. Record it: `node S/verify.mjs --mark-ui "<pages> at 375/768/1280: no issues"` (or what was fixed).
   If a check is impossible (no browser at all), record `--mark-ui "skipped: <reason>"` and tell the editor
   honestly that the visual check couldn't be done.

## Finding and fixing common problems

| Symptom | Usual cause | Proper fix |
|---|---|---|
| Page scrolls sideways on phone | A fixed width (`w-[600px]`, `min-width`), long unbroken text/URL, wide table/image, negative margins | Use responsive widths (`w-full max-w-…`), `break-words`/`overflow-wrap:anywhere` on long strings, wrap tables in a horizontally scrollable container, `max-w-full h-auto` on images |
| Text cut off | Fixed heights, `overflow:hidden`, `whitespace-nowrap` | Let height grow; allow wrapping; use the site's clamp/ellipsis pattern only where the design intends it |
| Text touches the screen edge on phones | A class with `padding: X 0` (shorthand) on the same element as the container's side padding, so the side gutter is lost | Use `padding-block` / `py-*` for vertical spacing, or nest the section inside the container |
| Items squashed in a row on phone | Flex row without wrap / grid with fixed columns | `flex-wrap`, mobile-first grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) |
| Big empty gaps / uneven spacing | Mixed margin systems, duplicate wrappers | Use the section/container pattern other pages use |
| Overlapping elements | Absolute positioning, negative margins, z-index | Normal flow layout; only keep absolute for decorations |
| Tap targets too small | Tiny icon buttons/links | At least 24px (44px is better) with padding, not by enlarging the icon |
| Image stretched/blurry/jumping | Missing dimensions, wrong `object-fit`, low-res source | Width/height or aspect ratio, `object-cover`, a proper-size source |
| Low contrast | Light grey on white, text over images | Use the design system's text colours; add an overlay token on images |
| Dark mode unreadable | Hard-coded colours | Use theme tokens/classes the rest of the site uses |
| Console error after the change | Wrong prop/markup, missing key, invalid nesting (`<a>` in `<a>`, `<div>` in `<p>`), hydration mismatch (date/random values in render) | Fix the markup; never silence the error |
| Layout differs between server and browser | Content that changes on load | Render the same content on server and client (or ask the developer) |

Tailwind projects: mobile-first classes (`base` = phone, `sm:` ≥640, `md:` ≥768, `lg:` ≥1024, `xl:` ≥1280 unless
the project customises breakpoints, see project map). CSS modules/SCSS: follow the file's existing media
query mixins/variables.

## Accessibility checklist (WCAG 2.1 AA essentials)

From `vendor/frontend-ui-engineering/references/accessibility-checklist.md`:

- [ ] All interactive elements reachable by Tab, in a logical order, focus visible
- [ ] Buttons for actions, links for navigation (no clickable `div`s)
- [ ] Images have alt (or `alt=""` if decorative); icon-only buttons have `aria-label`
- [ ] One H1, headings in order; landmarks (`header`, `nav`, `main`, `footer`) present
- [ ] Form inputs have labels; errors say what's wrong and are tied to the field
- [ ] Contrast ≥ 4.5:1 (normal) / 3:1 (large, UI parts); information not by colour alone
- [ ] `<html lang>` set; page has a descriptive title
- [ ] Touch targets ≥ 24px (44px preferred) on phone
- [ ] No autoplaying media without controls; no flashing
