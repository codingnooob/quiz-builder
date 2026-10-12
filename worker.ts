// Platform-owned Worker entry (A3.23, research 46 §6.3): OpenNext's Worker, run inside `withTotalumSession`. A GET
// reads the project database from its nearest read replica; any other request writes to the primary and, for 10 s,
// sends that browser's reads to the primary too (read-your-writes). App code (Drizzle over `totalumD1()`) is unchanged.
// Not type-checked (tsconfig/eslint exclude it): `.open-next/worker.js` exists only after `opennextjs-cloudflare build`.
import handler from './.open-next/worker.js';
import { withTotalumSession } from 'totalum-sdk/d1';

import { keepErrorMessages } from './src/lib/error-logs';
import { namingVisitor, withVisitor } from './src/lib/visitor';

// B2-BI9 (e): an Error in a console line reaches the project's logs with its message and cause chain.
keepErrorMessages();

// B3-AT6: the app's calls to Totalum name the visitor they are made for, so paid built-ins are limited per visitor.
globalThis.fetch = namingVisitor(globalThis.fetch);

// OpenNext's cache Durable Object classes: inert (no binding declares them), exported as OpenNext's entry does.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

interface OpenNextHandler {
  fetch(request: Request, env: object, ctx: ExecutionContext): Promise<Response>;
}

// Plan 06 §8.1 (A7.4), on every response the Worker renders — here and not in a Next proxy (1.2 MB of Worker). The
// published site (live host and custom domains) may be framed only by itself (Francesc 2026-09-28: clickjacking); the
// dispatcher replaces frame-ancestors on the preview, which the platform embeds (A4.21).
// B3-AT5: script-src with a nonce minted per response, handed to Next on the request (Next stamps its own inline
// scripts with it; `scriptNonce()` gives it to the app's), so an injected inline script or `on…=` handler does not run.
// Scripts from this site and over https stay allowed (the editor agent, widgets, maps); the captcha's proof of work is
// a blob: Web Worker. No connect/img/frame-src allow-list: it would break every third-party API or embed an app uses.
const scriptPolicy = (nonce: string) =>
  `script-src 'self' 'nonce-${nonce}' https: 'wasm-unsafe-eval'; worker-src 'self' blob:`;
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests",
  'Strict-Transport-Security': 'max-age=63072000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

// Review 57: another customer's site on the shared zones is same-site with this one, so the browser sends it this app's
// SameSite=Lax session cookie. Next checks a server action's Origin and better-auth its own routes; a route handler
// checks nothing. A state-changing request from a same-site page of another origin is refused (TOTALUM_ALLOWED_ORIGINS
// may list a sibling host of the owner's own domain).
function sameSiteWrite(request: Request, env: { TOTALUM_ALLOWED_ORIGINS?: string }): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  if (request.headers.get('sec-fetch-site') !== 'same-site') return false;
  const allowed = (env.TOTALUM_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
  return !allowed.includes(request.headers.get('origin') ?? '');
}

// The render goes on after the headers (Suspense boundaries, RSC): a client that disconnects mid-body cancels the body,
// and with it the rest of the render and what it shared with the isolate (review 56). An HTML or RSC body is piped
// through, the pipe handed to waitUntil, and after a disconnect the rest is still read to its end (≤ 30 s). Other bodies
// (downloads, event streams) are left as they are.
function keptBody(response: Response, ctx: ExecutionContext): ReadableStream | null {
  const body = response.body;
  if (!body || !/^text\/(html|x-component)/.test(response.headers.get('content-type') ?? '')) return body;
  const { readable, writable } = new TransformStream();
  ctx.waitUntil(
    body
      .pipeTo(writable, { preventCancel: true })
      .catch(() => body.pipeTo(new WritableStream()))
      .catch(() => undefined),
  );
  return readable;
}

function secured(response: Response, ctx: ExecutionContext, csp = ''): Response {
  if (response.status === 101) return response;
  const res = new Response(keptBody(response, ctx), response);
  for (const [name, value] of Object.entries({
    ...SECURITY_HEADERS,
    ...(csp && { 'Content-Security-Policy': csp }),
  }))
    if (!res.headers.has(name)) res.headers.set(name, value);
  return res;
}

function withNonce(request: Request): [Request, string] {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = `${SECURITY_HEADERS['Content-Security-Policy'] ?? ''}; ${scriptPolicy(nonce)}`;
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp); // a client-sent value never survives
  return [new Request(request, { headers }), csp];
}

// A client that disconnects cancels its request, and workerd then drops that request's pending timers and I/O. A
// promise the request started and the isolate shares (Next/OpenNext's lazy first-render state) would then never
// settle, and every later request awaiting it hangs until the isolate dies (seen on dev: a prefetch cancelled
// mid-render on a new version, then ~1 min of HTML requests that never answered; ui-evidence/preview-hang/render-cancel).
// Handing the request's own work to waitUntil keeps it running (≤ 30 s) until its response is ready.
export default {
  fetch: (request: Request, env: object, ctx: ExecutionContext) => {
    if (sameSiteWrite(request, env))
      return secured(new Response('Refused: a request from another site', { status: 403 }), ctx);
    const [app, csp] = withNonce(request);
    const response = withVisitor(request, env, () =>
      withTotalumSession(app, env, (appEnv) => (handler as OpenNextHandler).fetch(app, appEnv, ctx)),
    ).then((res) => secured(res, ctx, csp));
    ctx.waitUntil(response.catch(() => undefined));
    return response;
  },
};
