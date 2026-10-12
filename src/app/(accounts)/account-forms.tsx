'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { CodeField, Field, fieldOf, Notice, Submit } from './auth-form';
import { text } from './text';

import { button } from '@/components/ui';
import { changePassword, deleteUser, emailOtp, updateUser } from '@/lib/auth-client';

type Answer = { error: { code?: string; message?: string } | null };
const codeError = (a: Answer) =>
  a.error ? (text.codeErrors[a.error.code ?? ''] ?? a.error.message ?? text.failed) : null;

/** "Send a new code", then a 60 s wait before the next one (the live site also limits sends per visitor). */
function Resend({ send, sentFirst }: { send: () => Promise<Answer>; sentFirst: boolean }) {
  const [wait, setWait] = useState(sentFirst ? 60 : 0);
  const [note, setNote] = useState<{ error?: string | null; ok?: string | null }>({});
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => {
      setWait(wait - 1);
    }, 1000);
    return () => {
      clearTimeout(t);
    };
  }, [wait]);
  return (
    <div className="grid gap-2 text-center text-sm">
      <button
        className="font-medium text-brand hover:underline disabled:text-zinc-400 disabled:no-underline"
        disabled={wait > 0}
        onClick={() => {
          setWait(60);
          void send().then((a) => {
            setNote(a.error ? { error: codeError(a) } : { ok: text.resend.sent });
          });
        }}
        type="button"
      >
        {wait > 0 ? text.resend.wait(wait) : sentFirst ? text.resend.again : text.resend.send}
      </button>
      <Notice error={note.error} ok={note.ok} />
    </div>
  );
}

/** Confirms an e-mail with its 8-digit code; then the visitor is signed in (`autoSignInAfterVerification`). */
export function VerifyEmailForm({
  email: known,
  sent = !!known,
  next = '/',
}: {
  email?: string;
  /** the code already went out (sign-up, a refused sign-in) */
  sent?: boolean;
  next?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(known ?? '');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done) return <Notice ok={text.verify.done} />;
  return (
    <div className="grid gap-5">
      <form
        action={async (form) => {
          const answer = await emailOtp.verifyEmail({ email, otp: fieldOf(form, 'code') });
          setError(codeError(answer));
          if (answer.error) return;
          setDone(true);
          router.replace(next);
          router.refresh();
        }}
        className="grid gap-4"
      >
        {!known && (
          <Field
            autoComplete="email"
            label={text.fields.email}
            name="email"
            onChange={(e) => {
              setEmail(e.target.value.trim());
            }}
            required
            type="email"
            value={email}
          />
        )}
        <CodeField />
        <Submit>{text.verify.submit}</Submit>
        <Notice error={error} />
      </form>
      <Resend
        send={() => emailOtp.sendVerificationOtp({ email, type: 'email-verification' })}
        sentFirst={sent}
      />
    </div>
  );
}

/** /forgot-password: the e-mail, then its code with the new password. Every session of the account is signed out. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done)
    return (
      <div className="grid gap-4">
        <Notice ok={text.forgot.done} />
        <Link className={`${button.primary} w-full`} href="/login">
          {text.signIn.submit}
        </Link>
      </div>
    );
  if (email === null)
    return (
      <form
        action={async (form) => {
          const address = fieldOf(form, 'email');
          const answer = await emailOtp.requestPasswordReset({ email: address });
          setError(codeError(answer));
          if (!answer.error) setEmail(address);
        }}
        className="grid gap-4"
      >
        <Field autoComplete="email" label={text.fields.email} name="email" required type="email" />
        <Submit>{text.forgot.sendCode}</Submit>
        <Notice error={error} />
      </form>
    );
  return (
    <div className="grid gap-5">
      <p className="text-sm text-zinc-600">{text.forgot.codeLead(email)}</p>
      <form
        action={async (form) => {
          const answer = await emailOtp.resetPassword({
            email,
            otp: fieldOf(form, 'code'),
            password: fieldOf(form, 'password', false),
          });
          setError(codeError(answer));
          if (!answer.error) setDone(true);
        }}
        className="grid gap-4"
      >
        <CodeField />
        <Field
          autoComplete="new-password"
          hint={text.passwordHint}
          label={text.fields.newPassword}
          maxLength={128}
          minLength={8}
          name="password"
          required
          type="password"
        />
        <Submit>{text.forgot.submit}</Submit>
        <Notice error={error} />
      </form>
      <Resend send={() => emailOtp.requestPasswordReset({ email })} sentFirst />
    </div>
  );
}

const useAnswer = () => {
  const [note, setNote] = useState<{ error?: string | null; ok?: string | null }>({});
  const answered = (a: Answer, ok: string) => {
    setNote(a.error ? { error: codeError(a) } : { ok });
  };
  return [note, answered] as const;
};

export function ProfileForm({ name }: { name: string }) {
  const router = useRouter();
  const [note, answered] = useAnswer();
  return (
    <form
      action={async (form) => {
        const answer = await updateUser({ name: fieldOf(form, 'name') });
        answered(answer, text.account.saved);
        router.refresh();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-0 flex-1 basis-60">
        <Field autoComplete="name" defaultValue={name} label={text.fields.name} name="name" required />
      </div>
      <Submit full={false}>{text.account.save}</Submit>
      <div className="basis-full">
        <Notice error={note.error} ok={note.ok} />
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [note, answered] = useAnswer();
  return (
    <form
      action={async (form) => {
        const answer = await changePassword({
          currentPassword: fieldOf(form, 'current', false),
          newPassword: fieldOf(form, 'password', false),
          revokeOtherSessions: true,
        });
        answered(answer, text.account.passwordChanged);
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <Field
        autoComplete="current-password"
        label={text.fields.currentPassword}
        name="current"
        required
        type="password"
      />
      <Field
        autoComplete="new-password"
        hint={text.passwordHint}
        label={text.fields.newPassword}
        maxLength={128}
        minLength={8}
        name="password"
        required
        type="password"
      />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Submit full={false}>{text.account.changePassword}</Submit>
        <Notice error={note.error} ok={note.ok} />
      </div>
    </form>
  );
}

/** Deletes the account (better-auth `deleteUser`; its sessions and sign-in methods go with it). */
export function DeleteAccountForm({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={async (form) => {
        const answer = await deleteUser(hasPassword ? { password: fieldOf(form, 'password', false) } : {});
        if (answer.error) {
          setError(
            answer.error.code === 'INVALID_PASSWORD'
              ? (answer.error.message ?? text.failed)
              : text.account.deleteFailed,
          );
          return;
        }
        router.replace('/');
        router.refresh();
      }}
      className="grid gap-4"
    >
      <p className="text-sm text-zinc-600">{text.account.dangerLead}</p>
      {hasPassword && (
        <div className="max-w-sm">
          <Field
            autoComplete="current-password"
            label={text.fields.password}
            name="password"
            required
            type="password"
          />
        </div>
      )}
      <div>
        <DeleteButton />
      </div>
      <Notice error={error} />
    </form>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-50"
      disabled={pending}
      type="submit"
    >
      {pending ? text.wait : text.account.deleteConfirm}
    </button>
  );
}
