import type { Metadata } from 'next';

import { VerifyEmailForm } from '../account-forms';
import { AuthShell } from '../auth-form';
import { text } from '../text';

export const metadata: Metadata = { title: text.verify.title };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return (
    <AuthShell lead={email ? text.verify.lead(email) : text.verify.leadNoEmail} title={text.verify.title}>
      <VerifyEmailForm email={email} />
    </AuthShell>
  );
}
