# Connected accounts — `totalum.connections` (any of ~1,500 apps: Google, Microsoft, Slack, HubSpot, Stripe, …)

Your app's users connect **their own** accounts of almost any app — Google Calendar, Gmail, Drive, Sheets, Meet,
Outlook, OneDrive, Teams, Slack, Dropbox, Notion, HubSpot, Salesforce, GitHub, Airtable, Stripe, SendGrid, … — on a
hosted page (they sign in at the provider, or type their own API key there), then your server acts on them and
receives their events (`connections-events.md`). No OAuth app, client id or secret is needed from anyone: never ask
the user for one, never ask for a key in the chat or a form of yours, never install `googleapis`,
`@microsoft/microsoft-graph-client`, `@slack/web-api`, `@hubspot/api-client`, `dropbox`, `@composio/*`, `nango`, and
never build an OAuth flow. Server-side only. (Signing in *to your app* with Google is `../google-sign-in.md`.)

<!-- totalum-sdk:signatures connections -connections.subscribe -connections.subscriptions -connections.unsubscribe -connections.verifyEvent -connections.trigger -connections.triggers -->
| Call | Returns |
|---|---|
| `totalum.connections.connectUrl({ userId, toolkit, returnUrl })` | `string` |
| `totalum.connections.list({ userId, toolkit? })` | `[{ id, toolkit, status: 'expired' \| 'active' \| 'failed' \| 'disabled' \| 'pending', createdAt }]` |
| `totalum.connections.isConnected({ userId, toolkit })` | `boolean` |
| `totalum.connections.disconnect({ userId, id })` | `{ deleted }` |
| `totalum.connections.execute({ userId, action, input?, connectionId? })` | `{ data, usage }` |
| `totalum.connections.actions({ toolkit, search? })` | `[{ slug, toolkit, name, description, inputSchema? }]` |
| `totalum.connections.action(slug)` | `{ slug, toolkit, name, description, inputSchema? }` |
| `totalum.connections.toolkits({ search?, category?, cursor?, limit? })` | `{ toolkits, nextCursor, total }` |
| `totalum.connections.toolkit(slug)` | `{ slug, name, description, categories, authSchemes, connect: 'none' \| 'credentials' \| 'oauth' \| 'unavailable', actionsCount, triggersCount, credentialFields }` |
<!-- /totalum-sdk:signatures -->


- `userId` is **always the signed-in user's id from the session** (`session.user.id`), read on the server — never
  from the request body, a query or a form field. Each user only ever reaches their own connections.
- Costs: reads, lookups and links are free; actions, new connections and events are paid — the price list:
  `curl -s "$TOTALUM_SDK_API_URL/v1/pricing"`.
- `connections.actions({ toolkit })` lists slugs, names and descriptions only (no `inputSchema`): call
  `connections.action(slug)` for the input schema before you write the `execute` call.
- `connections.toolkits()` pages can come back shorter than `limit`: keep paging while `nextCursor` is set; a short
  page is not the end.
- Some actions' own `input` has fields like Gmail's `user_id` — the provider's mailbox id, usually `"me"`. That is not
  Totalum's `userId` (your app's signed-in user), which goes at the top level of `execute({ userId, action, input })`.

## Find the app, the action, its arguments — before writing code (free, from the sandbox)

Never guess a slug or an argument name: look them up. Each lookup is
`curl -s -H "authorization: Bearer $TOTALUM_PROJECT_KEY" "$TOTALUM_SDK_API_URL/v1/connections/…"`:

1. The app: `…/v1/connections/toolkits?search=hubspot` (`&category=crm`, `&cursor=`
   for the next page) → `slug` and `connect`. Then `…/v1/connections/toolkits/<slug>` says it exactly:
   - `oauth`: the user signs in at the provider. `credentials`: the user types their own key on the hosted page
     (`credentialFields` says which; tell them where to find it). `none`: no connection — call `execute` directly.
   - `unavailable`: it cannot be connected (`TOOLKIT_NEEDS_OWN_APP`). Pick another app that does the job, or tell
     the user plainly; never fake it.
2. The action: `…/v1/connections/actions?toolkit=hubspot&search=create%20contact` → `slug` (e.g.
   `HUBSPOT_CREATE_CONTACT`), then `…/v1/connections/actions/HUBSPOT_CREATE_CONTACT` → `inputSchema`: use exactly
   those argument names and required fields.
3. Events: `…/v1/connections/triggers?toolkit=gmail` and `…/v1/connections/triggers/<slug>` (`configSchema`,
   `payloadSchema`) → `connections-events.md`.

## The connect screen — copy these three files

The preview runs inside the Totalum editor (an iframe) and Google refuses to open there, so the sign-in always opens
in a **new tab**: open the tab on the click, then point it at the URL (a tab opened after an `await` is blocked).

```ts
// src/app/connections/actions.ts
'use server';
import { headers } from 'next/headers';
import { totalum } from 'totalum-sdk';
import { currentSession } from '@/lib/auth';

export async function connectUrl(toolkit: string): Promise<{ url?: string; error?: string }> {
  const session = await currentSession();
  if (!session) return { error: 'Sign in first' };
  const origin = (await headers()).get('origin') ?? '';
  try {
    const url = await totalum.connections.connectUrl({
      userId: session.user.id,
      toolkit,
      returnUrl: `${origin}/connections/done`,
    });
    return { url };
  } catch (err) {
    console.error('connect link failed', err);
    return { error: 'Could not start the connection, try again' };
  }
}
```

```tsx
// src/app/connections/connect-button.tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { connectUrl } from './actions';

export function ConnectButton({ toolkit, label }: { toolkit: string; label: string }) {
  const router = useRouter();
  // back from the sign-in tab → re-read the status
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [router]);
  return (
    <button
      type="button"
      onClick={async () => {
        const tab = window.open('', '_blank'); // on the click, or the browser blocks it
        const { url, error } = await connectUrl(toolkit);
        if (url && tab) tab.location.href = url;
        else { tab?.close(); alert(error ?? 'Could not connect'); }
      }}
    >
      {label}
    </button>
  );
}
```

```tsx
// src/app/connections/done/page.tsx — where the sign-in tab lands (public: that tab may have no session)
export default async function Done({ searchParams }: { searchParams: Promise<{ connection?: string }> }) {
  const ok = (await searchParams).connection === 'success';
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold">{ok ? 'Account connected' : 'Connection not completed'}</h1>
      <p className="mt-2">{ok ? 'You can close this tab and go back.' : 'Close this tab and try again.'}</p>
    </main>
  );
}
```

Show it where the feature lives (a server component), so the user connects before using it:

```tsx
const session = await currentSession();
const connected = session
  ? await totalum.connections.isConnected({ userId: session.user.id, toolkit: 'googlecalendar' }).catch(() => false)
  : false;
// connected ? <span>Google Calendar connected ✓</span> : <ConnectButton toolkit="googlecalendar" label="Connect your Google account" />
```

`connectUrl` is valid ≈ 10 minutes: make it on the click, never at render. A disconnect button calls
`totalum.connections.disconnect({ userId: session.user.id, id })` with an `id` from `list()`.

## Recipe — schedule a call: a Google Calendar event with a Google Meet link

The organiser's own Google Calendar gets the event; every attendee e-mail (the client) gets Google's invitation and
the event in **their** calendar, with the same Meet link — the client does not need to connect anything.

```ts
// in a server action / route handler, after saving the call row
const session = await currentSession();
if (!session) return { error: 'Sign in' };
try {
  const { data } = await totalum.connections.execute({
    userId: session.user.id,
    action: 'GOOGLECALENDAR_CREATE_EVENT',
    input: {
      summary: `Call with ${client.name}`,
      description: notes,
      start_datetime: '2026-10-12T10:00:00', // local time, no Z
      timezone: 'Europe/Madrid',             // the user's IANA zone
      event_duration_hour: 0,
      event_duration_minutes: 30,            // 0–59; one hour = event_duration_hour: 1, minutes: 0
      attendees: [client.email],
      create_meeting_room: true,             // the Google Meet link
      send_updates: 'all',                   // e-mails the invitation to the attendees
    },
  });
  const event = (data as { response_data?: { id?: string; htmlLink?: string; hangoutLink?: string } }).response_data;
  // save event?.id, event?.hangoutLink (the Meet URL) and event?.htmlLink on the call row; show the Meet link
} catch (err) {
  if (isTotalumError(err) && err.errorCode === 'CONNECTION_REQUIRED') return { error: 'Connect your Google account first' };
  console.error('calendar event failed', err);
  return { error: 'The event could not be created' };
}
```


## Examples

- **Gmail** (oauth): `execute({ userId, action: 'GMAIL_SEND_EMAIL', input: { recipient_email, subject, body } })`
  — sent from the user's own Gmail.
- **HubSpot CRM** (oauth): `HUBSPOT_CREATE_CONTACT` `{ email, firstname, lastname, company, phone }`; search before
  creating to avoid duplicates (look up the search action as above).
- **SendGrid** (credentials: the user pastes their API key on the hosted page, nothing else changes): the same
  `ConnectButton toolkit="sendgrid"`, then its actions with `execute`. Say on the button where the key is found
  ("SendGrid → Settings → API Keys").
- **No connection** (`connect: 'none'`, e.g. `hackernews`): `execute({ userId, action, input })` with no connect step.

## Errors → fix

| Error code | Meaning | Fix |
|---|---|---|
| `CONNECTION_REQUIRED` (409) | this user has not connected that toolkit (or it expired) | show the `ConnectButton` |
| `CONNECTION_ACTION_FAILED` (422) | the provider refused (wrong argument, missing permission) — `err.message` says why | fix the input; show the message |
| `TOOLKIT_NEEDS_OWN_APP` (400) | that app cannot be connected (`connect: 'unavailable'`) | pick another app or tell the user |
| `TOOLKIT_NOT_AVAILABLE` (400) | unknown app, or one that needs no connection | check the slug; `none` → just `execute` |
| `RECORD_NOT_FOUND` (404) | unknown action/trigger, or an id that is not this user's | look the slug up (above) |
| `PROVIDER_UNAVAILABLE` (503) | the connection service is busy | show "try again in a minute"; never loop |

## Testing in the preview

You cannot sign in to the user's real accounts from the sandbox: build the screen, check `isConnected` answers
`false` for a new user and that the button opens a `https://connect.composio.dev/…` URL (`curl` the server action's route,
or call `connectUrl` from a script), and tell the user to click **Connect your Google account** in the preview to try
it with their own account (for a `credentials` app: with their own key, on that page — never in the chat).
