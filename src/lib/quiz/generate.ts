import { generateObject } from 'ai';
import { z } from 'zod';

import { model } from '@/agents/model';
import { AI_MODELS } from '@/lib/ai-models';

import type { Difficulty, QuestionContent } from './types';

const SECTION_CHARS = 60_000;

export type GeneratedQuestion = { difficulty: 'easy' | 'medium' | 'hard'; correctIndex: number; content: QuestionContent };

const DIFFICULTY_HELP: Record<Difficulty, string> = {
  easy: 'All questions easy: direct recall of key facts and definitions.',
  medium: 'All questions medium: understanding and applying the ideas, not just recalling words.',
  hard: 'All questions hard: analysis, comparison, edge cases and subtle distinctions; plausible distractors.',
  mixed: 'A mix of easy, medium and hard questions (roughly a third each); tag each question with its level.',
};

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Multiple-choice questions for one chapter, written in every requested language at once so the questions and the
 * answer positions match across languages. The model writes the correct answer first; the server shuffles the order.
 */
async function generateChunk(opts: {
  title: string;
  content: string;
  count: number;
  difficulty: Difficulty;
  languages: string[];
  /** this call writes part `k` of `n`; the other parts are written by other calls */
  part?: { k: number; n: number };
}): Promise<GeneratedQuestion[]> {
  const { title, count, difficulty, languages } = opts;
  const text = opts.content;
  const schema = z.object({
    questions: z.array(
      z.object({
        difficulty: z.enum(['easy', 'medium', 'hard']),
        translations: z.array(
          z.object({
            language: z.string(),
            question: z.string(),
            correctAnswer: z.string(),
            wrongAnswers: z.array(z.string()),
            explanation: z.string(),
          }),
        ),
      }),
    ),
  });
  const { object } = await generateObject({
    model: model(AI_MODELS.questions),
    maxRetries: 1,
    maxOutputTokens: 8000,
    schema,
    prompt: `You write multiple-choice quiz questions from study material.

Chapter: "${title}"
Write exactly ${count} questions about the material below, covering different parts of it and never repeating a point.
${DIFFICULTY_HELP[difficulty]}
${opts.part ? `This is set ${opts.part.k + 1} of ${opts.part.n}; other sets are written separately, so favour the ${opts.part.k + 1}${['st', 'nd', 'rd'][opts.part.k] ?? 'th'} of ${opts.part.n} equal portions of the material to avoid overlapping.\n` : ''}Rules:
- Use only facts stated in the material; every question must be answerable from it without outside knowledge or the text itself being at hand ("According to the text…" is not allowed).
- Exactly one correct answer ("correctAnswer") and exactly 3 plausible but clearly wrong answers ("wrongAnswers"); keep them similar in length. Do not use "all of the above" or "none of the above".
- "explanation": one or two sentences saying why the answer is correct.
- Each question must have one entry in "translations" for each of these languages, in this order: ${languages.map((l) => `"${l}"`).join(', ')}. All entries of a question must say exactly the same thing, written naturally in that language, and "language" must be the name exactly as listed.

Material:
"""
${text}
"""`,
  });

  const out: GeneratedQuestion[] = [];
  for (const q of object.questions) {
    const byLang = new Map(q.translations.map((t) => [t.language.trim().toLowerCase(), t]));
    const entries = languages.map((l) => byLang.get(l.toLowerCase()));
    if (entries.some((e) => !e || !e.question.trim() || !e.correctAnswer.trim() || e.wrongAnswers.filter((w) => w.trim()).length < 3)) continue;
    // one permutation for every language: slot 0 holds the correct answer before the shuffle
    const order = shuffle([0, 1, 2, 3]);
    const content: QuestionContent = {};
    languages.forEach((l, i) => {
      const e = entries[i]!;
      const options = [e.correctAnswer.trim(), ...e.wrongAnswers.slice(0, 3).map((w) => w.trim())];
      content[l] = { question: e.question.trim(), options: order.map((o) => options[o]!), explanation: e.explanation.trim() };
    });
    out.push({ difficulty: q.difficulty, correctIndex: order.indexOf(0), content });
  }
  return out.slice(0, count);
}

// A call writes at most this many question texts (questions × languages): longer answers are slow and get cut off.
const UNITS_PER_CALL = 12;

/**
 * Questions for one chapter. A big request is split into parallel calls, each on its own slice of the chapter, so the
 * questions cover the whole chapter and never repeat.
 */
export async function generateQuestions(opts: {
  title: string;
  content: string;
  count: number;
  difficulty: Difficulty;
  languages: string[];
}): Promise<GeneratedQuestion[]> {
  const text = opts.content.slice(0, SECTION_CHARS);
  const perCall = Math.max(1, Math.floor(UNITS_PER_CALL / opts.languages.length));
  const calls = Math.ceil(opts.count / perCall);
  if (calls <= 1) return generateChunk({ ...opts, content: text });
  const base = Math.floor(opts.count / calls);
  const extra = opts.count % calls;
  const size = Math.ceil(text.length / calls);
  const slice = text.length / calls >= 1200; // short chapters: every call reads the whole chapter
  const parts = await Promise.all(
    Array.from({ length: calls }, (_, k) =>
      generateChunk({
        ...opts,
        count: base + (k < extra ? 1 : 0),
        content: slice ? text.slice(Math.max(0, k * size - 300), (k + 1) * size + 300) : text,
        part: { k, n: calls },
      }),
    ),
  );
  return parts.flat();
}
