# Document scan / OCR — `totalum.scan` (images and multi-page PDFs)

Reads images (png, jpeg, webp) and PDFs of any number of pages, ≤ 50 MB: text pages, scanned (image-only) pages,
and photos or receipts embedded in a page — the text inside images is read too. Server-side only. Never install
`tesseract.js`, `pdf-parse`, `pdfjs-dist` or an OCR API. Pass the file as exactly one of:
`key` (a file this project stored — private files too), `url` (a stored file's `fileUrl`, or any public https URL).
Pass a stored `key` for long PDFs: it is read in parallel page chunks. An external PDF `url` is one model call and
suits short documents only.

Measured on dev (2026-09-28), `scan.ocr` with a stored key — every page returned, in order:

| PDF | Size | Time | Credits |
|---|---|---|---|
| 100 text pages (4,000 lines, all transcribed) | 0.15 MB | ≈ 56–64 s | ≈ 1.0–1.25 |
| 8 scanned pages (images only) | 2.9 MB | ≈ 13–20 s | ≈ 0.07–0.16 |
| 6 mixed pages (text, scans, a receipt photo, a page of text + photo) | 0.5 MB | ≈ 14–50 s | ≈ 0.06–0.17 |
| 12 high-resolution scans | 45.7 MB | ≈ 43–73 s | ≈ 0.14–0.26 |

A long document takes up to about a minute in one request: call it from a server route (or a background job) and show
a "reading document…" state; never call it on page view. Store files over 25 MB with `totalum.files.getUploadUrl` +
`complete` (the browser uploads straight to storage), then scan the returned `key`.

<!-- totalum-sdk:signatures scan -->
| Call | Returns |
|---|---|
| `totalum.scan.document({ properties, options?, fileName?, key?, url? })` | `{ data, metadata, usage }` |
| `totalum.scan.ocr({ pages?, fileName?, key?, url? })` | `{ pages, text, fullDetails?, usage }` |
<!-- /totalum-sdk:signatures -->

- `ocr` ≈ 0.01 credits a page (0.005–0.02): `pages` is one `{ markdown }` per page, in page order.
- `document` ≈ 0.005 a page: `data` holds the fields you asked for; with
  `options: { processEveryPdfPageAsDifferentScan: true }` it is an array, one field set per page, in order.

`properties` is a JSON-Schema-like object per field: `{ total: { type: 'number', description: 'grand total' },
date: { type: 'string', description: 'YYYY-MM-DD' }, lines: { type: 'array', items: { type: 'object', properties:
{ … } } } }`. A missing field comes back `null`. `options.model: 'scanum-pro'` is the more accurate (slower) model for
hard scans; `options.scanDescription` tells the model what the document is ("a Spanish supplier invoice").

## Recipe — upload a PDF and read every page

```ts
// src/app/api/documents/route.ts
import { totalum } from 'totalum-sdk';
import { currentSession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const file = (await req.formData()).get('file');
  if (!(file instanceof File) || !/^(application\/pdf|image\/)/.test(file.type) || file.size > 50_000_000)
    return Response.json({ ok: false, error: 'A PDF or image up to 50 MB' }, { status: 400 });
  try {
    const stored = await totalum.files.upload(file, { name: file.name, private: true });
    const ocr = await totalum.scan.ocr({ key: stored.key });
    const pages = ocr.pages.map((p, i) => ({ page: i + 1, text: p.markdown }));
    // save stored.key and the pages in your tables here (one row per page if the UI lists pages)
    return Response.json({ ok: true, data: { key: stored.key, pages } });
  } catch (err) {
    console.error('scan failed', err);
    return Response.json({ ok: false, error: 'The document could not be read' }, { status: 502 });
  }
}
```

## Recipe — fields from every page (e.g. each page's total)

```ts
const { data, metadata } = await totalum.scan.document({
  key: stored.key,
  properties: {
    invoiceNumber: { type: 'string' },
    total: { type: 'number', description: 'the total amount on this page' },
  },
  options: { processEveryPdfPageAsDifferentScan: true },
});
const perPage = (data as { invoiceNumber: string | null; total: number | null }[]).map((f, i) => ({
  page: i + 1,
  ...f,
}));
// metadata.pages === perPage.length
```

Without `processEveryPdfPageAsDifferentScan`, `data` is one object for the whole document (the usual choice for a
single invoice or receipt). Keep the OCR text if users search documents later; never re-scan on page view.

Errors: `FILE_NOT_FOUND` (404), `FILE_KEY_FORBIDDEN` (403), `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (not a
PDF or image), `OCR_PDF_PROCESSING_ERROR` / `OCR_IMAGE_PROCESSING_ERROR` / `SCAN_DOCUMENT_ERROR` (502: the model
failed — show a retry), `URL_NOT_ALLOWED` (a private or local URL: upload the file and pass its `key`).
