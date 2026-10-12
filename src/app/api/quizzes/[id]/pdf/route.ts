import { and, eq } from 'drizzle-orm';
import { totalum } from 'totalum-sdk';

import { db } from '@/db';
import { quizPdfs, quizQuestions, quizSections, quizzes } from '@/db/schema';
import { loadPage } from '@/lib/load-page';
import { failure } from '@/lib/quiz/errors';
import { quizPdfHtml, type PdfSection } from '@/lib/quiz/pdf-html';
import type { QuestionContent } from '@/lib/quiz/types';

// POST { language, kind: 'questions' | 'answers' } → { url }. Each PDF is made once and then reused.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { language?: string; kind?: string } | null;
  const kind = body?.kind === 'answers' ? 'answers' : body?.kind === 'questions' ? 'questions' : null;
  if (!kind || !body?.language) return Response.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  const language = body.language;

  const { data } = await loadPage(() => [
    db.select().from(quizzes).where(eq(quizzes.id, id)),
    db.select().from(quizSections).where(and(eq(quizSections.quizId, id), eq(quizSections.included, true))).orderBy(quizSections.position),
    db.select().from(quizQuestions).where(eq(quizQuestions.quizId, id)).orderBy(quizQuestions.position),
    db.select().from(quizPdfs).where(and(eq(quizPdfs.quizId, id), eq(quizPdfs.language, language), eq(quizPdfs.kind, kind))),
  ]);
  const [quiz] = data[0];
  if (!quiz) return Response.json({ ok: false, error: 'Quiz not found' }, { status: 404 });
  if (!(JSON.parse(quiz.languages) as string[]).includes(language))
    return Response.json({ ok: false, error: 'This quiz was not written in that language.' }, { status: 400 });
  const cached = data[3][0];
  if (cached) return Response.json({ ok: true, data: { url: cached.url } });

  const sections: PdfSection[] = data[1]
    .map((s) => ({
      title: s.title,
      questions: data[2]
        .filter((q) => q.sectionId === s.id)
        .map((q) => ({ difficulty: q.difficulty, correctIndex: q.correctIndex, content: JSON.parse(q.content) as QuestionContent })),
    }))
    .filter((s) => s.questions.length > 0);
  if (sections.length === 0) return Response.json({ ok: false, error: 'This quiz has no questions yet.' }, { status: 409 });

  try {
    const html = quizPdfHtml({ title: quiz.title, language, kind, sections });
    const safe = quiz.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'quiz';
    const pdf = await totalum.pdf.fromHtml({ name: `${safe}-${kind}-${language.toLowerCase()}`, html, options: { format: 'A4', printBackground: true } });
    await db.insert(quizPdfs).values({ id: crypto.randomUUID(), quizId: id, language, kind, url: pdf.url, fileKey: pdf.key }).onConflictDoNothing();
    console.log('quiz pdf', id, kind, language);
    return Response.json({ ok: true, data: { url: pdf.url } });
  } catch (err) {
    return failure(err, 'Creating the PDF');
  }
}
