import { totalum } from 'totalum-sdk';

import { failure } from '@/lib/quiz/errors';
import { MAX_FILE_BYTES } from '@/lib/quiz/types';

const EXTENSIONS = ['pdf', 'docx', 'pptx', 'txt', 'md', 'markdown', 'html', 'htm', 'csv', 'png', 'jpg', 'jpeg', 'webp'];

// Step 1 of a large upload: hand the browser a one-time storage address to PUT the file to.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: unknown; type?: unknown; size?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.slice(0, 200) : '';
  const size = Number(body?.size);
  const type = typeof body?.type === 'string' && body.type ? body.type : 'application/octet-stream';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!name || !Number.isFinite(size) || size <= 0) return Response.json({ ok: false, error: 'Choose a document to upload.' }, { status: 400 });
  if (size > MAX_FILE_BYTES) return Response.json({ ok: false, error: 'The file is too large (50 MB maximum).' }, { status: 413 });
  if (!EXTENSIONS.includes(ext))
    return Response.json({ ok: false, error: 'Unsupported file type. Use PDF, Word (.docx), PowerPoint (.pptx), TXT, Markdown, HTML or an image.' }, { status: 415 });
  try {
    const slot = await totalum.files.getUploadUrl({ name, contentType: type, size, private: true, folder: 'documents' });
    console.log('quiz upload slot', name, size);
    return Response.json({ ok: true, data: { uploadUrl: slot.uploadUrl, key: slot.key, headers: slot.headers } });
  } catch (err) {
    return failure(err, 'Preparing the upload');
  }
}
