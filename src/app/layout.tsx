import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { DevBanner } from '@/components/dev-banner';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { siteUrl } from '@/lib/seo';
import { site } from '@/lib/site';

import './globals.css';

export const dynamic = 'force-dynamic';

// Every page's <title> is `<its metadata.title> · <site name>`; canonical URLs and social images resolve on siteUrl().
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(await siteUrl()),
    title: { default: site.name, template: `%s · ${site.name}` },
    description: site.description,
    // the logo, else the name's initials on the brand colour (src/app/site-icon.svg): every site has an icon
    icons: { icon: site.logo || '/site-icon.svg' },
  };
}

// Fonts (design.md §1): `const heading = Fraunces({ subsets: ['latin'], variable: '--font-heading' })` from
// `next/font/google` (and `--font-body`), then both `.variable` classes in the <html> className below.
const fonts = '';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={fonts} lang="en">
      <body className="flex min-h-dvh flex-col bg-white font-sans text-zinc-900 antialiased">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <DevBanner />
      </body>
    </html>
  );
}
