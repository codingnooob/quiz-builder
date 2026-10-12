import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { QuizPlayer } from '@/components/quiz-player';
import { db } from '@/db';
import { quizQuestions, quizSections, quizzes } from '@/db/schema';
import { loadPage } from '@/lib/load-page';
import type { QuestionContent } from '@/lib/quiz/types';

export const metadata = { title: 'Quiz' };

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await loadPage(() => [
    db.select().from(quizzes).where(eq(quizzes.id, id)),
    db
      .select({ id: quizSections.id, title: quizSections.title })
      .from(quizSections)
      .where(and(eq(quizSections.quizId, id), eq(quizSections.included, true)))
      .orderBy(quizSections.position),
    db.select().from(quizQuestions).where(eq(quizQuestions.quizId, id)).orderBy(quizQuestions.position),
  ]);
  const [quiz] = data[0];
  if (!quiz) notFound();
  if (data[2].length === 0) redirect(`/quiz/${id}/setup`);
  const sections = data[1]
    .map((s) => ({
      id: s.id,
      title: s.title,
      questions: data[2]
        .filter((q) => q.sectionId === s.id)
        .map((q) => ({ id: q.id, difficulty: q.difficulty, correctIndex: q.correctIndex, content: JSON.parse(q.content) as QuestionContent })),
    }))
    .filter((s) => s.questions.length > 0);
  return <QuizPlayer quizId={quiz.id} title={quiz.title} languages={JSON.parse(quiz.languages) as string[]} sections={sections} />;
}
