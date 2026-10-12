import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { quizQuestions, quizSections, quizzes } from '@/db/schema';
import { loadPage } from '@/lib/load-page';
import { failure } from '@/lib/quiz/errors';
import { generateQuestions } from '@/lib/quiz/generate';
import type { Difficulty } from '@/lib/quiz/types';

// Writes the questions of one chapter (replacing any earlier ones): safe to call again after a failure.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  const { data } = await loadPage(() => [
    db.select().from(quizzes).where(eq(quizzes.id, id)),
    db.select().from(quizSections).where(and(eq(quizSections.id, sid), eq(quizSections.quizId, id))),
  ]);
  const [quiz] = data[0];
  const [section] = data[1];
  if (!quiz || !section) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  if (!section.included || section.targetQuestions < 1) return Response.json({ ok: true, data: { questions: 0 } });

  const languages = JSON.parse(quiz.languages) as string[];
  console.log('generate questions', id, sid, section.title, section.targetQuestions, quiz.difficulty);
  let questions;
  try {
    questions = await generateQuestions({
      title: section.title,
      content: section.content,
      count: section.targetQuestions,
      difficulty: quiz.difficulty as Difficulty,
      languages,
    });
  } catch (err) {
    return failure(err, 'Writing the questions');
  }
  if (questions.length === 0) return Response.json({ ok: false, error: 'No questions could be written for this chapter. Try again.' }, { status: 502 });

  await db.batch([
    db.delete(quizQuestions).where(eq(quizQuestions.sectionId, sid)),
    ...questions.map((q, i) =>
      db.insert(quizQuestions).values({
        id: crypto.randomUUID(),
        quizId: id,
        sectionId: sid,
        position: i,
        difficulty: q.difficulty,
        correctIndex: q.correctIndex,
        content: JSON.stringify(q.content),
      }),
    ),
    db.update(quizzes).set({ status: 'ready' }).where(eq(quizzes.id, id)),
  ]);
  return Response.json({ ok: true, data: { questions: questions.length } });
}
