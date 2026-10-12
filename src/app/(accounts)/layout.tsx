import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { site } from '@/lib/site';

// The built-in account pages (/login, /register, /verify-email, /forgot-password, /account) exist only in an app with
// user accounts: `accounts: true` in src/lib/site.ts. Without it every one of them answers 404.
export default function AccountsLayout({ children }: { children: ReactNode }) {
  if (!site.accounts) notFound();
  return children;
}
