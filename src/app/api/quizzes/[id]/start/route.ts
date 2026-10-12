import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { quizQuestions, quizSections, quizzes } from '@/db/schema';
import { loadPage } from '@/lib/load-page';
import {
  allocateQuestions,
  cleanLanguages,
  COUNT_MODES,
  DIFFICULTIES,
  MAX_PER_SECTION,
  MAX_TOTAL,
  type CountMode,
  type Difficulty,
} from '@/lib/quiz/types';

// Saves the quiz settings and the chapters the visitor kept, and says how many questions each chapter gets.
// The client then calls /sections/<id>/generate once per chapter.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    sections?: { id?: string; title?: string; included?: boolean }[];
    countMode?: string;
    count?: number;
    difficulty?: string;
    languages?: unknown;
  } | null;
  if (!body) return Response.json({ ok: false, error: 'Invalid request' }, { status: 400 });

  const countMode = COUNT_MODES.find((m) => m === body.countMode) as CountMode | undefined;
  const difficulty = DIFFICULTIES.find((d) => d === body.difficulty) as Difficulty | undefined;
  const languages = cleanLanguages(body.languages);
  const count = Math.floor(Number(body.count));
  if (!countMode || !difficulty) return Response.json({ ok: false, error: 'Choose the number of questions and the difficulty.' }, { status: 400 });
  if (languages.length === 0) return Response.json({ ok: false, error: 'Choose at least one language.' }, { status: 400 });
  const max = countMode === 'total' ? MAX_TOTAL : MAX_PER_SECTION;
  if (!Number.isInteger(count) || count < 1 || count > max)
    return Response.json({ ok: false, error: `Choose between 1 and ${max} questions.` }, { status: 400 });

  const { data } = await loadPage(() => [
    db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.id, id)),
    db
      .select({ id: quizSections.id, chars: sql<number>`length(${quizSections.content})` })
      .from(quizSections)
      .where(eq(quizSections.quizId, id))
      .orderBy(quizSections.position),
  ]);
  const [quizRows, sectionRows] = data;
  if (!quizRows[0]) return Response.json({ ok: false, error: 'Quiz not found' }, { status: 404 });

  const picked = new Map((body.sections ?? []).map((s) => [s.id, s]));
  const kept = sectionRows.filter((s) => picked.get(s.id)?.included !== false);
  if (kept.length === 0) return Response.json({ ok: false, error: 'Keep at least one chapter.' }, { status: 400 });
  const alloc = allocateQuestions(countMode, count, kept.map((s) => s.chars));
  if (alloc.some((n) => n > MAX_PER_SECTION))
    return Response.json({ ok: false, error: `A chapter can have at most ${MAX_PER_SECTION} questions: raise the total or keep more chapters.` }, { status: 400 });
  const targets = new Map(kept.map((s, i) => [s.id, alloc[i]!]));

  await db.batch([
    db.update(quizzes).set({ countMode, questionCount: count, difficulty, languages: JSON.stringify(languages), status: 'draft' }).where(eq(quizzes.id, id)),
    db.delete(quizQuestions).where(eq(quizQuestions.quizId, id)),
    ...sectionRows.map((s) => {
      const title = String(picked.get(s.id)?.title ?? '').trim().slice(0, 120);
      return db
        .update(quizSections)
        .set({ included: targets.has(s.id), targetQuestions: targets.get(s.id) ?? 0, ...(title ? { title } : {}) })
        .where(eq(quizSections.id, s.id));
    }),
  ]);
  console.log('quiz start', id, countMode, count, difficulty, languages.join(','), 'sections', kept.length);
  return Response.json({ ok: true, data: { sections: kept.map((s) => ({ id: s.id, questions: targets.get(s.id) })) } });
}
