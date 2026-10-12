import { isTotalumError, totalum } from 'totalum-sdk';

// The real-time example's server half (plan 06 §12.5, A6.33), built only with NEXT_PUBLIC_TOTALUM_REALTIME_EXAMPLES=1:
// the app's server mints a short-lived room ticket with its project key; the browser only ever receives the ticket. A
// real app authorises its own user here first, passes that user as `identity` and checks the room belongs to them.
export async function POST(request: Request) {
  const { room = 'example:chat' } = (await request.json().catch(() => ({}))) as { room?: string };
  if (!room.startsWith('example:')) return new Response(null, { status: 403 });
  try {
    const ticket = await totalum.realtime.ticket({
      room,
      identity: { id: `guest-${crypto.randomUUID().slice(0, 8)}` },
      permissions: { publish: true },
    });
    return Response.json({ data: ticket });
  } catch (err) {
    console.error('realtime ticket failed', err);
    return Response.json({ error: isTotalumError(err) ? err.errorCode : 'UNKNOWN' }, { status: 502 });
  }
}
