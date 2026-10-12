# AI video, and design images while building — OpenRouter through Totalum

An app feature that creates or edits images uses `generateImage` (`ai.md`). This file: video (`aiFetch` from
`@/agents/model`, OpenRouter's video API through Totalum's gateway, billed in credits per second of video) and the
design images you generate once while building. Server-side only. Store every image and video as a file of this
project and save its `url` and `key` in the row; never regenerate on page view. Never install `replicate`, `@fal-ai/*`
or an OpenAI/Google SDK.

## A design image while building (hero, placeholder)

Run `totalum.ai.image.generate({ prompt, resolution: '1K', aspectRatio: '16:9' })` once from `scripts/<name>.ts`
(`npx tsx scripts/<name>.ts`): it stores the image; put the printed `images[0].url` in the code. (Build time only: an
app feature uses `generateImage`.)

## Video — a job: start it, then poll

`POST /videos` `{ model, prompt, duration, resolution, aspect_ratio?, generate_audio? }` → `{ id, status }`;
`GET /videos/{id}` → `status` `pending | in_progress | completed | failed` (`error`), and once completed
`unsigned_urls`; `GET /videos/{id}/content?index=0` → the MP4 bytes. Default `model: 'video'`, `resolution: '480p'`,
`duration: 5`, `generate_audio: false` unless the user asks for HD, longer or sound (each costs more); another model
must support the values (`/videos/models`: `supported_durations`, `supported_resolutions`, `supported_aspect_ratios`).
A clip takes 30 s to a few minutes. Start it on a user action, save the job, and let the page poll a route that reads
it; the route stores the clip once it is completed. On Free and Starter a few long HD clips in one hour reach the
plan's hourly spend safety limit: from half of it image, video and speech calls are refused (429, "paused") until the
hour ends, and at the limit the project is paused.

```ts
// src/app/api/videos/route.ts — POST { prompt } starts a job and saves it
import { aiFetch } from '@/agents/model';

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { prompt } = (await req.json()) as { prompt: string };
  try {
    const res = await aiFetch('/videos', { model: 'video', prompt: String(prompt).slice(0, 2_000), duration: 5, resolution: '480p', generate_audio: false });
    const job = (await res.json()) as { id: string };
    await db.insert(videos).values({ id: job.id, userId: session.user.id, prompt, status: 'pending', createdAt: new Date().toISOString() });
    return Response.json({ ok: true, data: { id: job.id } });
  } catch (err) {
    console.error('video failed', err);
    return Response.json({ ok: false, error: 'The video could not be started' }, { status: 502 });
  }
}

// src/app/api/videos/[id]/route.ts — POST refreshes one job (the page calls it every 5 s until done)
import { totalum } from 'totalum-sdk';
import { aiFetch } from '@/agents/model';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { id } = await params;
  const row = await db.select().from(videos).where(and(eq(videos.id, id), eq(videos.userId, session.user.id))).get();
  if (!row) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  if (row.status === 'completed' || row.status === 'failed') return Response.json({ ok: true, data: row });
  try {
    const job = (await (await aiFetch(`/videos/${id}`)).json()) as { status: string; error?: string };
    let url: string | null = null;
    if (job.status === 'completed') {
      const clip = await aiFetch(`/videos/${id}/content?index=0`);
      ({ fileUrl: url } = await totalum.files.upload(new Blob([await clip.arrayBuffer()], { type: 'video/mp4' }), { name: `video-${id}.mp4` }));
    }
    const [saved] = await db.update(videos).set({ status: job.status, url, error: job.error ?? null }).where(eq(videos.id, id)).returning();
    return Response.json({ ok: true, data: saved });
  } catch (err) {
    console.error('video poll failed', err);
    return Response.json({ ok: false, error: 'Could not read the video' }, { status: 502 });
  }
}
```

The page shows a progress state while `status` is `pending`/`in_progress` and `<video src={url} controls />` once
`completed`; `failed` shows the error and a retry button (a failed job costs nothing). Never loop in the server
waiting for it. Errors: `AiError` (`ai.md`).

## Older built-in

<!-- totalum-sdk:signatures ai.image ai.video -ai.video.wait -->
| Call | Returns |
|---|---|
| `totalum.ai.image.generate({ prompt, model?, aspectRatio?, resolution?: '1K' \| '2K' \| '4K' \| '512', quality?, outputFormat?: 'png' \| 'jpeg' \| 'webp', background?, n?, references?, fileName?, store? })` | `{ images, usage, fileName?, imageUrl? }` |
| `totalum.ai.image.edit({ prompt, images, mask?, fileName?, size?, quality?, outputFormat?: 'png' \| 'jpeg' \| 'webp', background?, inputFidelity? })` | `{ images, usage, fileName?, imageUrl? }` |
| `totalum.ai.video.generate({ prompt, durationSec, model?, resolution?, aspectRatio?, firstFrame?, lastFrame?, references?, generateAudio?, seed? })` | `{ jobId, status, estimatedCredits }` |
| `totalum.ai.video.get(jobId)` | `{ jobId, status: 'expired' \| 'completed' \| 'queued' \| 'running' \| 'failed' \| 'cancelled', progress?, video?, usage?, error? }` |
<!-- /totalum-sdk:signatures -->

Code that calls these keeps working (`ai.video.wait()` is for scripts only, `NODE_ONLY` in the app); new code uses
the gateway above.
