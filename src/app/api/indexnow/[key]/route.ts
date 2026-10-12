import { totalum } from 'totalum-sdk';

// IndexNow's key file (plan 06 §13, A7.7): next.config.ts rewrites /<32 hex>.txt here. The key is the project's, from
// SDK-API; any other path 404s. Search engines fetch it after `totalum.seo.notifyChanged(urls)` on a custom domain.
export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
  const [{ key }, own] = await Promise.all([params, totalum.seo.indexNowKey().catch(() => undefined)]);
  if (!own) return new Response(null, { status: 503 });
  if (own.key !== key) return new Response(null, { status: 404 });
  return new Response(key, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
