import { site } from '@/lib/site';
import { siteIconSvg } from '@/lib/site-icon';

// The browser icon of a site without a logo (layout.tsx links it): the name's initials on the brand colour, which
// next.config.ts reads from globals.css at build time. Platform-owned; a logo in src/lib/site.ts replaces it.
export function GET() {
  return new Response(siteIconSvg(site.name, process.env.TOTALUM_BRAND_COLOR ?? ''), {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
  });
}
