import { generateObject } from 'ai';
import { z } from 'zod';

import { model } from '@/agents/model';
import { AI_MODELS } from '@/lib/ai-models';

import { jsonWithOwnKey, type ByokConfig } from './byok';
import { questionPrompt } from './prompt';
import type { Difficulty, QuestionContent } from './types';

const SECTION_CHARS = 60_000;

export type GeneratedQuestion = { difficulty: 'easy' | 'medium' | 'hard'; correctIndex: number; content: QuestionContent };

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const translationSchema = z.object({
  language: z.string(),
  question: z.string(),
  correctAnswer: z.string(),
  wrongAnswers: z.array(z.string()),
  explanation: z.string(),
});
export const rawQuestionsSchema = z.object({
  questions: z.array(z.object({ difficulty: z.enum(['easy', 'medium', 'hard']).catch('medium'), translations: z.array(translationSchema) })),
});
export type RawQuestion = z.infer<typeof rawQuestionsSchema>['questions'][number];

/**
 * Checks what a model wrote and turns it into stored questions: drops any question missing a language or an answer,
 * and shuffles the answers (the model writes the correct one first) with one order shared by every language.
 */
export function finalizeQuestions(raw: RawQuestion[], languages: string[], count: number): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  for (const q of raw) {
    const byLang = new Map(q.translations.map((t) => [t.language.trim().toLowerCase(), t]));
    const entries = languages.map((l) => byLang.get(l.toLowerCase()));
    if (entries.some((e) => !e || !e.question.trim() || !e.correctAnswer.trim() || e.wrongAnswers.filter((w) => w.trim()).length < 3)) continue;
    // one permutation for every language: slot 0 holds the correct answer before the shuffle
    const order = shuffle([0, 1, 2, 3]);
    const content: QuestionContent = {};
    languages.forEach((l, i) => {
      const e = entries[i]!;
      const options = [e.correctAnswer, ...e.wrongAnswers.filter((w) => w.trim()).slice(0, 3)].map((o) => o.trim().slice(0, 400));
      content[l] = { question: e.question.trim().slice(0, 600), options: order.map((o) => options[o]!), explanation: e.explanation.trim().slice(0, 800) };
    });
    out.push({ difficulty: q.difficulty, correctIndex: order.indexOf(0), content });
  }
  return out.slice(0, count);
}

/**
 * Multiple-choice questions for one chapter, written in every requested language at once so the questions and the
 * answer positions match across languages.
 */
async function generateChunk(opts: {
  title: string;
  content: string;
  count: number;
  difficulty: Difficulty;
  languages: string[];
  part?: { k: number; n: number };
  byok?: ByokConfig;
}): Promise<GeneratedQuestion[]> {
  const prompt = questionPrompt(opts);
  const object = opts.byok
    ? rawQuestionsSchema.parse(await jsonWithOwnKey(opts.byok, prompt))
    : (
        await generateObject({
          model: model(AI_MODELS.questions),
          maxRetries: 1,
          maxOutputTokens: 8000,
          schema: rawQuestionsSchema,
          prompt,
        })
      ).object;
  return finalizeQuestions(object.questions, opts.languages, opts.count);
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
  /** the visitor's own provider, when they brought a key */
  byok?: ByokConfig;
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
