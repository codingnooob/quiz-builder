'use client';

import { useRouter } from 'next/navigation';

import { signOut } from '@/lib/auth-client';

// The header's Sign out: style it with `className` like the header's other links.
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      className={className}
      onClick={() => {
        void signOut().then(() => {
          router.refresh();
        });
      }}
      type="button"
    >
      Sign out
    </button>
  );
}
