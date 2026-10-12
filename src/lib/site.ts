// The app's name and header links, in one place: the header, the footer and every page title read them.
export const site = {
  name: 'New Totalum app',
  description: 'Built with Totalum',
  /** The logo image's URL (the user's file): the header, the footer and the browser icon show it. Empty: the name alone. */
  logo: '',
  /**
   * The app has user accounts: turns on the built-in pages /login, /register, /forgot-password, /verify-email and
   * /account (404 while `false`), and the header shows Sign in / Get started (or Sign out). Set it when the app needs
   * sign-in.
   */
  accounts: false,
  /** Sign-up confirms the e-mail with an 8-digit code before the first sign-in. Only when the owner asks for it. */
  verifyEmail: false,
  /** Staff/members-only app (nothing public): signed-out pages show only the brand; `npm run check` refuses data there. */
  staffOnly: false,
  /**
   * Totalum's bot check on sign-up and sign-in (live site only; invisible to normal visitors). Set `false` only when
   * the owner asks; the lockout and rate limits stay on either way.
   */
  captcha: true,
  /**
   * Paid built-in calls (AI, web, browser, screenshots) one visitor may cause per minute, counted by Totalum per visitor
   * IP on the preview and the live site; over it the call is refused `429 RATE_LIMIT_EXCEEDED`. Raise it only when the
   * owner asks (each call spends their credits); 1–10,000.
   */
  paidCallsPerVisitorPerMinute: 20,
  /** The owner's and staff's addresses for admin pages: one counts only once its account verified the e-mail (`isAdmin`, `@/lib/admin`). */
  admins: [] as string[],
  /** Links everyone sees (landing sections, public pages). */
  nav: [] as { href: string; label: string }[],
  /** Links only signed-in users see (dashboard, lists, admin). */
  appNav: [{ href: '/account', label: 'Account' }] as { href: string; label: string }[],
};

/** The header and footer appear once the app has something to put in them: links or accounts (a one-page "hello" has neither). */
export const hasShell = () => site.accounts || site.nav.length > 0;
