import { eq, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { SetupForm } from '@/components/setup-form';
import { AppPage } from '@/components/ui';
import { db } from '@/db';
import { quizSections, quizzes } from '@/db/schema';
import { loadPage } from '@/lib/load-page';

export const metadata = { title: 'Set up your quiz' };

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await loadPage(() => [
    db.select().from(quizzes).where(eq(quizzes.id, id)),
    db
      .select({
        id: quizSections.id,
        title: quizSections.title,
        chars: sql<number>`length(${quizSections.content})`,
        preview: sql<string>`substr(${quizSections.content}, 1, 220)`,
      })
      .from(quizSections)
      .where(eq(quizSections.quizId, id))
      .orderBy(quizSections.position),
  ]);
  const [quiz] = data[0];
  if (!quiz) notFound();
  return (
    <AppPage
      title="Set up your quiz"
      description={`“${quiz.title}” was split into ${data[1].length} ${data[1].length === 1 ? 'chapter' : 'chapters'}. Check them, then choose how the quiz should be written.`}
    >
      <SetupForm
        quizId={quiz.id}
        truncated={quiz.truncated}
        sections={data[1].map((s) => ({ ...s, preview: s.preview.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim() }))}
        initial={{
          countMode: quiz.countMode === 'total' ? 'total' : 'per_section',
          count: quiz.questionCount,
          difficulty: quiz.difficulty,
          languages: JSON.parse(quiz.languages) as string[],
        }}
      />
    </AppPage>
  );
}
