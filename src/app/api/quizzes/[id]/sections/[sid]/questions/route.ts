import { z } from 'zod';

import { finalizeQuestions, rawQuestionsSchema } from '@/lib/quiz/generate';
import { loadChapter, saveQuestions } from '@/lib/quiz/store';

// Stores questions a model wrote in the visitor's browser (replacing the chapter's earlier ones). Anything the browser
// sends is checked here: a question missing a language or an answer is dropped, and the answers are shuffled here.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  const body = rawQuestionsSchema.safeParse(await req.json().catch(() => null));
  if (!body.success || body.data.questions.length > 60) return Response.json({ ok: false, error: 'The questions are not in the expected format.' }, { status: 400 });
  const found = await loadChapter(id, sid);
  if (!found) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  const { quiz, section } = found;
  if (!section.included || section.targetQuestions < 1) return Response.json({ ok: true, data: { questions: 0 } });

  const questions = finalizeQuestions(body.data.questions, z.array(z.string()).parse(JSON.parse(quiz.languages)), section.targetQuestions);
  console.log('store on-device questions', id, sid, body.data.questions.length, '→', questions.length);
  if (questions.length === 0) return Response.json({ ok: false, error: 'The on-device model did not write any usable questions for this chapter.' }, { status: 422 });
  await saveQuestions(id, sid, questions);
  return Response.json({ ok: true, data: { questions: questions.length } });
}
