import { getCloudflareContext } from '@opennextjs/cloudflare';
import { APIError } from 'better-auth/api';

import { db } from '@/db';
import { rateLimits } from '@/db/schema.auth';
import { isPreviewSurface, requestOrigin } from '@/lib/request-origin';
import { site } from '@/lib/site';

// Totalum's own captcha on sign-up and sign-in, published site only (A8.9 as amended 2026-10-01, research 57 §8).
// No third party, no cookie. The auth form fetches a challenge from GET /api/captcha: HMAC-signed with the project's
// TOTALUM_CAPTCHA_SECRET (PGM binds it on the published Worker), bound to the host, valid 5 min, single use (its nonce
// is kept in `rate_limits` until it expires). The form sends it back in `x-totalum-captcha` with the hidden honeypot
// and a few browser signals. A visitor who looks normal passes invisibly (only a 2 s minimum fill time); a suspicious
// one gets a 403 CHALLENGE_REQUIRED carrying a harder challenge: a SHA-256 proof of work its browser solves in a Web
// Worker (~1 s medium, a few s high) before the form resends. Off on the preview and `npm run dev`, and when the owner
// sets `site.captcha = false` (src/lib/site.ts); the lockout and rate limits (login-guard.ts) stay on either way. On
// a published Worker with the captcha on but no secret, every sign-up and sign-in is refused (fails closed).
export const CAPTCHA_HEADER = 'x-totalum-captcha';
const TTL_MS = 5 * 60_000;
export const MIN_FILL_MS = 2000;
/** Leading zero bits of SHA-256(signature + ':' + nonce): 2^bits hashes on average. */
export const DIFFICULTY = { medium: 19, high: 21 };
export const VERIFICATION_FAILED = {
  code: 'VERIFICATION_FAILED',
  message: 'Verification failed. Reload the page and try again.',
};
const UNAVAILABLE = { code: 'CAPTCHA_UNAVAILABLE', message: 'Sign-up and sign-in are unavailable' };

/** Whether the auth pages need a challenge: live only, unless the owner switched it off. */
export const captchaOn = () =>
  site.captcha &&
  !isPreviewSurface() &&
  (!!process.env.TOTALUM_CAPTCHA_SECRET || process.env.TOTALUM_USAGE_ENV === 'live');

const b64 = (bytes: ArrayBuffer | string) =>
  (typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes)).toString('base64url');

const utf8 = (text: string) => new TextEncoder().encode(text);
const hmacKey = () =>
  crypto.subtle.importKey(
    'raw',
    utf8(process.env.TOTALUM_CAPTCHA_SECRET ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

async function mint(host: string, d: number) {
  const body = b64(JSON.stringify({ n: crypto.randomUUID(), t: Date.now(), h: host, d }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), utf8(body));
  return { challenge: `${body}.${b64(sig)}`, difficulty: d };
}

/** GET /api/captcha → `{ challenge, difficulty: 0 }`, or 404 when the captcha is off. */
export async function issueChallenge(req: Request) {
  if (!captchaOn()) return Response.json({ code: 'CAPTCHA_OFF' }, { status: 404 });
  if (!process.env.TOTALUM_CAPTCHA_SECRET) return Response.json(UNAVAILABLE, { status: 503 });
  return Response.json(await mint(new URL(requestOrigin(req)).host, 0), {
    headers: { 'cache-control': 'no-store' },
  });
}

async function leadingZeroBits(input: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(input)));
  let bits = 0;
  for (const byte of hash) {
    bits += Math.clz32(byte) - 24;
    if (byte) break;
  }
  return bits;
}

const BOT_AGENT =
  /curl|wget|python|httpx|aiohttp|go-http|java\/|okhttp|node|axios|undici|headless|phantom|selenium|puppeteer|playwright/i;
const HOSTING =
  /amazon|google cloud|microsoft|digitalocean|ovh|hetzner|linode|akamai|vultr|choopa|oracle|alibaba|tencent|contabo|leaseweb|scaleway/i;

/** Weak signals only (no Enterprise bot score): 0–1 → invisible, 2–3 → medium, ≥ 4 → high. */
export function riskScore(
  headers: Headers,
  signals: number,
  counts: { ipFailures: number; emailFailures: number; signUps: number },
) {
  let cf: { asOrganization?: string } | undefined;
  try {
    cf = getCloudflareContext().cf;
  } catch {
    // outside the Worker (unit tests)
  }
  const ua = headers.get('user-agent') ?? '';
  return (
    (signals & 1 ? 3 : 0) + // navigator.webdriver
    (signals & 2 ? 3 : 0) + // a headless browser's user agent
    (signals & 4 ? 1 : 0) + // no navigator.languages
    (!ua || BOT_AGENT.test(ua) ? 3 : 0) +
    (headers.get('accept-language') ? 0 : 1) +
    (headers.get('sec-fetch-mode') ? 0 : 1) +
    (cf?.asOrganization && HOSTING.test(cf.asOrganization) ? 1 : 0) +
    (counts.ipFailures >= 5 ? 2 : 0) +
    (counts.emailFailures >= 3 ? 2 : 0) +
    (counts.signUps >= 10 ? 4 : counts.signUps >= 3 ? 2 : 0)
  );
}

const required = (score: number) => (score >= 4 ? DIFFICULTY.high : score >= 2 ? DIFFICULTY.medium : 0);

type Answer = { c?: unknown; n?: unknown; s?: unknown; hp?: unknown };
type Claims = { n: string; t: number; h: string; d: number };

/** The form's answer with its challenge's signed claims, or `null` when it is no answer or not a challenge of ours. */
async function signedAnswer(headers: Headers | undefined) {
  let answer: Answer;
  try {
    answer = JSON.parse(headers?.get(CAPTCHA_HEADER) ?? '') as Answer;
  } catch {
    return null;
  }
  const [body = '', sig = ''] = typeof answer.c === 'string' ? answer.c.split('.') : [];
  const signed = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(),
    Buffer.from(sig, 'base64url'),
    utf8(body),
  );
  if (!signed) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Claims;
  return { answer, sig, claims, age: Date.now() - claims.t };
}

/** A proof of work for challenge `sig` at difficulty `d` (`nonce` is the form's answer). */
const proofOfWork = async (sig: string, nonce: string, d: number) =>
  /^\d{1,11}$/.test(nonce) && (await leadingZeroBits(`${sig}:${nonce}`)) >= d;

/** One use of a challenge, kept in `rate_limits` until it expires: false when `key` was used before. */
async function firstUse(key: string, claims: Claims) {
  const fresh = await db
    .insert(rateLimits)
    .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: claims.t + TTL_MS })
    .onConflictDoNothing()
    .returning({ id: rateLimits.id });
  return fresh.length > 0;
}

/** Called by login-guard's `refuse` on /sign-up/email and /sign-in/email, after the lockout check. */
export async function verifyCaptcha(
  headers: Headers | undefined,
  host: string,
  counts: Parameters<typeof riskScore>[2],
) {
  if (!captchaOn()) return;
  if (!process.env.TOTALUM_CAPTCHA_SECRET) throw new APIError('SERVICE_UNAVAILABLE', UNAVAILABLE);
  const fail = () => new APIError('FORBIDDEN', VERIFICATION_FAILED);
  const signed = await signedAnswer(headers);
  if (!signed) throw fail();
  const { answer, sig, claims, age } = signed;
  const { n, h, d } = claims;
  if (h !== host || age > TTL_MS || age < -5000 || answer.hp) throw fail();
  const need = required(riskScore(headers ?? new Headers(), Number(answer.s) || 0, counts));
  if (d < need)
    throw new APIError('FORBIDDEN', {
      code: 'CHALLENGE_REQUIRED',
      message: 'Verifying you’re human…',
      ...(await mint(host, need)),
    });
  const solved = d ? await proofOfWork(sig, String(answer.n), d) : age >= MIN_FILL_MS;
  if (!solved || !(await firstUse(`captcha:${n}`, claims))) throw fail();
}

/**
 * at6fix: the resend that answers a CHALLENGE_REQUIRED — a proof-of-work challenge only that refusal mints, solved,
 * for this host, its first resend. better-auth's sign-up rate limit already counted the refused send, so this one is
 * not counted again (src/lib/auth.ts): a challenge and its answer are one sign-up, not two.
 */
export async function answersChallenge(request: Request, host: string) {
  if (!captchaOn() || !process.env.TOTALUM_CAPTCHA_SECRET) return false;
  const signed = await signedAnswer(request.headers);
  if (!signed?.claims.d || signed.claims.h !== host || signed.age > TTL_MS || signed.age < -5000)
    return false;
  return (
    (await proofOfWork(signed.sig, String(signed.answer.n), signed.claims.d)) &&
    firstUse(`captcha-resend:${signed.claims.n}`, signed.claims)
  );
}
