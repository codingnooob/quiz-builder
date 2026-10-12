import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from '../account-forms';
import { AuthShell } from '../auth-form';
import { text } from '../text';

export const metadata: Metadata = { title: text.forgot.title };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      footer={
        <Link className="font-medium text-brand hover:underline" href="/login">
          {text.forgot.back}
        </Link>
      }
      lead={text.forgot.lead}
      title={text.forgot.title}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
