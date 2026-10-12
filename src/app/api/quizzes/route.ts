import { totalum } from 'totalum-sdk';

import { db } from '@/db';
import { quizSections, quizzes } from '@/db/schema';
import { failure } from '@/lib/quiz/errors';
import { extractText, UnsupportedFileError } from '@/lib/quiz/extract';
import { splitIntoSections } from '@/lib/quiz/split';
import { MAX_FILE_BYTES, MAX_SECTIONS, MAX_TEXT_CHARS } from '@/lib/quiz/types';

// Public tool: anyone may upload a document; the quiz is reached by its random id. Each upload spends a document scan
// and a model call, which the platform rate-limits per visitor.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: 'Choose a document to upload.' }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ ok: false, error: 'The file is too large (25 MB maximum).' }, { status: 413 });
  const wantedRaw = Number(form?.get('sections') || 0);
  const wanted = Number.isInteger(wantedRaw) && wantedRaw >= 1 ? Math.min(wantedRaw, MAX_SECTIONS) : null;
  console.log('quiz upload', file.name, file.size, 'sections', wanted);

  let key: string;
  try {
    key = (await totalum.files.upload(file, { name: file.name, private: true, folder: 'documents' })).key;
  } catch (err) {
    return failure(err, 'Uploading the document');
  }

  let text: string;
  try {
    text = await extractText(file, key);
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
