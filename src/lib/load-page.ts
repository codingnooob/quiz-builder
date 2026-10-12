import { getSessionCookie } from 'better-auth/cookies';
import { sql, type SQL } from 'drizzle-orm';
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch';
import { headers } from 'next/headers';

import { db } from '@/db';
import { sessions } from '@/db/schema';
import { getAuth } from '@/lib/auth';

/**
 * One database round trip per request (research 49): the signed-in user plus every read the page or route needs, as
 * ONE `db.batch()`. `me` is the signed-in user's id as SQL, keyed on the session cookie, so each query can filter on
 * it without first waiting for the session (`eq(posts.userId, me)`); it matches nothing when nobody is signed in.
 * better-auth answers the user from its cookie cache (no database call) while the batch runs; on a cache miss its own
 * lookup runs beside the batch, not before it. Works in pages, route handlers and server actions.
 * `{ signedIn: true }` (a page or route only signed-in users may use): a request with no session cookie runs no query
 * and gets `{ user: null, data: null }`, so anonymous traffic (bots, crawlers) never scans the tables (e2esoak2 G3).
 */
type Loaded<T> = { user: User; data: T } | { user: null; data: T | null };
type User = NonNullable<Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>>['user'];

export async function loadPage<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(
  queries: (me: SQL) => T,
): Promise<{ user: User | null; data: BatchResponse<T> }>;
export async function loadPage<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(
  queries: (me: SQL) => T,
  options: { signedIn: true },
): Promise<Loaded<BatchResponse<T>>>;
export async function loadPage<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(
  queries: (me: SQL) => T,
  options?: { signedIn: true },
): Promise<Loaded<BatchResponse<T>>> {
  const h = await headers();
  // A page has no Request: in the Worker, OpenNext's routing layer records the real URL (and strips that header from
  // the client); under `next start`/`next dev` Next's own forwarded headers are right.
  const url =
    h.get('x-opennext-initial-url') ??
    `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost'}/`;
  const auth = getAuth(new Request(url, { headers: h }));
  // The cookie is `<token>.<signature>`; the token alone is the credential the sessions table stores.
  const token =
    getSessionCookie(h, { cookiePrefix: auth.options.advanced.cookiePrefix })?.split('.')[0] ?? null;
  if (options?.signedIn && !token) return { user: null, data: null };
  const me = sql`(select ${sessions.userId} from ${sessions} where ${sessions.token} = ${token} and ${sessions.expiresAt} > ${new Date().toISOString()})`;
  const [session, data] = await Promise.all([auth.api.getSession({ headers: h }), db.batch(queries(me))]);
  return { user: session?.user ?? null, data };
}
