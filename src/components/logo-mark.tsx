/** The Quiz Builder mark: a checklist on an ink tile, the ticked row in highlighter yellow. */
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 32 32">
      <rect className="fill-brand" height="32" rx="8" width="32" />
      <rect fill="white" fillOpacity="0.9" height="5" rx="1.4" width="5" x="6.5" y="7" />
      <rect fill="white" fillOpacity="0.9" height="3" rx="1.5" width="11" x="14.5" y="8" />
      <rect className="fill-accent" height="5" rx="1.4" width="5" x="6.5" y="13.5" />
      <path className="stroke-brand" d="m7.6 16.1 1.4 1.4 2-2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
      <rect fill="white" fillOpacity="0.9" height="3" rx="1.5" width="8" x="14.5" y="14.5" />
      <rect fill="white" fillOpacity="0.9" height="5" rx="1.4" width="5" x="6.5" y="20" />
      <rect fill="white" fillOpacity="0.9" height="3" rx="1.5" width="10" x="14.5" y="21" />
    </svg>
  );
}
