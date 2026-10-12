# Speech — text-to-speech and speech-to-text through OpenRouter (`aiFetch`)

Server-side only, through Totalum's AI gateway (`ai.md`): `aiFetch` from `@/agents/model`, billed in credits per
character spoken and per second transcribed. Never install `elevenlabs`, `@deepgram/sdk` or `openai` for audio.

- **Text-to-speech:** `POST /audio/speech` `{ model, input, voice, response_format: 'mp3' }` → the audio bytes
  (without `response_format` some models answer raw PCM). A voice is required and belongs to its model: keep the
  pair in `src/lib/ai-models.ts`, e.g. `tts: { model: 'microsoft/mai-voice-2.1-flash', voice: 'en-US-Harper:MAI-Voice-2.1-Flash' }`
  (`es-ES-Marta:MAI-Voice-2.1-Flash` for Spanish; other voices: `/models?output_modalities=speech`, `supported_voices`).
- **Speech-to-text:** `POST /audio/transcriptions` `{ model: 'stt', input_audio: { data: base64, format } }` →
  `{ text }`; `format` is the file's extension (`mp3`, `wav`, `webm`, `m4a`, `ogg`, `flac`), audio ≤ 25 MB.

## Recipe — read the page aloud (generated once, stored)

```ts
// src/app/api/posts/[id]/audio/route.ts — POST: the post's audio, made on first use and saved on the row
import { totalum } from 'totalum-sdk';
import { aiFetch } from '@/agents/model';
import { AI_MODELS } from '@/lib/ai-models';

// public: any visitor may listen; the audio is made once per post and stored, so a visitor cannot spend in a loop
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await db.select().from(posts).where(eq(posts.id, id)).get();
  if (!post) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  if (post.audioUrl) return Response.json({ ok: true, data: { url: post.audioUrl } });
  try {
    const res = await aiFetch('/audio/speech', { ...AI_MODELS.tts, input: `${post.title}. ${post.body}`.slice(0, 4_000), response_format: 'mp3' });
    const { fileUrl, key } = await totalum.files.upload(new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' }), {
      name: `post-${id}.mp3`,
    });
    await db.update(posts).set({ audioUrl: fileUrl, audioKey: key }).where(eq(posts.id, id));
    return Response.json({ ok: true, data: { url: fileUrl } });
  } catch (err) {
    console.error('text-to-speech failed', err);
    return Response.json({ ok: false, error: 'The audio could not be generated' }, { status: 502 });
  }
}
```

The page plays it with `<audio src={url} controls />`. Generate it once (on save or the first click), never on every
view; regenerate only when the text changes. Long text: split at sentence ends into ≤ 4,000-character parts.

## Recipe — transcribe a recording from the browser

```ts
// src/app/api/transcribe/route.ts — the client posts FormData with `file` (a MediaRecorder blob named note.webm)
import { Buffer } from 'node:buffer';
import { aiFetch } from '@/agents/model';
import { currentSession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const file = (await req.formData()).get('file');
  if (!(file instanceof File) || file.size > 25_000_000)
    return Response.json({ ok: false, error: 'An audio file up to 25 MB' }, { status: 400 });
  try {
    const res = await aiFetch('/audio/transcriptions', {
      model: 'stt',
      input_audio: { data: Buffer.from(await file.arrayBuffer()).toString('base64'), format: /\.(\w+)$/.exec(file.name)?.[1] ?? 'webm' },
    });
    const { text } = (await res.json()) as { text: string };
    return Response.json({ ok: true, data: { text } });
  } catch (err) {
    console.error('transcription failed', err);
    return Response.json({ ok: false, error: 'Could not transcribe' }, { status: 502 });
  }
}
```

A stored audio file is transcribed by reading its bytes first (`fetch(fileUrl)`, a private one through
`totalum.files.getSignedUrl(key)`). Errors: `AiError` (`ai.md`); 429 with "paused" = image, video and speech are
paused for the rest of the hour after heavy use: show "try again later".

## Older built-in

<!-- totalum-sdk:signatures speech -->
| Call | Returns |
|---|---|
| `totalum.speech.transcribe({ audioBase64?, filename?, url?, language?, model?: 'fast' \| 'accurate', diarize?, timestamps?: 'word' \| 'segment', keyterms? })` | `{ text, durationSec, usage, language?, segments?, words? }` |
| `totalum.speech.synthesize({ text, voice?, language?, model?: 'standard' \| 'premium', format?: 'mp3' \| 'wav' \| 'opus', speed?, store })` | `{ key, url, usage }` |
| `totalum.speech.synthesize({ text, voice?, language?, model?: 'standard' \| 'premium', format?: 'mp3' \| 'wav' \| 'opus', speed?, store? })` | `{ key, url, usage } \| { audio, contentType, usage }` |
<!-- /totalum-sdk:signatures -->

Code that calls these keeps working; new code uses the gateway above.
