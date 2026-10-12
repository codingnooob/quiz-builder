'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { text } from './text';

import { input } from '@/components/ui';
import { signIn, signUp } from '@/lib/auth-client';
import { captchaHeaders, getChallenge, type Challenge } from '@/lib/captcha-client';
import { site } from '@/lib/site';

// The account pages' pieces (sign-in, sign-up, codes, reset, account), styled with the project's tokens (bg-brand, the
// fonts in @theme), so they match whatever look the project picks. Words: ./text.ts.

/** The centred card every signed-out account page uses: the logo, a heading, one line, the form, a footer line. */
export function AuthShell(props: {
  title: string;
  lead: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-[80dvh] items-center justify-center bg-linear-to-b from-brand/10 to-transparent px-4 py-16">
      <div className="w-full max-w-sm">
        {site.logo ? <img alt={site.name} className="mx-auto mb-6 h-10 w-auto" src={site.logo} /> : null}
        <h1 className="text-center font-display text-2xl font-semibold tracking-tight">{props.title}</h1>
        <p className="mt-2 text-center text-sm text-zinc-600">{props.lead}</p>
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          {props.children}
        </div>
        {props.footer && <p className="mt-6 text-center text-sm text-zinc-600">{props.footer}</p>}
      </div>
    </main>
  );
}

export function Field({
  label,
  hint,
  ...props
}: { label: ReactNode; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm font-medium text-zinc-800">
      {label}
      <input className={input} {...props} />
      {hint && <span className="mt-1 block text-xs font-normal text-zinc-500">{hint}</span>}
    </label>
  );
}

/** The 8-digit code field: numeric keyboard on phones, the browser's one-time-code autofill. */
export function CodeField() {
  return (
    <Field
      autoComplete="one-time-code"
      className={`${input} text-center font-mono text-2xl tracking-[0.4em]`}
      inputMode="numeric"
      label={text.fields.code}
      maxLength={8}
      minLength={8}
      name="code"
      pattern="[0-9]{8}"
      required
    />
  );
}

export function Submit({ children, full = true }: { children: string; full?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`${full ? 'mt-2 w-full' : ''} rounded-lg bg-brand px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50`}
      disabled={pending}
      type="submit"
    >
      {pending ? text.wait : children}
    </button>
  );
}

/** A form's answer: an error (red, `role="alert"`) or a success (green, `role="status"`). */
export function Notice({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error)
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
        {error}
      </p>
    );
  if (ok)
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
        {ok}
      </p>
    );
  return null;
}

/** A form field's text, trimmed (`trim = false` for a password). */
export const fieldOf = (form: FormData, name: string, trim = true) => {
  const value = form.get(name);
  return typeof value !== 'string' ? '' : trim ? value.trim() : value;
};
const linkClass = 'font-medium text-brand hover:underline';

// better-auth sends a failed Google sign-in back here with `?error=<code>`
const GOOGLE_ERRORS: Record<string, string> = { account_not_linked: text.googleNotLinked };

/** "Continue with Google" (src/lib/auth.ts `googleClient`, shown only when the project has the Google secrets). */
function GoogleButton({ errorPath }: { errorPath: string }) {
  return (
    <button
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-brand/40"
      onClick={() => {
        // Google's page never opens inside a frame (Totalum's preview panel): continue in a tab of its own
        if (window.top !== window.self) window.open(window.location.href, '_blank', 'noopener');
        else void signIn.social({ provider: 'google', callbackURL: '/', errorCallbackURL: errorPath });
      }}
      type="button"
    >
      <svg aria-hidden className="size-5" viewBox="0 0 48 48">
        <path
          d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
          fill="#FFC107"
        />
        <path
          d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
          fill="#FF3D00"
        />
        <path
          d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
          fill="#4CAF50"
        />
        <path
          d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
          fill="#1976D2"
        />
      </svg>
      {text.google}
    </button>
  );
}

export function AuthForm({ mode, google = false }: { mode: 'sign-in' | 'sign-up'; google?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  // kept by React, so a refused try does not empty them (a form action resets its uncontrolled fields)
  const [typed, setTyped] = useState({ name: '', email: '' });
  const keep = (name: 'name' | 'email') => ({
    name,
    value: typed[name],
    onChange: (e: { target: { value: string } }) => {
      setTyped({ ...typed, [name]: e.target.value });
    },
  });
  // Totalum's captcha (live only, src/lib/captcha.ts): a single-use challenge per try, fetched ahead of time;
  // undefined = not fetched yet, null = no captcha here
  const challenge = useRef<Promise<Challenge | null>>(undefined);
  useEffect(() => {
    challenge.current = getChallenge();
    const failed = new URLSearchParams(window.location.search).get('error');
    if (failed) setError(GOOGLE_ERRORS[failed] ?? text.googleFailed);
  }, []);
  const signingUp = mode === 'sign-up';
  const words = signingUp ? text.signUp : text.signIn;

  async function submit(form: FormData) {
    const email = fieldOf(form, 'email');
    const send = async (c: Challenge | null) => {
      const credentials = {
        email,
        password: fieldOf(form, 'password', false),
        fetchOptions: c ? { headers: await captchaHeaders(c, fieldOf(form, 'website')) } : undefined,
      };
      return signingUp
        ? signUp.email({ ...credentials, name: fieldOf(form, 'name') })
        : signIn.email(credentials);
    };
    let c = await (challenge.current ?? getChallenge());
    if (c && Date.now() - c.at > 4 * 60_000) c = await getChallenge();
    let { data, error } = await send(c);
    // the visitor looked unusual: the answer carries a proof-of-work challenge, solved in a Web Worker
    if (error?.code === 'CHALLENGE_REQUIRED' && c) {
      setVerifying(true);
      const harder = error as unknown as Omit<Challenge, 'at'>;
      ({ data, error } = await send({ challenge: harder.challenge, difficulty: harder.difficulty, at: 0 }));
      setVerifying(false);
    }
    // `site.verifyEmail`: a new account (no session yet) or an unconfirmed one confirms its code first
    if ((!error && !data?.token) || error?.code === 'EMAIL_NOT_VERIFIED') {
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      return;
    }
    if (error) {
      setError(error.message ?? text.failed);
      challenge.current = c ? getChallenge() : Promise.resolve(null);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <AuthShell
      footer={
        <>
          {words.other}{' '}
          <Link className={linkClass} href={signingUp ? '/login' : '/register'}>
            {words.otherLink}
          </Link>
        </>
      }
      lead={words.lead}
      title={words.title}
    >
      {google && (
        <div className="mb-6">
          <GoogleButton errorPath={signingUp ? '/register' : '/login'} />
          <p className="mt-4 text-center text-xs text-zinc-500">{text.orEmail}</p>
        </div>
      )}
      <form action={submit} className="grid gap-4">
        {signingUp && <Field autoComplete="name" label={text.fields.name} required {...keep('name')} />}
        <Field autoComplete="email" label={text.fields.email} required type="email" {...keep('email')} />
        <Field
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          hint={signingUp ? text.passwordHint : undefined}
          label={
            signingUp ? (
              text.fields.password
            ) : (
              <span className="flex items-center justify-between">
                {text.fields.password}
                <Link className={`${linkClass} text-xs`} href="/forgot-password">
                  {text.signIn.forgot}
                </Link>
              </span>
            )
          }
          maxLength={128}
          minLength={8}
          name="password"
          required
          type="password"
        />
        {/* a honeypot: hidden from people, filled by naive bots (the captcha refuses it) */}
        <input
          aria-hidden
          autoComplete="off"
          className="absolute -left-[9999px] h-px w-px"
          name="website"
          tabIndex={-1}
        />
        <Submit>{words.submit}</Submit>
        {verifying && (
          <p className="text-center text-sm text-zinc-600" role="status">
            {text.verifyingHuman}
          </p>
        )}
        <Notice error={error} />
      </form>
    </AuthShell>
  );
}
