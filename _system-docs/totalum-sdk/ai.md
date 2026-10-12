# AI in the app: text, chat, streaming, JSON, vision, images, embeddings — OpenRouter through Totalum

Every AI feature of the app uses OpenRouter's API through Totalum's AI gateway: any OpenRouter model, billed in
credits to the project, no key to ask for. `@/agents/model` (server-side only) is the only bridge: `model()`,
`imageModel()` and `embeddingModel()` for the **AI SDK** (`ai`, installed), and `aiFetch(path, body?)` for speech
(`speech.md`), video (`images-video.md`) and rerank. Never a bare model string, `openai`, `@anthropic-ai/sdk`,
`@google/genai`, `@openrouter/sdk` or `langchain`. An agent with tools: `agents.md`. `totalum.*` stays only for
vector search (`vectors.md`) and document scan (`scan.md`).

**Models.** Default to a preset, which Totalum keeps on the best current model of its kind: `fast` (quick, cheap: the
default), `smart` (quality), `reasoning` (hard multi-step), `vision`, `image`, `image-edit`, `embed`, `tts`, `stt`,
`video`. **Never write a model id or name from memory, or from a version the prompt names: both are often old.**
Whenever one goes into the code, the seed or a page (a pinned model, a model picker, a list of models the app offers,
a model the user named), first list the current catalogue — `curl -s "$TOTALUM_AI_BASE_URL/models" -H
"authorization: Bearer $TOTALUM_PROJECT_KEY"`, newest first (`created`) (`/models?output_modalities=speech` with each
model's `supported_voices`, `=transcription`, `=rerank`, `/embeddings/models`, `/images/models`, `/videos/models` with
`supported_durations`/`_resolutions`) — and use only ids from it: per provider the newest version of the family (a
model the user named → its newest version, unless they asked for that exact one), and the cheapest tier that does the
job well (`flash`/`mini`/`lite`/`haiku` before `pro`/`opus`). Keep every model the app uses in one place,
`src/lib/ai-models.ts` (`export const AI_MODELS = { chat: 'fast', image: 'image' }`, a pinned id with its reason in a
comment). Never a `:free` id or `openrouter/auto`; never quote a model's price to the user.

| Need | Call (`import { generateText, … } from 'ai'`) |
|---|---|
| one answer | `generateText({ model: model('fast'), prompt })` → `{ text }` |
| a chat reply, streamed | `streamText({ model: model('fast'), messages })` (the recipe below) |
| JSON | `generateObject({ model: model('smart'), schema: z.object({ … }), prompt })` → `{ object }` |
| classify | `generateObject({ model: model('fast'), output: 'enum', enum: ['spam', 'ok'], prompt })` → `{ object }` |
| vision | `messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'file', mediaType: 'image/jpeg', data: new URL(url) }] }]` |
| image | `generateImage({ model: imageModel('image'), prompt, aspectRatio: '16:9' })` → `{ images: [{ uint8Array, mediaType }] }` |
| edit an image | `generateImage({ model: imageModel('image-edit'), prompt: { text, images: [url or bytes] } })` |
| embeddings | `embedMany({ model: embeddingModel('embed'), values })` → `{ embeddings }` (`embed` for one `value`) |
| rerank | `(await aiFetch('/rerank', { model: 'qwen/qwen3-reranker-8b', query, documents })).json()` → `{ results: [{ index, relevance_score }] }` |

A generated image is bytes: store it once (`totalum.files.upload(new Blob([img.uint8Array as BlobPart], { type: img.mediaType }), { name })`,
`files.md`) and save its `url` and `key` in the row; never regenerate on page view. A stored image's files URL can be
passed to vision or as an image to edit; a private one needs `totalum.files.getSignedUrl(key)` first.

**Failures** throw the AI SDK's `APICallError` (`APICallError.isInstance(err)`, from `ai`; `aiFetch` throws `AiError`
with `status`, `retryAfter`): `err.statusCode` 402 = no credits ("temporarily unavailable"), 429 = too many calls (per
visitor or project; `err.responseHeaders?.['retry-after']` says when) or image/video/speech paused this hour, 403 = the
owner switched AI off or capped it ("not available right now"). Pass `maxRetries: 0` on a
visitor-facing call so a 429 is not retried.

## Recipe — an AI button (route handler + client fetch)

```ts
// src/app/api/customers/[id]/summary/route.ts
import { generateText } from 'ai';
import { model } from '@/agents/model';
import { currentSession } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { id } = await params;
  const customer = await loadCustomer(session.user.id, id); // your Drizzle query: this user's row, or null
  if (!customer) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  try {
    const { text } = await generateText({
      model: model('fast'),
      prompt: `Summarise this customer in two sentences: ${JSON.stringify(customer)}`,
    });
    return Response.json({ ok: true, data: { summary: text } });
  } catch (err) {
    console.error('AI summary failed', err);
    return Response.json({ ok: false, error: 'The summary could not be generated' }, { status: 502 });
  }
}
```

The button (a `'use client'` component) calls `fetch('/api/customers/<id>/summary', { method: 'POST' })` and shows
`data.summary`. Save a result the page shows every time in the database instead of regenerating it.

## Recipe — a streaming chat reply

```ts
// src/app/api/chat/route.ts
import { APICallError, streamText } from 'ai';
import { model } from '@/agents/model';

// public: any visitor may chat, and each message spends credits — keep it short (20 messages, `fast`)
export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: { role: string; content: string }[] };
  // the browser's messages are never 'system': only the server writes the instructions
  const history = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: String(m.content).slice(0, 4_000),
  }));
  const result = streamText({
    model: model('fast'),
    system: 'You are the shop assistant. Be brief.',
    messages: history,
    maxRetries: 0,
    onError: () => {}, // handled below
  });
  // a refusal (429 too many calls, 402 no credits) arrives before any text: answer it with its status
  const parts = result.fullStream[Symbol.asyncIterator]();
  let part = await parts.next();
  while (!part.done && part.value.type !== 'text-delta' && part.value.type !== 'error') part = await parts.next();
  if (!part.done && part.value.type === 'error') {
    const err = part.value.error;
    console.error('chat failed', err);
    const busy = APICallError.isInstance(err) && err.statusCode === 429;
    return new Response(busy ? 'Too many messages — try again in a minute.' : 'The assistant is unavailable.', {
      status: busy ? 429 : 502,
      headers: busy ? { 'retry-after': err.responseHeaders?.['retry-after'] ?? '60' } : {},
    });
  }
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (; !part.done; part = await parts.next())
          if (part.value.type === 'text-delta') controller.enqueue(encoder.encode(part.value.text));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}
```

The client reads it with `const reader = res.body!.getReader()` and appends each `new TextDecoder().decode(value)`
to the last message. Save the finished conversation in the database from the client's next request, not in the stream.

**Per visitor:** Totalum allows each visitor (IP) `site.paidCallsPerVisitorPerMinute` AI, web, browser and screenshot
calls a minute (default 20, `src/lib/site.ts`), on the preview and the live site, so a stranger cannot spend the owner's
credits in a loop; over it the call fails `429` with a `retry-after`. Answer the visitor `429` (the recipe above) and
show "try again in a minute". Raise the number only when the owner asks (e.g. "let each visitor send 60 messages a minute" → `60`).

## Recipe — structured extraction

```ts
import { generateObject } from 'ai';
import { z } from 'zod';
import { model } from '@/agents/model';

const { object: invoice } = await generateObject({
  model: model('smart'),
  schema: z.object({ number: z.string(), vendor: z.string(), total: z.number() }),
  prompt: `Extract the invoice fields from:\n${text}`,
});
```

## Recipe — create and edit images

```ts
// src/app/api/images/route.ts — POST { prompt, sourceUrl? }: a new image, or an edit of a stored one
import { generateImage } from 'ai';
import { totalum } from 'totalum-sdk';
import { imageModel } from '@/agents/model';

const { images } = await generateImage({
  model: imageModel(sourceUrl ? 'image-edit' : 'image'),
  prompt: sourceUrl ? { text: prompt, images: [sourceUrl] } : prompt,
  aspectRatio: '1:1',
});
const img = images[0]!;
const { fileUrl, key } = await totalum.files.upload(new Blob([img.uint8Array as BlobPart], { type: img.mediaType }), {
  name: `ai-${crypto.randomUUID()}.png`,
});
// save fileUrl + key on the row, return fileUrl
```

## Recipe — decisions: classify, route, moderate, grade

A yes/no, pick-one or score question about some input (is this a bug? which team? is this spam? how urgent 1–5?)
uses a decision model, not a chat model: typed answers with probabilities in under a second, at a fraction of the cost.
Questions: `noul` (true/false → `noul` 0–1), `choice` (`criteria` = the options → `choice` + `probabilities`), `score`
(an ordered scale). Branch on the numbers (e.g. `noul > 0.8`); never parse prose.

```ts
import { aiFetch } from '@/agents/model';

const res = await aiFetch('/systemone', {
  model: 'typesafe/jev-1.13',
  state: ticket.body, // a string, or a JSON object of related context
  questions: {
    is_bug: { type: 'noul', instructions: 'Is the customer reporting a bug?', criteria: { true: 'Broken behaviour.', false: 'A question or request.' } },
    team: { type: 'choice', instructions: 'Which team handles it?', criteria: { billing: 'Payments, invoices', auth: 'Sign-in', other: 'Anything else' } },
  },
});
const { answers } = (await res.json()) as { answers: { is_bug: { noul: number }; team: { choice: string } } };
```

## Semantic search, chat with documents, image search

Use `totalum.vectors` (`vectors.md`): it embeds, stores and searches for you. `embedMany` is only for vectors you
compare yourself (a handful of items, e.g. deduplicating two strings).

## Older built-ins

Code calling `totalum.ai.*` or `totalum.speech.*` keeps working; new code uses the gateway as above.
`totalum.ai.gatewayConfig()` gives `{ baseURL, apiKey }` to a library that wants an OpenAI-compatible client.

<!-- totalum-sdk:signatures ai.embed ai.models ai.gatewayConfig -->
| Call | Returns |
|---|---|
| `totalum.ai.embed({ input, model? })` | `{ embeddings, usage }` |
| `totalum.ai.models.list()` | `{ presets, models, denylist? }` |
| `totalum.ai.gatewayConfig()` | `{ baseURL, apiKey }` |
<!-- /totalum-sdk:signatures -->
