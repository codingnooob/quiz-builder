'use client';

import { useState } from 'react';
import { useRealtimeChannel } from 'totalum-sdk/react';

// The real-time example (plan 06 §12.5, A6.33): a chat with presence on one room. Built only when
// NEXT_PUBLIC_TOTALUM_REALTIME_EXAMPLES=1 (next.config.ts), so it is not in an app's bundle otherwise. The ticket comes
// from api/realtime/ticket; a real app's route decides there who may join which room.
export default function RealtimeExample() {
  const { status, messages, others, publish } = useRealtimeChannel('example:chat', { presence: {} });
  const [text, setText] = useState('');
  return (
    <main className="mx-auto max-w-md px-6 py-[10vh]">
      <h1 className="text-2xl font-semibold">Real-time room</h1>
      <p className="mt-2 text-sm text-zinc-600">
        {status} · {others.length} other{others.length === 1 ? '' : 's'} here
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          publish(text);
          setText('');
        }}
      >
        <input
          className="flex-1 rounded border px-2 py-1"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          aria-label="message"
        />
        <button type="submit">Send</button>
      </form>
      <ul className="mt-4 space-y-1 text-sm">
        {messages.map((m) => (
          <li key={m.id}>
            <b>{m.identity.id}</b>: {String(m.data)}
          </li>
        ))}
      </ul>
    </main>
  );
}
