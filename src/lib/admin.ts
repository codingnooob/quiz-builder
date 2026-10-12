import { site } from '@/lib/site';

// sjfix SJ2: who may use the app's admin or staff pages. Anyone can sign up with any address, so an address alone
// proves nothing: an address counts only once its account has verified the e-mail (the 8-digit code `/account` →
// "Admin access" mails). Never grant a role by comparing `user.email` with an address
// (`npm run check`: ADMIN_BY_UNVERIFIED_EMAIL). A role kept in a table is set by an admin, not at sign-up.
// regate R4: the owner's sign-in e-mail (`TOTALUM_OWNER_EMAIL`, preset, never asked) is always one of them.
export function adminEmails(): string[] {
  const owner = process.env.TOTALUM_OWNER_EMAIL;
  return [...site.admins, ...(owner ? [owner] : [])].map((a) => a.toLowerCase());
}

export function isAdmin(
  user: { email: string; emailVerified?: boolean | null } | null | undefined,
  admins: readonly string[] = adminEmails(),
): boolean {
  if (!user?.emailVerified) return false;
  const email = user.email.toLowerCase();
  return admins.some((a) => a.toLowerCase() === email);
}
