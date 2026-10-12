// The question-writing prompt and the JSON it asks for: shared by the server (built-in AI, your own key) and the
// browser (on-device model), so every way of writing questions gets the same instructions.
import type { Difficulty } from './types';

const DIFFICULTY_HELP: Record<Difficulty, string> = {
  easy: 'All questions easy: direct recall of key facts and definitions.',
  medium: 'All questions medium: understanding and applying the ideas, not just recalling words.',
  hard: 'All questions hard: analysis, comparison, edge cases and subtle distinctions; plausible distractors.',
  mixed: 'A mix of easy, medium and hard questions (roughly a third each); tag each question with its level.',
};

export function questionPrompt(opts: {
  title: string;
  content: string;
  count: number;
  difficulty: Difficulty;
  languages: string[];
  /** this call writes part `k` of `n`; the other parts are written by other calls */
  part?: { k: number; n: number };
}): string {
  const { title, content, count, difficulty, languages, part } = opts;
  return `You write multiple-choice quiz questions from study material.

Chapter: "${title}"
Write exactly ${count} questions about the material below, covering different parts of it and never repeating a point.
${DIFFICULTY_HELP[difficulty]}
${part ? `This is set ${part.k + 1} of ${part.n}; other sets are written separately, so favour the ${part.k + 1}${['st', 'nd', 'rd'][part.k] ?? 'th'} of ${part.n} equal portions of the material to avoid overlapping.\n` : ''}Rules:
- Use only facts stated in the material; every question must be answerable from it without outside knowledge or the text itself being at hand ("According to the text…" is not allowed).
- Exactly one correct answer ("correctAnswer") and exactly 3 plausible but clearly wrong answers ("wrongAnswers"); keep them similar in length. Do not use "all of the above" or "none of the above".
- "explanation": one or two sentences saying why the answer is correct.
- Each question must have one entry in "translations" for each of these languages, in this order: ${languages.map((l) => `"${l}"`).join(', ')}. All entries of a question must say exactly the same thing, written naturally in that language, and "language" must be the name exactly as listed.

Reply with JSON only, no other text, shaped like:
{"questions":[{"difficulty":"easy|medium|hard","translations":[{"language":"…","question":"…","correctAnswer":"…","wrongAnswers":["…","…","…"],"explanation":"…"}]}]}

Material:
"""
${content}
"""`;
}

/** The same shape as a JSON Schema, for models that can be constrained to it. */
export const QUESTIONS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          translations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                language: { type: 'string' },
                question: { type: 'string' },
                correctAnswer: { type: 'string' },
                wrongAnswers: { type: 'array', items: { type: 'string' } },
                explanation: { type: 'string' },
              },
              required: ['language', 'question', 'correctAnswer', 'wrongAnswers', 'explanation'],
            },
          },
        },
        required: ['difficulty', 'translations'],
      },
    },
  },
  required: ['questions'],
} as const;

/** The JSON a model answered with: bare, in a ```json fence, or with a sentence around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const from = body.indexOf('{');
    const to = body.lastIndexOf('}');
    if (from < 0 || to <= from) throw new Error('The model did not answer with JSON');
    return JSON.parse(body.slice(from, to + 1));
  }
}
