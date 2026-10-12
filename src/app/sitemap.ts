import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/seo';

// /sitemap.xml (plan 06 §13): every public page's path; pages built from rows list them from the database.
const PATHS = ['/'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const url = await siteUrl();
  return PATHS.map((path) => ({ url: `${url}${path}` }));
}
