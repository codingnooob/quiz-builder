// Platform-owned (worker.ts); never edit. B3-AT6: Totalum counts the paid built-ins (AI, web, browser, screenshots)
// a visitor drives, at most `site.paidCallsPerVisitorPerMinute` a minute (default 20), so an anonymous visitor cannot
// spend the owner's credits by calling a public AI page in a loop. The Worker names the visitor — Cloudflare's
// CF-Connecting-IP — on the app's calls to Totalum (SDK-API and the AI gateway) only, never to another host. No visitor
// is named outside a request (cron) or for a local address (`npm run dev`, the sandbox), so the builder is never limited.
import { AsyncLocalStorage } from 'node:async_hooks';

import { site } from './site'; // relative: worker.ts is bundled without the @/ alias

type Visitor = { ip: string; hosts: string[] };
type Env = { TOTALUM_SDK_API_URL?: string; TOTALUM_AI_BASE_URL?: string };

const current = new AsyncLocalStorage<Visitor>();
const LOCAL = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;
const hostOf = (url: string | undefined, fallback: string) =>
  URL.canParse(url ?? '') ? new URL(url ?? '').host : fallback;

/** Runs the request's work with its visitor named (worker.ts). */
export function withVisitor<T>(request: Request, env: Env, run: () => T): T {
  const ip = request.headers.get('cf-connecting-ip')?.trim() ?? '';
  if (!ip || LOCAL.test(ip)) return run();
  const hosts = [
    hostOf(env.TOTALUM_SDK_API_URL, 'sdk-api.totalum.app'),
    hostOf(env.TOTALUM_AI_BASE_URL, 'ai.totalum.app'),
  ];
  return current.run({ ip, hosts }, run);
}

/** `fetch` that adds the visitor to a call to Totalum made inside `withVisitor`, and leaves every other call as it is. */
export function namingVisitor(fetchOf: typeof fetch): typeof fetch {
  return (input, init) => {
    const visitor = current.getStore();
    const url = input instanceof Request ? input.url : String(input);
    if (!visitor || !URL.canParse(url) || !visitor.hosts.includes(new URL(url).host))
      return fetchOf(input, init);
    const request = new Request(input, init);
    request.headers.set('x-totalum-visitor-ip', visitor.ip);
    request.headers.set('x-totalum-visitor-limit', String(site.paidCallsPerVisitorPerMinute));
    return fetchOf(request);
  };
}
