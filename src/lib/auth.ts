import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { headers } from 'next/headers';
import { totalum } from 'totalum-sdk';

import { text } from '@/app/(accounts)/text';
import { db } from '@/db';
import * as schema from '@/db/schema.auth';
import { answersChallenge } from '@/lib/captcha';
import { countFailures, refuse } from '@/lib/login-guard';
import { isPreviewSurface, requestOrigin } from '@/lib/request-origin';
import { site } from '@/lib/site';

// better-auth on the project database through Drizzle (plan 06 §7.2). Built per origin, cached per isolate. The app's
// own origin (live host or temporal link) is trusted per request; a wildcard over the customer zones would trust every
// other customer's site, same-site with this one (security review 55). The platform only embeds the preview, so the live
// site never trusts it: a reset `redirectTo` could otherwise land the token on a platform page (review 57 R1).
const PLATFORM_ORIGINS = ['https://platform.totalum.app'];
const list = (value: string | undefined) => value?.split(',').filter(Boolean) ?? [];

/**
 * b5fix: "Continue with Google" is on once the owner adds the project secrets `GOOGLE_CLIENT_ID` and
 * `GOOGLE_CLIENT_SECRET` (Totalum binds a changed secret to the running preview and live Workers at once). Google
 * redirects to `<origin>/api/auth/callback/google`; the owner's steps: `_system-docs/google-sign-in.md`.
 */
export function googleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function createAuth(origin: string) {
  const https = origin.startsWith('https://');
  const preview = isPreviewSurface();
  const crossSite = https && preview;
  const google = googleClient();
  return betterAuth({
    baseURL: origin,
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      // `site.verifyEmail`: sign-in waits for the 8-digit code sent at sign-up (and sent again on a refused sign-in)
      requireEmailVerification: site.verifyEmail,
    },
    // Codes, never links (emailOTP below): confirming an address (sign-up with `site.verifyEmail`; the admin card on
    // /account) and resetting a password (/forgot-password). sjfix SJ2: without `site.verifyEmail` sign-up sends no
    // e-mail; an admin address counts only once confirmed (`isAdmin`, src/lib/admin.ts). A password reset signs the old
    // sessions out, so whoever registered the owner's address first loses it when the owner resets the password.
    emailVerification: {
      autoSignInAfterVerification: true,
      sendOnSignUp: site.verifyEmail,
      sendOnSignIn: site.verifyEmail,
    },
    user: { deleteUser: { enabled: true } },
    // An e-mail registered with a password is joined to its Google account only once verified (better-auth's
    // `requireLocalEmailVerified` default), so an account that registered someone else's address never gets their login.
    socialProviders: { ...(google && { google: { ...google, prompt: 'select_account' as const } }) },
    trustedOrigins: [
      origin,
      ...(preview ? PLATFORM_ORIGINS : []),
      ...list(process.env.TOTALUM_PUBLIC_HOSTS).map((host) => `https://${host}`),
      ...list(process.env.TOTALUM_ALLOWED_ORIGINS),
    ],
    // The signed session cookie answers `getSession` for 5 min without a database round trip (research 46 §6.4: two
    // round trips, ~90 ms, off every page and API call); a sign-out or revoked session reaches other tabs within 5 min.
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // Login protection, live only (the preview and `npm run dev` skip it) — never remove it (restyling the pages is
    // fine): better-auth's rate limit per IP, the lockout per e-mail and per IP and the sign-up e-mail rules
    // (login-guard.ts), and Totalum's captcha on sign-up and sign-in only (captcha.ts; the answer rides in
    // `x-totalum-captcha`; the owner may switch only the captcha off, with `site.captcha` in src/lib/site.ts).
    rateLimit: {
      enabled: !preview,
      storage: 'database',
      window: 10,
      max: 20,
      customRules: {
        '/sign-in/email': { window: 10, max: 5 },
        // at6fix: 10 a minute per IP, so people behind one office or school address can sign up together (the captcha
        // and login-guard stop abuse); the resend answering a captcha challenge is not counted again
        '/sign-up/email': async (request) =>
          (await answersChallenge(request, new URL(origin).host)) ? false : { window: 60, max: 10 },
      },
    },
    advanced: {
      // Only Cloudflare's CF-Connecting-IP: the dispatcher passes the visitor's request through unchanged, and a
      // client-sent X-Forwarded-For arrives verbatim, so it would pick the per-IP bucket (dev, 2026-09-28).
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // `__Host-` on https: no other host may set these cookies. Every customer site shares the same parent zones (not
      // on the Public Suffix List), so with `__Secure-` a sibling site could plant its session here (review 57).
      cookiePrefix: `${https ? '__Host-' : ''}tlm_${process.env.TOTALUM_PROJECT_ID ?? 'app'}`,
      useSecureCookies: false,
      // A4.14: preview surfaces live in the platform's cross-site iframe, so their cookie is CHIPS-partitioned.
      defaultCookieAttributes: crossSite
        ? { sameSite: 'none', secure: true, partitioned: true, httpOnly: true, path: '/' }
        : { sameSite: 'lax', secure: https, httpOnly: true, path: '/' },
    },
    hooks: preview ? {} : { before: refuse, after: countFailures },
    plugins: [
      emailOTP({
        otpLength: 8,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          await totalum.email
            .send({
              to: email,
              from: { name: site.name }, // SB3: the app's name, never the project id
              subject: type === 'forget-password' ? text.email.resetSubject : text.email.verifySubject,
              html: text.email.body(otp),
            })
            .catch((err: unknown) => {
              console.error('account code e-mail failed', err);
            });
        },
      }),
      nextCookies(),
    ],
  });
}

const cache = new Map<string, ReturnType<typeof createAuth>>();

export function getAuth(req: Request) {
  const origin = requestOrigin(req);
  let auth = cache.get(origin);
  if (!auth) cache.set(origin, (auth = createAuth(origin)));
  return auth;
}

/**
 * The signed-in session in a server component, layout or server action (`null` when signed out) — protect a page with
 * `if (!(await currentSession())) redirect('/login')`. The request's real scheme, as `loadPage` reads it: a hard-coded
 * https looked for the `__Host-` cookie under `npm run dev` (http), so every signed-in user was sent to /login there
 * (research 69: both CRM agents rewrote their pages around it).
 */
export async function currentSession() {
  const h = await headers();
  const url =
    h.get('x-opennext-initial-url') ??
    `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost'}/`;
  const req = new Request(url, { headers: h });
  return getAuth(req).api.getSession({ headers: h });
}
