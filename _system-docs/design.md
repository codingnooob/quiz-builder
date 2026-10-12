# Design — how every page must look

Tailwind CSS 4 classes in the JSX; no component library: write the markup, small and consistent. Never add a UI kit,
a CSS framework or a CSS-in-JS package.
**Every page gets the full treatment** — sign-in, dashboards, lists, admin and error pages too.
Design, not extra features: no search, filters, pages or fields the prompt did not ask for.

## 1. Decide the look before you write

Design for THIS business, as a studio that never ships the same site twice. Decide first: its world (a dealership:
metal, light, the road), 4–6 colours from it (or the user's logo), the type, the ONE memorable thing of the page. A
plan that would fit any other business: change it.

- Tokens in the `@theme` block of `src/app/globals.css`: `--color-brand` (and `--color-accent`), optionally
  `--radius-*`. Use `bg-brand`, `text-brand`, `ring-brand/20` everywhere — never scattered hex codes.
- Fonts: one or two, chosen for this business, never the pair you would use on any site. Load them in
  `src/app/layout.tsx` with `next/font/google`: body `variable: '--font-body'`, headings
  `variable: '--font-heading'` (a face with character: `Fraunces`, `Playfair_Display`, `Space_Grotesk`, `Sora`,
  `Bricolage_Grotesque`…), both `.variable` classes on `<html>`. `globals.css` already maps them to `font-sans` /
  `font-display`: add no `--font-*` line to `@theme` (`npm run check` refuses it).
- These read as generated — avoid them: purple/indigo gradients on white; every section centred; an all-caps label
  above every heading; one rounded card and shadow for everything; a stat card as the hero; emoji icons; grey
  boxes; a drawing where a photo belongs.
- Prefer one dominant colour with a sharp accent, surfaces with depth (a tinted band, a dark section, layered
  cards), a layout that fits the content (full-bleed photo, split hero, bento).
- One neutral scale (`zinc`, `stone` or `slate`). Body `text-zinc-900`, secondary `text-zinc-600`; never light grey
  text on white (WCAG AA). A dark design: `bg-zinc-950 text-zinc-100` on `<body>`.

## 2. Photos — real, on topic, checked by eye

A site for a real-world business (a restaurant, a shop, a dealership, a clinic, a portfolio) without photographs
looks unfinished: the hero, each offer that can be photographed and a showcase get one, at least 4 on a landing.
Software shows its product instead (§5 Hero). In this order:

1. **The user's files and URLs** (listed in the prompt): always first, used for what the user said.
2. **Real photos, free:** `https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=1600&q=75` (Unsplash
   License: free, commercial use). Candidates: ids you know, twice as many as you need. Then **look at it** before
   you use it: download all in one Bash call (`curl -sL -o /tmp/p1.jpg "<url>&w=480"` …) and Read every file in
   one message; keep only photos that show the subject, look professional, carry no other company's logo and suit
   the palette. Only for a subject still short: a WebFetch of `https://unsplash.com/s/photos/<words>` ("list the
   images.unsplash.com/photo-… URLs with their descriptions; skip plus.unsplash.com"), at most 3 a prompt.
3. **Generated**, for what no photo you found shows (the hero first): `totalum.ai.image.generate` from
   `scripts/<name>.ts` (`images-video.md`), photographic prompt, the slot's `aspectRatio`, at most 3 per prompt (it
   costs credits).

Render `<img src alt className="size-full object-cover" loading="lazy">` in a box with a fixed aspect
(`aspect-[4/3]`; the hero `fetchPriority="high"`, no `loading`), `w=1600` hero, `w=800` cards; never `next/image`.
Before you finish, every image URL answers `200 image/…` (the loop of `seed.md`); never an invented or unchecked
URL. Tell the user the photos are stock.

## 3. Layout, spacing, type

- Container `mx-auto max-w-6xl px-4 sm:px-6`; text blocks `max-w-prose`. Sections `py-16 sm:py-24`; gaps `gap-4`/`gap-6`;
  the spacing scale only.
- Mobile first: one column, then `sm:`/`md:`/`lg:` grids. Nothing overflows at 390 px: `break-words`, `min-w-0` in
  flex rows, `max-w-full` images, tables handled as in §5.
- Type: page title `text-4xl sm:text-5xl font-semibold tracking-tight` (landing) or `text-2xl sm:text-3xl` (app
  pages); section title `text-2xl sm:text-3xl`; body `text-base leading-7`; small `text-sm`. One `h1` per page.

## 4. The shell every page shares (already in the project — reuse it)

- **Header and footer live in `src/app/layout.tsx`** (`src/components/site-header.tsx`, `site-footer.tsx`), never
  inside one page: every route — `/login`, `/dashboard`, `/admin/...` — gets them. The name and the links are in
  `src/lib/site.ts` (`nav` for everyone, `appNav` for signed-in users); with `accounts: true` the header shows
  Sign in / Get started or Sign out, and it has a mobile `<details>` menu. Both render nothing while `nav` is empty
  and `accounts` is `false` (a one-page app). Restyle those two files for a new look; never write a second header.
- **App pages** (dashboard, lists, admin, account, detail) use `@/components/ui`: `<AppPage title description
  action>` gives the soft surface, the container and the title row; content goes in `<Card title action>`;
  `<Stat label value hint>`, `<Badge tone>`, `<EmptyState title text action>`, and the class strings
  `button.primary`, `button.secondary`, `input`. `src/app/(accounts)/account/page.tsx` is the example. They read the tokens, so
  change the look in `globals.css`, not per page.

## 5. Pieces you write (patterns, not components)

- **Hero:** open with the most characteristic thing of the business, large. A business with a place, a product or
  a craft (restaurant, dealership, hotel, clinic, shop, studio, portfolio): a real photograph (§2), full-bleed under
  a dark gradient with the text on it, or a split whose photo half runs edge to edge (`min-h-[70vh]`). Software: the
  product itself, a composed card built from real-looking content (names, avatars, numbers; `seed.md`), layered. With it: a headline in `font-display`
  `text-5xl sm:text-6xl tracking-tight` (what, for whom), one sentence, a primary and at most one secondary button.
  Never a flat gradient box standing in for a photo, never an empty box, **Never draw the subject** (a car, a dish,
  a building as an SVG): use a photo; floating badges sit inside the visual and never cover text.
- **Landing / redesign:** restyle freely within the tokens: its own sections and buttons, the fonts of §1.
  At least four sections, each with its own layout: hero; what the business offers (services, brands, the menu,
  the work: 3–6 items, each with a photo when the thing can be photographed, else an inline SVG icon in a
  `size-10 rounded-xl bg-brand/10 text-brand` tile); a showcase (the place or the product in use as a photo split,
  testimonials with avatars, or numbers); contact or location; a closing call-to-action band (`bg-brand text-white`,
  one button). Give the backgrounds a deliberate rhythm (light, a tinted `bg-brand/5` band, one or two dark
  sections) so the page never reads as one grey block — never hard black-and-white stripes on every section. The header and footer read the tokens; `@/components/ui` is for app pages.
- **Logo:** the user's logo file goes in `logo` in `src/lib/site.ts`: the header, the footer and the browser icon
  show it. Look at it first: take the brand colour from it unless the user named colours; keep it on a background
  where it stays visible; a logo that already spells the name: remove the name text beside it (`site-header.tsx`).
  Never redraw it, never invent a mark when the user sent one. No logo sent: the name in `font-display`. The browser
  icon is automatic (the logo, else the name's initials on `--color-brand`): never create a favicon.
- **Signed-out home of an app with accounts** (a social network, a marketplace, a clone): it is the landing above,
  with the product card showing the demo content (`seed.md`) and Sign in / Get started as its buttons — never a bare
  login card on a grey page, even when the original product's home is one. A clone gets its own name and look, never
  the original's brand name or logo. A staff-only app (no public sign-up): its home is a branded sign-in page — the
  logo, the name in `font-display`, one line on what it is, the form beside a brand panel or photo.
- **Location:** the address, hours and a directions link (`https://maps.google.com/?q=<address>`); never an empty
  map box.
- **Buttons:** `button.primary` / `button.secondary` from `@/components/ui` (a landing may style its own); every
  interactive element `transition-colors` and `focus-visible:ring-2 focus-visible:ring-brand/40`.
- **Icons:** small inline SVGs (24×24, `stroke="currentColor"`), or none. No emoji or icon package.
- **Images:** §2. A real-world business gets photos; an app's demo content gets the URLs of `seed.md`.
- **Forms:** in a card; a visible `<label className="text-sm font-medium">` above each field (never placeholder-only),
  `name`, sensible `type`, `required`; inputs `className={input}`; short fields side by side `grid gap-4
  sm:grid-cols-2`; the submit shows a pending state (`useFormStatus`) and disables; errors under the field
  `text-sm text-red-600`; a success message replaces the form.
- **Sign-in / register:** the template's `/login` and `/register` (`src/app/(accounts)/auth-form.tsx`) already follow this and
  the tokens: add fields in the same markup. A restyle keeps it a card with a heading, one line, labels, a full-width
  submit and a link to the other page — on `lg:` optionally a split with a brand panel (the product's promise).
- **Dashboards:** `AppPage` with a greeting or title; `Stat`s in `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`; then
  `grid gap-6 lg:grid-cols-3` with a chart card (`lg:col-span-2`) and a recent-items card. Charts are CSS or SVG, no
  chart package. Bars: a row `flex h-48 gap-2`; per item a column `flex h-full flex-1 flex-col justify-end gap-1`
  holding the bar `rounded-t-md bg-brand` with `style={{ height: `${Math.max(2, pct)}%` }}` (a percentage height
  needs that full-height column, or every bar renders 0 px) and its label `text-center text-xs text-zinc-500`; the
  value in `title`.
- **Lists and tables:** in a `Card` whose `title` shows the count and whose `action` is the main one (filters as pill
  links `?status=…`, the active one `bg-brand text-white`, only when asked). `<table className="w-full text-left
  text-sm">` with a header `bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500`, rows
  `divide-y hover:bg-zinc-50`, cells `py-3`, numbers `text-right tabular-nums`. On a phone (390 px) the
  table shows the main cell plus at most **one short column** (a badge, a number or the row's actions — keep those
  visible): every other column (e-mail, company, dates) is `hidden sm:table-cell` and repeated in the main cell as a
  `break-words text-xs text-zinc-500 sm:hidden` meta line. Cells `px-3 sm:px-4`, the table in an `overflow-x-auto`
  wrapper as a last resort, never as the phone layout. Dates and money formatted (`toLocaleDateString`,
  `Intl.NumberFormat`), never raw ISO strings or ids.
- **Status badges:** `<Badge tone="green">Paid</Badge>` — green done, amber pending, red failed, blue new, gray draft.
- **Empty, loading, error:** an empty list or a first-run dashboard is an `<EmptyState>` in its card with the action
  that adds the first item. Client data shows a skeleton (`animate-pulse rounded bg-zinc-200`); a failed request a
  message and a retry. "Not allowed" / "not found": a styled card with a link back, never a bare line.
- **Detail pages:** a back link, the title with its badges, then `grid gap-6 lg:grid-cols-3`: a `<dl>` of fields
  (`grid grid-cols-1 sm:grid-cols-2`, `dt` `text-sm text-zinc-500`) in a card and a side card with actions.
- **Footer:** `site-footer.tsx` — the business's name, contact and secondary links.
- **Motion:** little: `transition` on what reacts to the pointer, `motion-safe:` for more.

## 6. Content

Real copy in the language the owner writes in, specific to the business: names, prices, hours, addresses. Never lorem ipsum,
"Feature 1" or `#` links; every link goes to a real route or anchor.

## 7. Before you return: review it as the client’s art director

Re-read your page, header and footer once; score each 0–2 as a strict art director (2 = a top studio would ship it
for THIS business):
- hierarchy — the first screen says what the business is; one obvious primary action;
- typography — faces with character, one coherent scale;
- spacing — even rhythm; no dead half-column beside short content;
- colour — the logo's palette, consistent; sections that flow, not hard stripes;
- imagery — a real, specific photo wherever the subject can be photographed: never an empty box, a blank shape or
  a gradient standing in for one;
- responsive — at 390 px one column, nothing overflows, the navigation works;
- polish — every value the owner gave shown as written; buttons, forms, footer finished.

Anything below 2: fix it now, in one pass, then stop. Put the seven scores in your report.
