# Files — `totalum.files` (photos, documents, any upload)

Every file lives in this project's storage. Server-side only. Never install `@aws-sdk/*`, `cloudinary`,
`uploadthing` or `multer`, and never write files to disk (Workers have no filesystem).

<!-- totalum-sdk:signatures files -->
| Call | Returns |
|---|---|
| `totalum.files.upload(input, { name?, contentType?, private?, folder? })` | `{ key, fileName, fileSize, contentType, fileUrl, visibility: 'public-by-link' \| 'private', createdAt, etag?, storageClass?: 'Standard' \| 'InfrequentAccess', name?, url?, size?, id?, fileNameId? }` |
| `totalum.files.getUploadUrl({ name, contentType, size, folder?, private? })` | `{ uploadUrl, key, headers, expiresAt }` |
| `totalum.files.complete(key)` | `{ key, fileName, fileSize, contentType, fileUrl, visibility: 'public-by-link' \| 'private', createdAt, etag?, storageClass?: 'Standard' \| 'InfrequentAccess', name?, url?, size?, id?, fileNameId? }` |
| `totalum.files.list({ name?, folder?, type?, createdFrom?, createdTo?, sizeFrom?, sizeTo?, cursor?, limit? })` | `{ items, nextCursor, totalBytes, fileCount }` |
| `totalum.files.get(key)` | `{ key, fileName, fileSize, contentType, fileUrl, visibility: 'public-by-link' \| 'private', createdAt, etag?, storageClass?: 'Standard' \| 'InfrequentAccess', name?, url?, size?, id?, fileNameId? }` |
| `totalum.files.getSignedUrl(key, { expiresInSeconds?, download? })` | `string` |
| `totalum.files.presign(keys, { expiresInSeconds?, download? })` | `Record<string, string>` |
| `totalum.files.delete(keys)` | — |
| `totalum.files.stream(key, { range? })` | `Response` |
| `totalum.files.url(key)` | `string` |
<!-- /totalum-sdk:signatures -->

- `upload` takes a `File`, `Blob`, `Uint8Array` or string, ≤ 25 MB; larger files: `getUploadUrl({ name, contentType,
  size })`, the browser PUTs to `uploadUrl`, then `complete(key)`. Largest file: 50 MB on the Free plan, 500 MB on
  Starter, Builder and Professional, 1 GB on Enterprise (`FILE_TOO_LARGE`, `details.maxBytes`).
- `list` ≤ 100 per page (`cursor` from `nextCursor`); `get` throws `FILE_NOT_FOUND` (404); `getSignedUrl` lasts
  15 min by default, ≤ 604800 s; `stream` returns the bytes of private files too; `delete` takes one key or ≤ 1,000.

**Public vs private.** By default a file is public-by-link: `fileUrl` works in `<img src>` for anyone who has it. With
`private: true` there is no `fileUrl` (`null`); store the `key` and hand out `getSignedUrl(key)` from a route that
checks who may read it. Store the descriptor's `key` and `fileUrl` in your row (`image_key`, `image_url`). A document about a person (a receipt, an invoice, an ID, a contract) is always `private: true`, served by a route that
checks the signed-in user.

## Recipe — photo upload (route handler + client form)

```ts
// src/app/api/uploads/route.ts — also for profile, cover, post and story photos
import { totalum } from 'totalum-sdk';
import { currentSession } from '@/lib/auth';

// photos only: never SVG (it can carry script) or a type the browser did not name; the stored type is the one checked
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) return Response.json({ ok: false, error: 'No file' }, { status: 400 });
  if (!IMAGE_TYPES.includes(file.type) || file.size > 10_000_000)
    return Response.json({ ok: false, error: 'JPEG, PNG, WebP, GIF or AVIF images up to 10 MB' }, { status: 400 });
  try {
    const uploaded = await totalum.files.upload(file, { name: file.name, folder: 'photos', contentType: file.type });
    return Response.json({ ok: true, data: { url: uploaded.fileUrl, key: uploaded.key } });
  } catch (err) {
    console.error('upload failed', err);
    return Response.json({ ok: false, error: 'The upload failed' }, { status: 502 });
  }
}
```

The page posts a `FormData` with `file` (`fetch('/api/uploads', { method: 'POST', body: form })`) and saves
`data.url` in the row (`<img src={url}>`).

## Recipe — a private document download

```ts
// src/app/api/documents/[id]/download/route.ts
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { id } = await params;
  const doc = await loadOwnDocument(session.user.id, id); // your query: WHERE id = ? AND user_id = ?, or null
  if (!doc) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  return Response.redirect(await totalum.files.getSignedUrl(doc.fileKey, { download: true }), 302);
}
```

Deleting a row that owns a file: `await totalum.files.delete(row.fileKey)` after the row is deleted. A file from a URL
(an image the user pastes): accept only `https:` URLs, `fetch` it in the route with `redirect: 'error'`, refuse a
`content-length` over 10 MB or a type outside `IMAGE_TYPES`, then `upload(await res.blob(), { name, contentType })`.

Errors: `FILE_TOO_LARGE` (413; use `getUploadUrl`), `FILE_NOT_FOUND` (404), `FILE_KEY_FORBIDDEN` (403, another
project's key), `UNSUPPORTED_FILE_TYPE`, `UPLOAD_NOT_COMPLETED`, `FEATURE_LIMIT_REACHED` (the plan's storage).
