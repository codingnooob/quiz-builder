# Real-time — `totalum.realtime` + `totalum-sdk/react` (chat, notifications, live counters, presence)

The server publishes, browsers subscribe with a short-lived ticket; the browser never holds a key. Never install
`socket.io`, `pusher`, `ably` or `ws`, and never keep a socket open in a route (Workers cannot).

Each signed-in user listens on their own room `user:<userId>`; the server publishes to it after it saves the change.
Room names: letters, digits, `.`, `_`, `:`, `-`.

<!-- totalum-sdk:signatures realtime -->
| Call | Returns |
|---|---|
| `totalum.realtime.ticket({ room, identity, permissions?, ttl? })` | `{ ticket, url, room, identity, permissions, expiresAt }` |
| `totalum.realtime.publish(room, { data, event?, identity? })` | `{ messageId, at, connections }` |
<!-- /totalum-sdk:signatures -->

```ts
// src/app/api/realtime/ticket/route.ts — a subscribe-only ticket for the caller's own room
import { totalum } from 'totalum-sdk';
import { getAuth } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await getAuth(req).api.getSession({ headers: req.headers });
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { url } = await totalum.realtime.ticket({
    room: `user:${session.user.id}`,
    identity: { id: session.user.id, name: session.user.name },
  });
  return Response.json({ ok: true, data: { url } });
}
```

```ts
// in the route that saves a chat message, a like, a comment, a friend request…
await totalum.realtime.publish(`user:${recipientId}`, { event: 'message.new', data: { conversationId, message } });
```

```tsx
// in a client component of the signed-in layout: POSTs { room } to /api/realtime/ticket, reconnects on its own
'use client';
import { useRealtimeChannel } from 'totalum-sdk/react';

const { messages, status } = useRealtimeChannel(`user:${userId}`); // messages: { id, event, identity, data, ts }[]
```

Update the open conversation, the conversation list, badges and notifications from `messages`, and re-fetch the
current view when `status` returns to `'open'` (Totalum's deploys drop every socket; `'reconnecting'` is normal).

**A shared room** where people talk and see who is online (a chat, a board): the ticket route checks that the user may
join the `room` it receives and adds `permissions: { publish: true }`; the page uses
`useRealtimeChannel(room, { presence: {} })` → `others` (who is here) and `publish(data)` (example:
`src/app/examples/realtime/`). Save every message in the database too: real-time only delivers, it does not store.

**Limits and credits.** A connection may send 120 messages a minute on the Free plan, 600 on Starter (10 a second),
1,200 on Builder, 1,800 on Professional and 3,600 on Enterprise; one more closes its socket with code 4429
(`REALTIME_MESSAGE_RATE_EXCEEDED`). A room is charged credits for each minute it is awake and for each message it
receives, whatever the number of connections: a chat costs almost nothing, a busy game pays for its messages. So send
changes, not every frame (a game: at most 10–20 updates a second per player), and keep one room under about 1,000
messages a second in total: give each match or table its own room.

Errors: `REALTIME_TICKET_EXPIRED` / `REALTIME_TICKET_INVALID` (socket close 4401: a ticket used late or twice —
the hook fetches a new one), `FEATURE_LIMIT_REACHED` (the plan's connections or messages).
