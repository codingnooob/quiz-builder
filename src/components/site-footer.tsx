import { hasShell, site } from '@/lib/site';

// The footer every route shares (rendered by layout.tsx): add the business's contact and links here.
export function SiteFooter() {
  if (!hasShell()) return null;
  return (
    <footer className="border-t border-zinc-200 py-10 text-sm text-zinc-600">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
        <p className="flex items-center gap-3">
          {site.logo ? <img alt="" className="h-7 w-auto" src={site.logo} /> : null}©{' '}
          {new Date().getFullYear()} {site.name}
        </p>
      </div>
    </footer>
  );
}
