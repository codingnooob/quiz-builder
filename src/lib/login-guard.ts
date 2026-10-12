import { APIError, createAuthMiddleware, getIP, isAPIError } from 'better-auth/api';
import { eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { rateLimits, users } from '@/db/schema.auth';
import { verifyCaptcha } from '@/lib/captcha';

// Login protection on the published site (src/lib/auth.ts; the preview skips it). Sign-up refuses an address that
// equals an account's once the dots of the local part are dropped (`jo.hn@` = `john@`, the unique index
// `users_email_key`) with the same REGISTRATION_FAILED as an existing e-mail, so no answer tells which exist; its words
// say what to do. A `+` address is a real address (SB6, 2026-10-03: it was refused, and real Gmail users with it).
// Brute force on /sign-in/email: 10 wrong passwords for one e-mail, or 30 from one IP, lock that e-mail / IP for 15 min
// after its last failure. Counted for every e-mail, registered or not, so the answer never tells which exist. Rows live
// in better-auth's `rate_limits` under `lock:` keys with `last_request` = the lock's END, so better-auth's pruner (it
// deletes rows older than its longest window) keeps them until they expire. Successful sign-ups per IP (1 h window,
// `signup:ip:`) and these failure counts feed the captcha's risk score (captcha.ts), checked after the lockout and
// before the e-mail rules; with the captcha off (`site.captcha = false`) all of this still applies.
export const LOCK_MS = 15 * 60_000;
const MAX_FAILURES = { email: 10, ip: 30 };
const SIGN_UP_WINDOW_MS = 60 * 60_000;
export const TOO_MANY_ATTEMPTS = {
  code: 'TOO_MANY_ATTEMPTS',
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
};

export const REGISTRATION_FAILED = {
  code: 'REGISTRATION_FAILED',
  message:
    'We could not create an account with this e-mail. If you already have one, sign in or reset your password.',
};
const EMAIL_KEY = sql`lower(replace(substr(${users.email}, 1, instr(${users.email}, '@') - 1), '.', '') || substr(${users.email}, instr(${users.email}, '@')))`;
const emailKey = (email: string) => {
  const at = email.lastIndexOf('@');
  return (email.slice(0, at).replaceAll('.', '') + email.slice(at)).toLowerCase();
};

type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function lockKeys(ctx: Ctx): [[string, number], [string, number], string] {
  const email = (ctx.body as { email?: unknown } | undefined)?.email;
  const key = typeof email === 'string' ? email.toLowerCase() : '';
  const ip = (ctx.request && getIP(ctx.request, ctx.context.options)) ?? 'unknown';
  return [[`lock:email:${key}`, MAX_FAILURES.email], [`lock:ip:${ip}`, MAX_FAILURES.ip], `signup:ip:${ip}`];
}

const bump = (key: string, now: number, until: number) =>
  db
    .insert(rateLimits)
    .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: until })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.lastRequest} > ${now} THEN ${rateLimits.count} + 1 ELSE 1 END`,
        lastRequest: until,
      },
    });

async function refuseEmail(email: unknown) {
  if (typeof email !== 'string') return;
  const taken = async () =>
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${EMAIL_KEY} = ${emailKey(email)}`)
        .limit(1)
    ).length > 0;
  if (await taken()) throw new APIError('BAD_REQUEST', REGISTRATION_FAILED);
}

export const refuse = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/sign-up/email' && ctx.path !== '/sign-in/email') return;
  const [[emailKey, maxEmail], [ipKey, maxIp], signUpKey] = lockKeys(ctx);
  const rows = await db
    .select()
    .from(rateLimits)
    .where(inArray(rateLimits.key, [emailKey, ipKey, signUpKey]));
  const now = Date.now();
  const count = (key: string) => rows.find((r) => r.key === key && r.lastRequest > now)?.count ?? 0;
  const signIn = ctx.path === '/sign-in/email';
  if (signIn && (count(emailKey) >= maxEmail || count(ipKey) >= maxIp))
    throw new APIError('TOO_MANY_REQUESTS', TOO_MANY_ATTEMPTS);
  await verifyCaptcha(ctx.headers, new URL(ctx.context.baseURL).host, {
    ipFailures: count(ipKey),
    emailFailures: signIn ? count(emailKey) : 0,
    signUps: count(signUpKey),
  });
  if (!signIn) await refuseEmail((ctx.body as { email?: unknown } | undefined)?.email);
});

export const countFailures = createAuthMiddleware(async (ctx) => {
  const returned = ctx.context.returned;
  const [[emailKey], [ipKey], signUpKey] = lockKeys(ctx);
  const now = Date.now();
  if (ctx.path === '/sign-up/email') {
    if (!isAPIError(returned)) await bump(signUpKey, now, now + SIGN_UP_WINDOW_MS);
    return;
  }
  if (ctx.path !== '/sign-in/email') return;
  if (!isAPIError(returned)) {
    await db.delete(rateLimits).where(eq(rateLimits.key, emailKey));
    return;
  }
  if (returned.statusCode !== 401) return;
  await db.batch([bump(emailKey, now, now + LOCK_MS), bump(ipKey, now, now + LOCK_MS)]);
});
