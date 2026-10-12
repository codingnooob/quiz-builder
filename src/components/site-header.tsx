import Link from 'next/link';

import { SignOutButton } from '@/components/sign-out-button';
import { currentSession } from '@/lib/auth';
import { hasShell, site } from '@/lib/site';

const link = 'rounded-md px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900';

// The header every route shares (rendered by layout.tsx): edit the links in `src/lib/site.ts`, restyle it here.
// Nothing until the app has links or accounts, so a one-page app shows only what was asked for.
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
        <SignOutButton className={`${link} text-left`} />
      ) : (
        <>
          <Link className={link} href="/login">
            Sign in
          </Link>
          <Link
            className="rounded-lg bg-brand px-4 py-2 text-center text-sm font-medium text-white shadow-sm transition-colors hover:opacity-90"
            href="/register"
          >
            Get started
          </Link>
        </>
      )}
    </>
  );
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight"
          href="/"
        >
          {/* the user's logo (`logo` in src/lib/site.ts); a logo that already spells the name: drop the text */}
          {site.logo ? <img alt="" className="h-9 w-auto" src={site.logo} /> : null}
          {site.name}
        </Link>
        <nav className="hidden items-center gap-1 md:flex">{items}</nav>
        <details className="relative md:hidden">
          <summary
            aria-label="Menu"
            className="cursor-pointer list-none rounded-md p-2 text-zinc-700 hover:bg-zinc-100 [&::-webkit-details-marker]:hidden"
          >
            <svg
              aria-hidden
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
            >
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </summary>
          <nav className="absolute right-0 mt-2 grid w-56 gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
            {items}
          </nav>
        </details>
      </div>
    </header>
  );
}
