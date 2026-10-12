# Demo data and starting content — an app that opens full, not empty

Two kinds of rows, never mixed up:

- **Starting content** — what the user gives or asks for as the real site's first content ("six real articles", "our
  8 products", "a welcome thread", the texts of a brief or document): a **migration**, so it is on the published site
  from the first publish (below, "Starting content").
- **Demo data** — made-up rows so the preview can be tried (sample people, test posts): **dev only**, `scripts/seed.ts`.

In your answer, say which is which: "the six articles go live with your first publish"; "the sample members are only
in the preview".

A feed, a shop, a directory, a chat or a dashboard with no rows looks broken and cannot be tried. When the pages you
build would open empty, put realistic sample rows **with images** into the dev database in the same prompt. One
script, one run, no extra checks.

## When

- **Yes:** content the app shows to everyone or to a new user (posts, products, listings, profiles, recipes, events,
  reviews, messages between sample people), on a project whose `TOTALUM_ENV` is `dev`.
- **No:** a one-page or static app, a form whose rows only the owner sees (their own invoices, bookings), content the
  user gave or asked for as the site's own (starting content: a migration, below), or `TOTALUM_ENV=live` (no dev
  database: every row would be production data — skip seeding and say so in one sentence).
- **Publish never copies it:** the live database gets your migrations, not these rows, so real visitors never meet
  made-up people. Seed live only when the user asks for it in words ("put the demo posts on the live site"), through
  `database.md` §5. Real starting content is not demo data: it is a migration (below).

## How: `scripts/seed.ts`, run once with `npx tsx scripts/seed.ts`

```ts
import { db } from '@/db';
import { posts, users } from '@/db/schema';

if (process.env.TOTALUM_ENV !== 'dev') throw new Error('seed: dev database only');

const now = Date.now();
const ago = (hours: number) => new Date(now - hours * 3_600_000);
const people = [
  { id: 'seed-u1', name: 'Maya Lin', email: 'maya.lin@example.com', image: 'https://i.pravatar.cc/200?img=47' },
  { id: 'seed-u2', name: 'Diego Ramos', email: 'diego.ramos@example.com', image: 'https://i.pravatar.cc/200?img=12' },
  // … 6–10 people, varied names; img=1…70 (each number is a different face)
];

await db.batch([
  db.insert(users).values(people.map((p) => ({ ...p, emailVerified: true, createdAt: ago(900), updatedAt: ago(900) })))
    .onConflictDoNothing(),
  db.insert(posts).values([
    { id: 'seed-p1', userId: 'seed-u1', body: 'Sunday hike above the fog line.', imageUrl: 'https://picsum.photos/seed/hike/1200/800', createdAt: ago(2) },
    // … 15–30 rows per main table, spread over the last days
  ]).onConflictDoNothing(),
]);
console.log('seeded');
```

- **Fixed ids** (`seed-…`) and `onConflictDoNothing()`: running it again changes nothing, and it never updates or
  deletes a row. Never delete rows to re-seed.
- One `db.batch` (≤ 100 parameters a statement: split big `values([...])` into several inserts in the same batch).
- Sample people are content authors only: `@example.com` addresses, no `accounts` row, so nobody can sign in as
  them. Keep the real sign-up working for the user.
- Make it look alive for a brand-new user: public items they see signed out or right after sign-up, relations
  filled in (likes, comments, followers, a few chat threads between sample people), timestamps from minutes to days
  ago, short natural copy in the user's language — never lorem ipsum or "Test post 1".

## Starting content: a migration, inserted once

The user's own starting content must be on the live site after the first publish: write it as a data migration, not
a seed. `npm run db:generate -- --custom --name starter_content` makes an empty `drizzle/NNNN_starter_content.sql`
(after the migration that creates the tables); fill it, then `npm run db:migrate` (dev shows it at once):

```sql
INSERT INTO articles (id, slug, title, excerpt, body, cover_url, status, published_at, created_at, updated_at)
VALUES ('starter-a1', 'jura-guide', 'Le Jura, guide du vignoble', 'Un vignoble à part…', 'Le Jura est…
(the whole text, every '' doubled)', 'https://…', 'published', 1759564800000, 1759564800000, 1759564800000)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO articles (id, slug, title, excerpt, body, cover_url, status, published_at, created_at, updated_at)
VALUES ('starter-a2', …) ON CONFLICT DO NOTHING;
```

- **Fixed ids** (`starter-…`) and `ON CONFLICT DO NOTHING`, one `INSERT` per row, `--> statement-breakpoint` between
  them: publish applies the file once to live; a row that already exists is never overwritten. Never `INSERT OR
  REPLACE`, `DO UPDATE`, `UPDATE` or `DELETE` here; never edit this file once applied — more starting content is a new
  migration.
- The columns' stored form: a `timestamp_ms` column takes epoch milliseconds, a boolean `0`/`1`, text in single quotes
  with every `'` doubled. Each statement under 100 KB (D1).
- An author column: prefer the name as text. A row that must point at a user gets one content-only author in the same
  file (`'starter-editor'`, an `@example.com` address, no `accounts` row: nobody can sign in as it).
- Images: the user's files or verified URLs (below). Not also in `scripts/seed.ts`.

## Images (free, no key, no credits)

| For | URL | Notes |
|---|---|---|
| Photos (posts, products, covers, stories, listings) | `https://picsum.photos/seed/<word>/<w>/<h>` | Unsplash photos (Unsplash License: free, commercial use, no attribution). The same `<word>` always gives the same photo; use a different word per row. |
| Faces (avatars) | `https://i.pravatar.cc/<size>?img=<1–70>` | CC0 placeholders; each number is a different person. |

Photos are random, not on topic: fine for a feed, stories or covers. Where the picture must show the thing (a
bakery's cakes, the cars of a listing, a landing's hero), use the user's images or real photos by subject
(`design.md` §2), or generate a few with `totalum.ai.image.generate` (`resolution: '1K'` or `'512'`, once, from
`scripts/<name>.ts`; it is stored as a project file, and it costs credits, so never per row or per page view). Render with a plain `<img … loading="lazy">` and a fixed aspect (`aspect-[4/3]
object-cover`), never `next/image`.

**Verify every image URL before you use it**, in the same Bash call that runs the seed or before you write the page:

```bash
for u in "https://picsum.photos/seed/hike/1200/800" "https://i.pravatar.cc/200?img=47"; do
  curl -sL -o /dev/null -m 10 -w "%{http_code} %{content_type} $u\n" "$u"
done
```

Keep only URLs answering `200 image/…`; replace any other before seeding. Never an invented or unchecked URL.
