import { ByokError, readByok } from '@/lib/quiz/byok';
import { failure } from '@/lib/quiz/errors';
import { generateQuestions } from '@/lib/quiz/generate';
import { loadChapter, saveQuestions } from '@/lib/quiz/store';
import type { Difficulty } from '@/lib/quiz/types';

// Writes the questions of one chapter (replacing any earlier ones): safe to call again after a failure.
// With the headers x-ai-key, x-ai-base-url and x-ai-model the visitor's own AI provider writes them.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  let byok;
  try {
    byok = readByok(req);
  } catch (err) {
    const e = err as ByokError;
    return Response.json({ ok: false, error: e.message }, { status: e.status });
  }
  const found = await loadChapter(id, sid);
  if (!found) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  const { quiz, section } = found;
  if (!section.included || section.targetQuestions < 1) return Response.json({ ok: true, data: { questions: 0 } });

  const languages = JSON.parse(quiz.languages) as string[];
  console.log('generate questions', id, sid, section.title, section.targetQuestions, quiz.difficulty, byok ? `own key @ ${new URL(byok.baseUrl).hostname}` : 'built-in');
  let questions;
  try {
    questions = await generateQuestions({
      title: section.title,
      content: section.content,
      count: section.targetQuestions,
      difficulty: quiz.difficulty as Difficulty,
      languages,
      byok: byok ?? undefined,
    });
  } catch (err) {
    if (err instanceof ByokError) {
      console.error('Writing the questions with an own key failed', err.status, err.message);
      return Response.json({ ok: false, error: err.message }, { status: err.status, headers: err.status === 429 ? { 'retry-after': '15' } : undefined });
    }
    return failure(err, 'Writing the questions');
  }
  if (questions.length === 0) return Response.json({ ok: false, error: 'No questions could be written for this chapter. Try again.' }, { status: 502 });

  await saveQuestions(id, sid, questions);
  return Response.json({ ok: true, data: { questions: questions.length } });
}
