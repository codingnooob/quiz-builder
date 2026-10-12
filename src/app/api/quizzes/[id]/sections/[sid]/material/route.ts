import { loadChapter } from '@/lib/quiz/store';

// What a model running in the visitor's browser needs to write one chapter's questions.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  const found = await loadChapter(id, sid);
  if (!found) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  const { quiz, section } = found;
  return Response.json({
    ok: true,
    data: {
      title: section.title,
      content: section.content.slice(0, 60_000),
      count: section.included ? section.targetQuestions : 0,
      difficulty: quiz.difficulty,
      languages: JSON.parse(quiz.languages) as string[],
    },
  });
}
