// Shared by server routes and client components: limits and the shape of a stored question.
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const COUNT_MODES = ['per_section', 'total'] as const;
export type CountMode = (typeof COUNT_MODES)[number];

export const COMMON_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Catalan',
  'Polish',
  'Russian',
  'Turkish',
  'Arabic',
  'Hindi',
  'Chinese',
  'Japanese',
  'Korean',
] as const;

export const MAX_LANGUAGES = 4;
export const MAX_FILE_BYTES = 25_000_000;
export const MAX_TEXT_CHARS = 400_000;
export const MAX_SECTIONS = 30;
export const MAX_PER_SECTION = 15;
export const MAX_TOTAL = 150;

export type QuestionText = { question: string; options: string[]; explanation: string };
export type QuestionContent = Record<string, QuestionText>;

export const RTL_LANGUAGES = ['arabic', 'hebrew', 'persian', 'farsi', 'urdu'];
export const isRtl = (language: string) => RTL_LANGUAGES.includes(language.trim().toLowerCase());

/** Language names come from the browser: keep them short, plain text. */
export function cleanLanguages(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    const name = String(raw ?? '')
      .replace(/[^\p{L}\p{M} \-()]/gu, '')
      .trim()
      .slice(0, 40);
    if (name && !out.some((l) => l.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, MAX_LANGUAGES);
}

/** How many questions each chapter gets: `per_section` the same for all, `total` spread by chapter length (min 1 each). */
export function allocateQuestions(
  mode: CountMode,
  count: number,
  lengths: number[],
): number[] {
  if (lengths.length === 0) return [];
  if (mode === 'per_section') return lengths.map(() => count);
  const n = lengths.length;
  const total = Math.max(count, n);
  const sum = lengths.reduce((a, b) => a + b, 0) || 1;
  const alloc = lengths.map((l) => Math.max(1, Math.floor((l / sum) * total)));
  let diff = total - alloc.reduce((a, b) => a + b, 0);
  // hand out the remainder to the longest chapters first, take the excess from the biggest allocations
  const byLength = lengths.map((l, i) => [l, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; diff > 0; k++, diff--) alloc[byLength[k % n]![1]]!++;
  const bySize = () => alloc.map((a, i) => [a, i] as const).sort((a, b) => b[0] - a[0]);
  while (diff < 0) {
    const [a, i] = bySize()[0]!;
    if (a <= 1) break;
    alloc[i]!--;
    diff++;
  }
  return alloc;
}
