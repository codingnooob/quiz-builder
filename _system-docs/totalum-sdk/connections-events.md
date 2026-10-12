# Events from connected accounts — `totalum.connections.subscribe` (new e-mail, new event, new CRM contact, …)

When something happens in a user's connected account (a new Gmail message, a calendar event created, a HubSpot
contact added, a GitHub issue opened), Totalum POSTs the event to a route of **your app**. First the user connects the
app (`connections.md`); then your server subscribes them once. Nobody sets up a webhook: never ask the user for a URL,
never poll the provider instead.

<!-- totalum-sdk:signatures connections.triggers connections.trigger connections.subscribe connections.subscriptions connections.unsubscribe connections.verifyEvent -->
| Call | Returns |
|---|---|
| `totalum.connections.triggers({ toolkit })` | `[{ slug, toolkit, name, description, type, instructions?, configSchema?, payloadSchema? }]` |
| `totalum.connections.trigger(slug)` | `{ slug, toolkit, name, description, type, instructions?, configSchema?, payloadSchema? }` |
| `totalum.connections.subscribe({ userId, trigger, config?, connectionId?, deliverTo? })` | `{ id, trigger, connectionId, config, enabled }` |
| `totalum.connections.subscriptions({ userId })` | `[{ id, trigger, connectionId, config, enabled }]` |
| `totalum.connections.unsubscribe({ userId, id })` | `{ deleted }` |
| `totalum.connections.verifyEvent(rawBody, headers, secret?)` | `{ id, createdAt, projectId, env: 'dev' \| 'live', type, data, livemode? }` |
<!-- /totalum-sdk:signatures -->

1. Find the trigger and its config (free, from the sandbox):
   `curl -s -H "authorization: Bearer $TOTALUM_PROJECT_KEY" "$TOTALUM_SDK_API_URL/v1/connections/triggers?toolkit=gmail"`,
   then `…/v1/connections/triggers/GMAIL_NEW_GMAIL_MESSAGE` → `configSchema` (what `config` takes; most fields have
   defaults) and `payloadSchema` (what `data.payload` holds). `type: 'poll'` triggers are checked every few minutes,
   `webhook` ones arrive at once. A trigger whose config asks for a developer key or app id (e.g. HubSpot's
   `developer_api_key`) cannot be used: poll with an action on a schedule (`cron.md`) instead.
2. Subscribe right after the user connects (e.g. on the page they return to, or the first time the feature loads),
   once per user — `subscribe` is idempotent for the same config:

```ts
// server action, after the user connected Gmail
const session = await currentSession();
if (!session) return { error: 'Sign in' };
await totalum.connections.subscribe({
  userId: session.user.id,
  trigger: 'GMAIL_NEW_GMAIL_MESSAGE',
  config: { labelIds: 'INBOX' },
  // deliverTo: '/api/webhooks/connections' (the default; any path of this app)
});
```

3. Receive the events: `src/app/api/webhooks/connections/route.ts` (POST, public — no session: the signature is the
   proof). Dev users' events reach the preview, live users' events the published site, signed with
   `TOTALUM_WEBHOOK_SECRET`, which Totalum sets everywhere: never ask the user for it, never pass it.

```ts
// src/app/api/webhooks/connections/route.ts
import { totalum } from 'totalum-sdk';

export async function POST(req: Request) {
  let event;
  try {
    event = await totalum.connections.verifyEvent(await req.text(), req.headers);
  } catch {
    return new Response('bad signature', { status: 401 });
  }
  const { trigger, userId, payload } = event.data; // userId = your user who subscribed
  if (trigger === 'GMAIL_NEW_GMAIL_MESSAGE') {
    const m = payload as { message_id?: string; sender?: string; subject?: string; message_text?: string };
    // save it for userId (ignore a message_id you already have: a retry may repeat an event)
  }
  return Response.json({ ok: true }); // 2xx fast, also for triggers you ignore; anything else is retried
}
```

`event.id` is unique per event: store it (or the provider's id in `payload`) to ignore a repeat. Do slow work after
saving (the queue retries a delivery that takes over 10 s). Each delivered event is paid (price list:
`curl -s "$TOTALUM_SDK_API_URL/v1/pricing"`): subscribe only to what the feature needs, and `unsubscribe({ userId,
id })` when the user turns it off or disconnects.

Common triggers: `GMAIL_NEW_GMAIL_MESSAGE`, `GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER`,
`GOOGLECALENDAR_EVENT_STARTING_SOON_TRIGGER`, `SLACK_CHANNEL_MESSAGE_RECEIVED`, `GITHUB_ISSUE_ADDED_EVENT` — look each one up
before using it (step 1).

## Errors → fix

| Error code | Meaning | Fix |
|---|---|---|
| `CONNECTION_REQUIRED` (409) | the user has not connected that app | show the `ConnectButton` (`connections.md`) |
| `CONNECTION_ACTION_FAILED` (422) | the provider refused the subscription (bad `config`) — `err.message` says why | fix `config` with `configSchema` |
| `RECORD_NOT_FOUND` (404) | unknown trigger, or a subscription id that is not this user's | look the slug up (step 1) |

## Testing in the preview

No real account can be connected from the sandbox: build the subscribe call and the route, check the route answers
401 to an unsigned POST, and tell the user to connect their account in the preview — events then arrive on their own.
