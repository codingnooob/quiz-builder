import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts, sessions } from '@/db/schema';
import { loadPage } from '@/lib/load-page';

// One round trip per request (research 49): the user, their devices and their sign-in methods in ONE db.batch.
export async function GET() {
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
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const [devices, methods] = data;
  return Response.json({ user, devices, methods });
}
