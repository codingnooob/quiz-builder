import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { quizQuestions, quizSections, quizzes } from '@/db/schema';
import { loadPage } from '@/lib/load-page';

import type { GeneratedQuestion } from './generate';

/** A chapter with its quiz, or `null` when either is missing. One round trip. */
export async function loadChapter(quizId: string, sectionId: string) {
  const { data } = await loadPage(() => [
    db.select().from(quizzes).where(eq(quizzes.id, quizId)),
    db.select().from(quizSections).where(and(eq(quizSections.id, sectionId), eq(quizSections.quizId, quizId))),
  ]);
  const quiz = data[0][0];
  const section = data[1][0];
  return quiz && section ? { quiz, section } : null;
}

/** Replaces the chapter's questions with these ones, in one atomic batch. */
export async function saveQuestions(quizId: string, sectionId: string, questions: GeneratedQuestion[]) {
  await db.batch([
    db.delete(quizQuestions).where(eq(quizQuestions.sectionId, sectionId)),
    ...questions.map((q, i) =>
      db.insert(quizQuestions).values({
        id: crypto.randomUUID(),
        quizId,
        sectionId,
        position: i,
        difficulty: q.difficulty,
        correctIndex: q.correctIndex,
        content: JSON.stringify(q.content),
      }),
    ),
    db.update(quizzes).set({ status: 'ready' }).where(eq(quizzes.id, quizId)),
  ]);
}
