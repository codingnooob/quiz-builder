import { existsSync, readFileSync } from 'node:fs';

import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// The brand colour of globals.css (`--color-brand`) for the generated browser icon (src/app/site-icon.svg/route.ts).
const css = existsSync('src/app/globals.css') ? readFileSync('src/app/globals.css', 'utf8') : '';
const brand = /--color-brand:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? '';

// Platform-owned (plan 06 §4.3): the agent never edits this file. SSR only, no image optimisation (A7.1).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { TOTALUM_BRAND_COLOR: brand.startsWith('var(') ? '' : brand },
  poweredByHeader: false,
  images: { unoptimized: true },
  // `*.example.tsx` pages and routes (the real-time example, plan 06 §12.5) exist only in a build with the flag
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'].flatMap((ext) =>
    process.env.NEXT_PUBLIC_TOTALUM_REALTIME_EXAMPLES === '1' ? [ext, `example.${ext}`] : [ext],
  ),
  transpilePackages: ['@libsql/client'],
  // Turbopack resolves the `node` export condition, never `workerd` (opennextjs-cloudflare #1205). Listed packages
  // stay external, so OpenNext's bundler picks their `workerd` build; without it Stripe's Node HTTP client hangs.
  serverExternalPackages: ['stripe'],
  // `npm run build:preview` runs `tsc --noEmit` beside the OpenNext bundle and fails on a type error.
  typescript: { ignoreBuildErrors: true },
  // IndexNow's key file (plan 06 §13): /<key>.txt, answered by the key route
  rewrites: () => Promise.resolve([{ source: '/:key([0-9a-f]{32}).txt', destination: '/api/indexnow/:key' }]),
  // The visual editor's source stamps (plan 06 §9): preview builds only — AM sets TOTALUM_SOURCE_TAGS=1 there, 0 at
  // publish, so a published app carries no file paths.
  ...(process.env.TOTALUM_SOURCE_TAGS === '1' && {
    turbopack: {
      rules: Object.fromEntries(
        ['*.tsx', '*.jsx'].map((glob) => [glob, { loaders: ['./scripts/tlm-source-tags-loader.cjs'] }]),
      ),
    },
  }),
};

// `npm run dev` only: on a project with a dev database (`TOTALUM_ENV=dev` and the project key: the Sprite, or `.env`)
// no local binding, so `db` is that dev database over HTTPS — the one the preview, `db:migrate`, `db:sql` and seeds use
// (selftest: the agent's checks read an empty local D1). Otherwise (live-only, no key) the `wrangler.jsonc` bindings
// through Miniflare: the local D1 in `.wrangler/`, never live. `next build` / `next start` get no local binding.
export default async function config(phase: string): Promise<NextConfig> {
  const devDatabase = process.env.TOTALUM_ENV === 'dev' && !!process.env.TOTALUM_PROJECT_KEY;
  if (phase === PHASE_DEVELOPMENT_SERVER && !devDatabase) await initOpenNextCloudflareForDev();
  return nextConfig;
}
