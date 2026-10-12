import { headers } from 'next/headers';

// Plan 06 §13: the site's canonical origin for sitemap, robots and metadata — the host PGM binds as
// TOTALUM_PUBLIC_HOSTS (the live URL on the published site), else the request's own host (npm run dev) — behind the
// Sprite bridge (TOTALUM_TRUST_PROXY=1) the preview's public host it forwards, never the Sprite's (b4fix B4-5).
export async function siteUrl(): Promise<string> {
  const host = process.env.TOTALUM_PUBLIC_HOSTS?.split(',')[0]?.trim();
  if (host) return `https://${host}`;
  const h = await headers();
  const forwarded = process.env.TOTALUM_TRUST_PROXY === '1' && h.get('x-forwarded-host');
  if (forwarded) return `${h.get('x-forwarded-proto') ?? 'https'}://${forwarded}`;
  return `http://${h.get('host') ?? 'localhost'}`;
}
