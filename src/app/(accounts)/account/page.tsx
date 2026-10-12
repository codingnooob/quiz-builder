import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ChangePasswordForm, DeleteAccountForm, ProfileForm, VerifyEmailForm } from '../account-forms';
import { text } from '../text';

import { SignOutButton } from '@/components/sign-out-button';
import { AppPage, Badge, Card, button } from '@/components/ui';
import { db } from '@/db';
import { accounts, sessions } from '@/db/schema';
import { adminEmails } from '@/lib/admin';
import { loadPage } from '@/lib/load-page';

export const metadata: Metadata = { title: text.account.title };

// One round trip per request (research 49): the user, their devices and their sign-in methods in ONE db.batch.
export default async function Account() {
  const { user, data } = await loadPage(
    (me) => [
      db
        .select({ id: sessions.id, userAgent: sessions.userAgent, createdAt: sessions.createdAt })
        .from(sessions)
        .where(eq(sessions.userId, me))
        .orderBy(desc(sessions.createdAt)),
      db.select({ providerId: accounts.providerId }).from(accounts).where(eq(accounts.userId, me)),
    ],
    { signedIn: true },
  );
  if (!user) redirect('/login');
  const [devices, methods] = data;
  const hasPassword = methods.some((m) => m.providerId === 'credential');
  return (
    <AppPage
      action={<SignOutButton className={button.secondary} />}
      description={text.account.signedInWith(methods.map((m) => m.providerId).join(', '))}
      title={user.name || user.email}
    >
      {!user.emailVerified && adminEmails().includes(user.email.toLowerCase()) && (
        <Card title={text.account.adminAccess}>
          <p className="mb-4 text-sm text-zinc-600">{text.account.adminLead(user.email)}</p>
          <VerifyEmailForm email={user.email} next="/account" sent={false} />
        </Card>
      )}
      <Card title={text.account.profile}>
        <div className="grid gap-5">
          <div className="text-sm">
            <p className="font-medium text-zinc-800">{text.fields.email}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 break-all text-zinc-600">
              {user.email}
              <Badge tone={user.emailVerified ? 'green' : 'gray'}>
                {user.emailVerified ? text.account.verified : text.account.unverified}
              </Badge>
            </p>
          </div>
          <ProfileForm name={user.name} />
        </div>
      </Card>
      {hasPassword && (
        <Card title={text.account.password}>
          <ChangePasswordForm />
        </Card>
      )}
      <Card title={text.account.devices}>
        <ul className="grid gap-2 text-sm text-zinc-600">
          {devices.map((d) => (
            <li className="flex flex-wrap justify-between gap-2" key={d.id}>
              <span className="min-w-0 break-words">{d.userAgent ?? text.account.unknownDevice}</span>
              <span className="tabular-nums">{d.createdAt.toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={text.account.danger}>
        <DeleteAccountForm hasPassword={hasPassword} />
      </Card>
    </AppPage>
  );
}
