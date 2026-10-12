import type { ReactNode } from 'react';

// The app-page pieces every dashboard, list, admin and detail page uses (_system-docs/design.md §3–4). They read the
// project's tokens (bg-brand, font-display), so a new look in globals.css restyles every page at once.

export const button = {
  primary:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50',
};
export const input =
  'mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20';

/** An app page: the soft surface, the title row (title, one line, the main action), then the content. */
export function AppPage(props: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[70dvh] bg-zinc-50">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{props.title}</h1>
            {props.description && <p className="mt-1 text-zinc-600">{props.description}</p>}
          </div>
          {props.action}
        </div>
        <div className="mt-8 grid gap-6">{props.children}</div>
      </main>
    </div>
  );
}

/** A white card; `title` (with `action` on its right) gives it a header row. */
export function Card(props: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-zinc-200 bg-white shadow-sm ${props.className ?? ''}`}
    >
      {props.title && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-6">
          <h2 className="font-medium">{props.title}</h2>
          {props.action}
        </div>
      )}
      <div className="p-4 sm:p-6">{props.children}</div>
    </section>
  );
}

/** One figure of a dashboard: put 2–4 in `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`. */
export function Stat(props: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-zinc-500">{props.label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{props.value}</p>
      {props.hint && <p className="mt-1 text-sm text-zinc-500">{props.hint}</p>}
    </div>
  );
}

const tones = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  gray: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20',
};
/** A status pill: green = done/paid, amber = pending, red = overdue/failed, blue = new/in progress, gray = draft. */
export function Badge(props: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[props.tone ?? 'gray']}`}
    >
      {props.children}
    </span>
  );
}

/** What an empty list or a first-run dashboard shows: a title, one line of help and the action that fills it. */
export function EmptyState(props: { title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className="rounded-full bg-brand/10 p-3 text-brand">
        <svg
          aria-hidden
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
        >
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-4 font-medium">{props.title}</p>
      {props.text && <p className="mt-1 max-w-sm text-sm text-zinc-600">{props.text}</p>}
      {props.action && <div className="mt-5">{props.action}</div>}
    </div>
  );
}
