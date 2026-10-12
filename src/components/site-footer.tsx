import Link from 'next/link';

import { LogoMark } from '@/components/logo-mark';
import { hasShell, site } from '@/lib/site';

export function SiteFooter() {
  if (!hasShell()) return null;
  return (
    <footer className="border-t border-brand/10 bg-paper py-10 text-sm text-stone-600">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-[1fr_auto] md:items-start">
        <div className="max-w-md">
          <p className="flex items-center gap-2.5 font-display text-lg font-semibold text-brand">
            {site.logo ? <img alt="" className="h-7 w-auto" src={site.logo} /> : <LogoMark className="size-7" />}
            {site.name}
          </p>
          <p className="mt-3 leading-6">
            Turn study material into quizzes. No account needed. Questions are written by AI, so skim the answers before you use a quiz for grading.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 font-medium text-stone-700">
          {site.nav.map((l) => (
            <Link className="hover:text-brand" href={l.href} key={l.href}>
              {l.label}
            </Link>
          ))}
          <Link className="hover:text-brand" href="/#upload">
            Upload a document
          </Link>
        </nav>
        <p className="text-xs text-stone-500 md:col-span-2">
          © {new Date().getFullYear()} {site.name}
        </p>
      </div>
    </footer>
  );
}
