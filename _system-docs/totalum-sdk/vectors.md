# Vector search — `totalum.vectors` (chat with documents, semantic search, image search)

A private vector store for this project, one per environment (dev and live never mix). Server-side only. Never
install `@pinecone-database/*`, `chromadb`, `@qdrant/*`, `pgvector`, `langchain` vector stores or a Vectorize
binding, and never keep vectors in a table to compare them in code: use this.

<!-- totalum-sdk:signatures vectors -->
| Call | Returns |
|---|---|
| `totalum.vectors.upsert(vectors)` | `{ upserted, count, usage }` |
| `totalum.vectors.query({ text?, values?, image?, space?: 'text' \| 'image', topK?, filter?, includeValues? })` | `{ matches, usage }` |
| `totalum.vectors.get(ids)` | `[{ id, space: 'text' \| 'image', values, metadata? }]` |
| `totalum.vectors.delete(ids)` | `{ count, deleted, usage }` |
| `totalum.vectors.count()` | `{ count, text, image }` |
<!-- /totalum-sdk:signatures -->

- `upsert` ≤ 100 per call (≤ 8 images): text ≈ 0.0002 credits a call, an image ≈ 0.008. `query` ≈ 0.0006 and
  returns `matches: [{ id, score, space, metadata }]`. `get` ≤ 100 ids (unknown ids left out), `delete` ≤ 1,000,
  both ≈ 0; `count` is free.

Storage ≈ 0.6 credits a month per 1,000 vectors. Each vector is exactly one of:

- `text` (≤ 20,000 characters): embedded for you (the `embed` model);
- `image`: a stored file `key`, its `fileUrl`, an https URL or a `data:image/…` URL — embedded by the `embed-image`
  model, which puts images and words in one space (search photos by words with `space: 'image'`);
- `values`: your own 1,024 numbers.

`id`: your id, ≤ 48 printable characters, unique per environment — make it meaningful (`${docId}#p${page}`) so you
can delete a document's vectors later. `metadata`: ≤ 9 KB, keys must not start with `_`. A `filter` works only on the
metadata keys `source`, `type`, `tag`, `group` (strings) and `page` (number): `{ source: docId }`, `{ page: { $gte: 2 } }`,
`{ tag: { $in: ['a', 'b'] } }` (operators `$eq $ne $in $nin $lt $lte $gt $gte`). Put the text you want to show or
cite in metadata (e.g. `excerpt`), or keep it in your table under the same id. `topK` ≤ 50 (default 5).

**A write is stored at once but searchable later.** `upsert` answers once the vector is stored, and `count()` includes
it at once. `query` and `get` read the search index, which takes new vectors in asynchronously: often within seconds,
sometimes **10+ minutes**. A delete is the same: a deleted id can still match for a while, so keep only the matches
whose ids are still in your table. Therefore:

- App code never waits for a write to become searchable: save the row, `upsert`, answer.
- To verify your feature — **also when the user says "make sure search works", on live too** — `upsert`'s `{ upserted, count }` (or `count()`) is the proof the write worked. Run at most one query right after; if
  it finds nothing yet, that is expected, not a bug: never `sleep`, retry or poll for results, never re-run the check
  (every wait is paid and proves nothing). Finish, and tell the owner that new items can take a few minutes to appear
  in search.

## Recipe — chat with my documents (upload → scan → embed → ask with sources)

```ts
// src/app/api/documents/route.ts — upload a PDF and index every page, as its owner's (`group` = the user id)
import { totalum } from 'totalum-sdk';
import { currentSession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const file = (await req.formData()).get('file');
  if (!(file instanceof File) || file.type !== 'application/pdf')
    return Response.json({ ok: false, error: 'A PDF, please' }, { status: 400 });
  try {
    const stored = await totalum.files.upload(file, { name: file.name, private: true });
    const { pages } = await totalum.scan.ocr({ key: stored.key });
    const docId = stored.key.split('/').pop()!.split('.')[0]!; // short and unique
    const chunks = pages
      .map((p, i) => ({ page: i + 1, text: p.markdown.trim() }))
      .filter((c) => c.text.length > 0)
      .map((c) => ({
        id: `${docId}#p${c.page}`,
        text: c.text.slice(0, 20_000),
        metadata: { source: docId, group: session.user.id, page: c.page, name: file.name, excerpt: c.text.slice(0, 2_000) },
      }));
    for (let i = 0; i < chunks.length; i += 100) await totalum.vectors.upsert(chunks.slice(i, i + 100));
    // save { docId, key: stored.key, name: file.name, pages: chunks.length } in your documents table here
    return Response.json({ ok: true, data: { docId, pages: chunks.length } });
  } catch (err) {
    console.error('indexing failed', err);
    return Response.json({ ok: false, error: 'The document could not be indexed' }, { status: 502 });
  }
}
```

```ts
// src/app/api/ask/route.ts — answer from the closest pages of the user's own documents, citing them
import { isTotalumError, totalum } from 'totalum-sdk';
import { currentSession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { question, docId } = (await req.json()) as { question: string; docId?: string };
  try {
    const { matches } = await totalum.vectors.query({
      text: question,
      topK: 5,
      filter: { group: session.user.id, ...(docId ? { source: docId } : {}) },
    });
    const sources = matches.map((m) => ({
      page: Number(m.metadata?.page),
      name: String(m.metadata?.name ?? ''),
      excerpt: String(m.metadata?.excerpt ?? ''),
    }));
    const context = sources.map((s) => `[${s.name}, page ${String(s.page)}]\n${s.excerpt}`).join('\n\n');
    const { text } = await generateText({
      model: model('smart'), // `ai.md`: import { generateText } from 'ai'; import { model } from '@/agents/model'
      system: 'Answer only from the sources. Cite each fact as (name, page N). If the sources do not answer, say so.',
      prompt: `Sources:\n${context}\n\nQuestion: ${question}`,
    });
    return Response.json({ ok: true, data: { answer: text, sources } });
  } catch (err) {
    console.error('ask failed', err);
    const paused = isTotalumError(err) && err.errorCode === 'INSUFFICIENT_CREDITS';
    return Response.json({ ok: false, error: paused ? 'Out of credits' : 'Try again' }, { status: 502 });
  }
}
```

Deleting a document (ids are how you find its vectors again):

```ts
await totalum.vectors.delete(Array.from({ length: pages }, (_, i) => `${docId}#p${String(i + 1)}`));
```

Re-uploading the same id replaces the vector (upsert). Long pages: split them into ~1,500-character chunks with ids
like `doc#p3c2` and the same `page` metadata.

## Recipe — image search by words (and by a similar image)

```ts
// after totalum.files.upload(file, { name }) → stored
await totalum.vectors.upsert([
  { id: `img-${photoId}`, image: stored.key, metadata: { type: 'photo', source: photoId } },
]);

// search: words → the photos that show them
const { matches } = await totalum.vectors.query({ text: 'a dog on the beach', space: 'image', topK: 12 });
// or a similar photo: query({ image: otherKey, topK: 12 })
const photoIds = matches.map((m) => String(m.metadata?.source)); // then load those rows (one query) and show them
```

Text vectors and image vectors are separate spaces: a `text` query without `space: 'image'` never returns images.

Errors: `VALIDATION_ERROR` (400: a bad id, > 100 vectors, a filter on another key, not exactly one of text/values/image),
`FILE_KEY_FORBIDDEN` / `FILE_NOT_FOUND` (an image key that is not this project's), `VECTORS_LIMIT_REACHED` (403: the
plan stores 10,000 / 100,000 / 500,000 / 5M / 20M vectors per environment — delete old ones or upgrade),
`FEATURE_DISABLED` / `FEATURE_LIMIT_REACHED` (the owner capped `vectors`), `INSUFFICIENT_CREDITS` (402),
`PROVIDER_UNAVAILABLE` (503: retry later). Vectors are not in the project export: re-index from your own data (keep
the documents' text or files) after an import.
