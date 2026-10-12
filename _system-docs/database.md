# The project database: fast by construction

The database is Cloudflare D1 (SQLite), **multi-region** (`worker.ts`, `totalum-sdk/d1`): a GET reads the copy nearest
the visitor, any other request writes to the one primary, and the browser that just wrote reads the primary for 10
seconds, so users see their own changes.

## 1. Index foreign keys and the columns you filter writes on

Without an index on a foreign key's child side, deleting one parent row scans every child table.

```ts
export const posts = sqliteTable(
  'posts',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text().notNull(),
  },
  (t) => [index('posts_user_id').on(t.userId), index('posts_created_at').on(t.createdAt)],
);
```

- Every `references()` column gets an index whose **first** column it is.
- Every column in the `WHERE` of an `UPDATE` or `DELETE` gets one too.
- `npm run db:migrate` warns `<table>.<column> is a foreign key without an index`: fix it.

## 2. No writes in GET handlers or pages

A write in a GET is slower (forwarded to the primary) and a crawler or a prefetch can trigger it. Mark-as-read, view counters, "last seen" and the like go in a POST route handler or a
server action.

## 3. One database round trip per request

Each database call is a network round trip (10–50 ms, more for far visitors); SQL itself takes under 1 ms. A page
that awaits five queries one after another waits five times. **Every page, route handler and server action reads
through one `loadPage` call: the signed-in user plus all its queries in one `db.batch`.** Use joins or subqueries
instead of a query per row (N+1), and never `await` a query whose inputs do not come from the one before it.

```ts
import { loadPage } from '@/lib/load-page';

const { user, data } = await loadPage((me) => [
  // `me` = the signed-in user's id, as SQL: use it in `where`, never wait for the session first
  db.select().from(posts).where(eq(posts.userId, me)).orderBy(desc(posts.createdAt)).limit(20),
  db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, me), isNull(notifications.readAt))),
  db
    .select({ id: posts.id, body: posts.body, author: users.name }) // the author joined in, not fetched per post
    .from(posts)
    .innerJoin(users, eq(users.id, posts.userId))
    .orderBy(desc(posts.createdAt))
    .limit(20),
], { signedIn: true }); // signed-in only: a visitor without a session cookie runs no query (bots never scan tables)
if (!user) redirect('/login');
const [myPosts, [unread], feed] = data;
```

Per-row count/average: `db.$count(lessons, eq(lessons.courseId, courses.id))` or
`` sql`(select avg(${reviews.rating}) from ${reviews} where ${eq(reviews.courseId, courses.id)})` ``; never a bare outer
`${courses.id}` in a subquery (printed `"id"`, the inner table's: always 0).

**A busy public page, the same for every visitor** (home, catalogue): `cachedRead` (`@/lib/cached-read`) keeps its
reads 1–10 s in the Worker: many views, few calls. **ONLY public data, identical for all**: never
dashboards, accounts, carts, admin, per-user data (`me`, session, cookie) or what follows a write. In its own module
(`src/lib/catalog.ts`: `cachedRead('home', 5, () => db.select().from(products).limit(20))`), the key naming every
input (`cat:${slug}`); `npm run check` refuses it beside the session or a write. Signed-in visitors and those who just
wrote read fresh.

### "Only if there is room"

Seats, stock, one vote per user: reserve with **one statement that inserts only while there is room**. A single
statement is atomic, so two visitors can never both take the last spot; `meta.changes` tells whether it booked.

```ts
const now = new Date().toISOString();
const { meta } = await db.run(sql`
  INSERT INTO bookings (id, class_id, name, email, created_at)
  SELECT ${crypto.randomUUID()}, ${classId}, ${name}, ${email}, ${now}
  WHERE (SELECT count(*) FROM bookings WHERE class_id = ${classId})
      < (SELECT capacity FROM classes WHERE id = ${classId} AND starts_at > ${now})`);
if (meta.changes === 0) return { error: 'This class is full or has started' };
```

It can also be the first item of a `db.batch([...])` / `loadPage` with the reads after it (`const [{ meta }, rows] = …`).
Decide by `meta.changes`, never by re-reading the count.

A unique index (`bookings(class_id, email)`) refuses a second booking by the same e-mail: add
`.onConflictDoNothing().returning()` and `[]` means "already booked" (an error's words: §8). Send the e-mail only after `meta.changes === 1`.

Several rows all or nothing (a cart's items): `check('stock', sql\`${t.stock} >= 0\`)` on the table, then one
`db.batch` of `update(...).set({ stock: sql\`${products.stock} - ${qty}\` })` plus the order insert; an item that
runs out fails the CHECK and the whole batch rolls back.

## 4. What does not belong in this database

Event logs, analytics, telemetry and anything written on every page view: use the platform's analytics instead.

## 5. Live (production) data — only when the task needs it

With a dev database you work on dev (`TOTALUM_ENV=dev`); publish takes your migrations to live. Every run reads
**live rows**; it writes them only when this message itself asks for live data ("change the status of order 42 in
production"; earlier messages don't count), else dev or ask.
`npm run db:schema -- --env live` prints the live schema and its applied migrations (`--env dev`: the dev one), and
`npm run db:sql -- "SELECT …" --env live` reads live rows.

```ts
// scripts/fix-order.ts — run with `npx tsx scripts/fix-order.ts`, then delete the script
import { drizzle } from 'drizzle-orm/d1';
import { totalumD1 } from 'totalum-sdk/d1';
import { eq } from 'drizzle-orm';
import { orders } from '../src/db/schema';

const live = drizzle(totalumD1({ env: 'live' }));
console.log(await live.select().from(orders).where(eq(orders.id, '42')));
await live.update(orders).set({ status: 'shipped' }).where(eq(orders.id, '42'));
```

- Read the rows first, then change only those, by id. An `UPDATE`/`DELETE` with no `WHERE`, or one touching more than
  100 rows, is refused (`LIVE_WRITE_NEEDS_CONFIRMATION`) unless the user explicitly asked for that bulk change.
- Never change the live schema (`LIVE_DB_READ_ONLY`): schema changes go to dev and reach live at publish.
- Never insert test, seed or demo rows into live.
- Every live write is shown to the user with its row count; say in your answer which rows you changed.

## 6. D1 limits (hard)

| Limit | Value | Near it |
|---|---|---|
| Database size | 10 GB | files, images and long text go to `totalum.files` (store the `key`); purge old rows. Beyond 10 GB the project moves to Turso: tell the user, never shard it yourself |
| Row, string or BLOB | 2 MB | never store a file or base64 in a column: upload it, keep its `key` |
| Bound parameters per query | 100 | a multi-row `insert(...).values(rows)` binds rows × every column of the table (defaults too): chunks of `Math.floor(100 / columns)` rows, all in one `db.batch([...])`; `inArray` with ≤ 100 ids |
| SQL statement length | 100 KB | the same chunking; never inline data in SQL |
| Queries per Worker request | 1,000 | paginate (`limit` + a cursor on an indexed column), never load a whole table; backfills go in a script or a cron job in steps |
| Query duration | 30 s | index what you filter and sort on; no unindexed scan of a big table |
| Columns per table | 100 | a second table 1-to-1, or a JSON `text` column for rarely filtered fields |
| `LIKE`/`GLOB` pattern | 50 bytes | cut the search term; search = a folded column (§8) `LIKE ? ESCAPE '\'` with the user's `%`/`_` escaped (FTS5 / virtual tables are refused); semantic search is `totalum.vectors` |
| Expression depth | 100 | `Expression tree is too large (maximum depth 100)` fails the query every time: never nest `replace()`/`CASE` per character (fold text in JS, §8); `inArray` of a subquery adds its depth |
| SELECTs joined by `UNION`/`INTERSECT`/`EXCEPT` | 5 | a list of rows is `VALUES (…), (…)` or a table, never six `SELECT … UNION ALL` |

A database copy runs one call at a time: about 300 a second, fewer if slow (100 ms: 10). A call is one query
or one `db.batch`: one `loadPage` per request. Too many at once: `D1 DB is overloaded` (a busy page the same for
everyone: `cachedRead`, §3).
Over a limit the query throws: 101 parameters give `too many SQL variables`, a 10 MB value `SQLITE_TOOBIG`. The
per-query limits apply to each statement of a `db.batch`.

Turso answers the same: keep to these limits there too. Two differ: a text
value never holds a NUL character (`\u0000`; Turso returns the text cut there, strip it or keep bytes in a `blob`),
and SQL never computes ±Infinity (`1e999`: Turso's driver cannot read it).

## 7. Renaming a column or table

`RENAME COLUMN`/`RENAME TO` keep every row, but the live site runs the previous version until publish finishes and
breaks on the new name: rename by expand-contract (`AGENTS.md`), never in place on a project with users.

## 8. What D1 answers

`npm run dev`, the preview, the published site, scripts and Turso (but §6's two) all answer so:

- **A JS number binds as a REAL.** `` sql`${a} / ${b}` `` divides as floats (7 / 2 = 3.5); for whole numbers use
  `CAST(… AS INTEGER)` or do the arithmetic in JS. Columns keep their type (`integer()` stores 5, not 5.0).
- **`meta.changes` counts the rows triggers and `ON DELETE CASCADE` changed too** (deleting a user with two notes: 3).
  Test `meta.changes > 0`, not `=== 1`, on a table with triggers or children.
- **`lower()`, `upper()`, `LIKE` and `COLLATE NOCASE` fold ASCII only**: `'ÉCOLE' LIKE 'école'` is false, and a unique
  index on `lower(email)` lets `ZOË@x.com` and `zoë@x.com` both in. Lower-case in JS (`toLowerCase()`) before storing
  and before searching.
- **Case- and accent-insensitive search** (café = Cafe = CAFÉ): a `searchText` column the app fills on every insert
  and update (old rows: a backfill script) with `` fold(`${name} ${description}`) ``, where
  `const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();`, searched with
  `` sql`${t.searchText} LIKE ${`%${fold(q).replace(/[\\%_]/g, '\\$&')}%`} ESCAPE '\\'` ``. Never fold in SQL with nested
  `replace()`: past depth 100 (§6) every search fails.
- **No SQL transactions**: `db.transaction()`, `BEGIN` and `SAVEPOINT` fail. `db.batch([...])` is the transaction: all
  of it or none.
- **Several statements in one call** (`` db.run(sql`…; …`) ``) run as one unit and answer the last one; only the last
  may have parameters. Use `db.batch([...])` instead.
- **A failed query's words are in `err.cause`**: `String(err.cause ?? err)` contains `UNIQUE constraint failed`,
  `FOREIGN KEY constraint failed`, `CHECK constraint failed`, `NOT NULL constraint failed`.
- **Migrations, same rules everywhere** (`npm run dev` too): FTS5 is refused; a drop, rename, retype, `DELETE` or
  `UPDATE` of values (a conversion too) needs `-- --destructive` (only if asked; publish asks for live rows;
  not for seed rows of a table live lacks). Filling empties needs none: `WHERE col IS NULL OR col = ''`, in the
  migration. Nor a rebuild changing only DEFAULT/CHECK/collation/NOT NULL-with-default. A drop gets its own
  migration (publish runs it after the new code).

## 9. Test rows on the dev database

It is the owner's preview. Test users: `delivered+agent-test-<n>@resend.dev`, never the owner's address, one the
prompt names or an existing account. Keep the ids you insert and delete only those:
`npm run db:sql -- "DELETE FROM notes WHERE id IN (?, ?)" --param <a> --param <b>`; a test user:
`DELETE FROM users WHERE id = ?` (its sessions and accounts follow). `db:sql` refuses emptying a table, `DROP` and an
auth-table write by anything but ids or test addresses; `--user-asked` only when the prompt asks for that change,
never for cleanup. Without it, a deleted row from before your run comes back.
