import { unzipSync, strFromU8 } from 'fflate';
import { totalum } from 'totalum-sdk';

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** Word document: one line per paragraph, headings prefixed with `#` so chapters are easy to find. */
function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('Not a Word document');
  const body = strFromU8(xml);
  const lines: string[] = [];
  for (const p of body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    const heading = /^(?:Heading|Titre|Titulo|Título|Überschrift)\s*(\d)/i.exec(style) ?? (/^Title$/i.test(style) ? ['', '1'] : null);
    let raw = '';
    for (const m of p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) raw += m[1] ?? (m[0] === '<w:tab/>' ? '\t' : ' ');
    const text = decodeEntities(raw).trim();
    if (!text) continue;
    lines.push(heading ? `${'#'.repeat(Math.min(Number(heading[1]) || 1, 4))} ${text}` : text);
  }
  return lines.join('\n');
}

/** PowerPoint: one block per slide. */
function pptxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
  const slides = Object.keys(files).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return slides
    .map((name, i) => {
      const xml = strFromU8(files[name]!);
      const paras = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [])
        .map((p) => decodeEntities((p.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')).trim())
        .filter(Boolean);
      return `# Slide ${i + 1}\n${paras.join('\n')}`;
    })
    .join('\n');
}

function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n${'#'.repeat(Number(l))} ${t.replace(/<[^>]+>/g, '')}\n`)
      .replace(/<\/(p|div|li|tr|br)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

const normalize = (t: string) =>
  t
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export class UnsupportedFileError extends Error {}

/** Plain text of an uploaded document. PDFs and images are read by the built-in scanner (`storedKey` = the stored file). */
export async function extractText(file: File, storedKey: string): Promise<string> {
  const name = file.name.toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  const type = file.type;
  if (ext === 'pdf' || type === 'application/pdf' || /^image\/(png|jpe?g|webp)$/.test(type) || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    const ocr = await totalum.scan.ocr({ key: storedKey });
    return normalize(ocr.pages.map((p: { markdown: string }) => p.markdown).join('\n\n'));
  }
  if (ext === 'docx') return normalize(docxText(new Uint8Array(await file.arrayBuffer())));
  if (ext === 'pptx') return normalize(pptxText(new Uint8Array(await file.arrayBuffer())));
  if (ext === 'html' || ext === 'htm' || type === 'text/html') return normalize(htmlText(await file.text()));
  if (['txt', 'md', 'markdown', 'csv', 'tsv', 'text'].includes(ext) || type.startsWith('text/')) return normalize(await file.text());
  throw new UnsupportedFileError('Unsupported file type. Use PDF, Word (.docx), PowerPoint (.pptx), TXT, Markdown, HTML or an image.');
}
