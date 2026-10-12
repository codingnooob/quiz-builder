import Link from 'next/link';

import { LogoMark } from '@/components/logo-mark';
import { SignOutButton } from '@/components/sign-out-button';
import { currentSession } from '@/lib/auth';
import { hasShell, site } from '@/lib/site';

const link =
  'rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none';

// The header every route shares (rendered by layout.tsx): edit the links in `src/lib/site.ts`, restyle it here.
export async function SiteHeader() {
  if (!hasShell()) return null;
  const session = site.accounts ? await currentSession() : null;
  const links = session ? [...site.nav, ...site.appNav] : site.nav;
  const items = (
    <>
      {links.map((l) => (
        <Link className={link} href={l.href} key={l.href}>
          {l.label}
        </Link>
      ))}
      {!site.accounts ? null : session ? (
        <SignOutButton className={`${link} text-start`} />
      ) : (
        <>
          <Link className={link} href="/login">
            Sign in
          </Link>
          <Link
            className="rounded-lg bg-brand px-4 py-2 text-center text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand/90"
            href="/register"
          >
            Get started
          </Link>
        </>
      )}
      <Link
        className="rounded-lg bg-accent px-4 py-2 text-center text-sm font-semibold text-brand transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
        href="/#upload"
      >
        Upload a document
      </Link>
    </>
  );
  return (
    <header className="sticky top-0 z-20 border-b border-brand/10 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          className="flex items-center gap-2.5 rounded-md font-display text-xl font-semibold tracking-tight text-brand focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
          href="/"
        >
          {site.logo ? <img alt="" className="h-9 w-auto" src={site.logo} /> : <LogoMark />}
          {site.name}
        </Link>
        <nav className="hidden items-center gap-1 md:flex">{items}</nav>
        <details className="group relative md:hidden">
          <summary
            aria-label="Menu"
            className="cursor-pointer list-none rounded-md p-2 text-stone-800 transition-colors hover:bg-brand/5 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
          >
            <svg aria-hidden className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </summary>
          <nav className="absolute end-0 mt-2 grid w-60 gap-1 rounded-xl border border-stone-200 bg-white p-2 shadow-lg">
            {items}
          </nav>
        </details>
      </div>
    </header>
  );
}
