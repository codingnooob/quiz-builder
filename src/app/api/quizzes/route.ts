import { totalum } from 'totalum-sdk';

import { db } from '@/db';
import { quizSections, quizzes } from '@/db/schema';
import { failure } from '@/lib/quiz/errors';
import { extractText, UnsupportedFileError, type DocumentSource } from '@/lib/quiz/extract';
import { splitIntoSections } from '@/lib/quiz/split';
import { MAX_FILE_BYTES, MAX_SECTIONS, MAX_TEXT_CHARS } from '@/lib/quiz/types';

// Public tool: anyone may upload a document; the quiz is reached by its random id. Each upload spends a document scan
// and a model call, which the platform rate-limits per visitor.
type Source = { name: string; size: number; type: string; key: string; doc: DocumentSource };

// Small files arrive as multipart form data; large ones are PUT by the browser straight to storage and arrive as { key }.
async function readRequest(req: Request): Promise<{ source: Source; wanted: number | null } | Response> {
  const parseWanted = (raw: unknown) => {
    const n = Number(raw || 0);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_SECTIONS) : null;
  };
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const body = (await req.json().catch(() => null)) as { key?: unknown; sections?: unknown } | null;
    const key = typeof body?.key === 'string' ? body.key : '';
    if (!key)
      return Response.json({ ok: false, error: 'Choose a document to upload.' }, { status: 400 });
    let info;
    try {
      info = await totalum.files.complete(key);
    } catch (err) {
      return failure(err, 'Receiving the document');
    }
    if (info.fileSize > MAX_FILE_BYTES) {
      await totalum.files.delete(key).catch(() => null);
      return Response.json({ ok: false, error: 'The file is too large (50 MB maximum).' }, { status: 413 });
    }
    const name = info.fileName || 'document';
    const fetchBytes = async () => {
      const res = await totalum.files.stream(key);
      return res.arrayBuffer();
    };
    const doc: DocumentSource = {
      name,
      type: info.contentType ?? '',
      arrayBuffer: fetchBytes,
      text: async () => new TextDecoder().decode(await fetchBytes()),
    };
    return { source: { name, size: info.fileSize, type: doc.type, key, doc }, wanted: parseWanted(body?.sections) };
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: 'Choose a document to upload.' }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ ok: false, error: 'The file is too large (50 MB maximum).' }, { status: 413 });
  try {
    const key = (await totalum.files.upload(file, { name: file.name, private: true, folder: 'documents' })).key;
    return { source: { name: file.name, size: file.size, type: file.type, key, doc: file }, wanted: parseWanted(form?.get('sections')) };
  } catch (err) {
    return failure(err, 'Uploading the document');
  }
}

// Public tool: anyone may upload a document; the quiz is reached by its random id. Each upload spends a document scan
// and a model call, which the platform rate-limits per visitor.
export async function POST(req: Request) {
  const read = await readRequest(req);
  if (read instanceof Response) return read;
  const { source, wanted } = read;
  const { key } = source;
  const file = { name: source.name };
  console.log('quiz upload', source.name, source.size, 'sections', wanted);

  let text: string;
  try {
    text = await extractText(source.doc, key);
  } catch (err) {
    if (err instanceof UnsupportedFileError) return Response.json({ ok: false, error: err.message }, { status: 415 });
    return failure(err, 'Reading the document');
  }
  if (text.replace(/\s/g, '').length < 80)
    return Response.json({ ok: false, error: 'No readable text was found in this document.' }, { status: 422 });
  const truncated = text.length > MAX_TEXT_CHARS;
  if (truncated) text = text.slice(0, MAX_TEXT_CHARS);

  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 120) || 'Untitled document';
  let sections;
  try {
    sections = await splitIntoSections(text, title, wanted);
  } catch (err) {
    return failure(err, 'Splitting the document into chapters');
  }

  const id = crypto.randomUUID();
  await db.batch([
    db.insert(quizzes).values({ id, title, fileName: file.name.slice(0, 200), fileKey: key, truncated }),
    ...sections.map((s, i) =>
      db.insert(quizSections).values({ id: crypto.randomUUID(), quizId: id, position: i, title: s.title, content: s.content }),
    ),
  ]);
  console.log('quiz created', id, 'sections', sections.length, 'chars', text.length);
  return Response.json({ ok: true, data: { id, title, sections: sections.length } });
}
