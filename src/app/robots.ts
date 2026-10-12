import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/seo';

// /robots.txt of the published site (plan 06 §13). The preview is never indexed: the dispatcher answers there.
export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/login', '/register', '/forgot-password', '/verify-email', '/account'],
    },
    sitemap: `${await siteUrl()}/sitemap.xml`,
  };
}
