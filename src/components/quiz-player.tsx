'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { rememberQuiz } from '@/components/recent-quizzes';
import { button } from '@/components/ui';
import { isRtl, type QuestionContent } from '@/lib/quiz/types';

type Question = { id: string; difficulty: string; correctIndex: number; content: QuestionContent };
type Section = { id: string; title: string; questions: Question[] };

const LETTERS = ['A', 'B', 'C', 'D'];

export function QuizPlayer({ quizId, title, languages, sections }: { quizId: string; title: string; languages: string[]; sections: Section[] }) {
  const [language, setLanguage] = useState(languages[0]!);
  const [active, setActive] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [pdfBusy, setPdfBusy] = useState('');
  const [pdfError, setPdfError] = useState('');
  useEffect(() => rememberQuiz(quizId, title), [quizId, title]);

  const section = sections[active]!;
  const score = (qs: Question[]) => qs.filter((q) => answers[q.id] === q.correctIndex).length;
  const answered = (qs: Question[]) => qs.filter((q) => answers[q.id] !== undefined).length;
  const all = sections.flatMap((s) => s.questions);
  const rtl = isRtl(language);

  async function download(kind: 'questions' | 'answers') {
    setPdfBusy(kind);
    setPdfError('');
    try {
      const res = await fetch(`/api/quizzes/${quizId}/pdf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language, kind }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; data?: { url: string } } | null;
      if (!res.ok || !json?.ok || !json.data) throw new Error(json?.error ?? 'The PDF could not be created.');
      window.open(json.data.url, '_blank', 'noopener');
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'The PDF could not be created.');
    } finally {
      setPdfBusy('');
    }
  }

  return (
    <div className="min-h-[70dvh] bg-paper">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-brand sm:text-4xl">{title}</h1>
            <p className="mt-2 text-stone-700">
              {all.length} questions in {sections.length} {sections.length === 1 ? 'chapter' : 'chapters'} · {answered(all)} answered
              {answered(all) > 0 && ` · ${score(all)} correct`}
            </p>
          </div>
          <Link href={`/quiz/${quizId}/setup`} className={button.secondary}>
            Change settings
          </Link>
        </div>

        <section className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" data-testid="downloads">
          {languages.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Language">
              {languages.map((l) => (
                <button
                  key={l}
                  aria-pressed={language === l}
                  onClick={() => setLanguage(l)}
                  className={`rounded-full border px-3.5 py-1 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none ${language === l ? 'border-brand bg-brand text-white' : 'border-stone-300 bg-white hover:border-brand'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 sm:ms-auto">
            <button className={button.secondary} onClick={() => download('questions')} disabled={!!pdfBusy}>
              {pdfBusy === 'questions' ? 'Preparing…' : `Download questions (PDF)`}
            </button>
            <button className={button.secondary} onClick={() => download('answers')} disabled={!!pdfBusy}>
              {pdfBusy === 'answers' ? 'Preparing…' : 'Download answers (PDF)'}
            </button>
          </div>
          {pdfError && <p role="alert" className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pdfError}</p>}
        </section>

        <div className="mt-6 flex gap-2 overflow-x-auto p-1 -mx-1" role="tablist">
          {sections.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`shrink-0 rounded-lg border px-3.5 py-2 text-start text-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none ${i === active ? 'border-brand bg-brand text-white shadow-md' : 'border-stone-200 bg-white hover:border-brand'}`}
            >
              <span className="block max-w-56 truncate font-medium">{s.title}</span>
              <span className={`text-xs ${i === active ? 'text-white/85' : 'text-stone-600'}`}>
                {answered(s.questions) > 0 ? `${score(s.questions)}/${s.questions.length} correct` : `${s.questions.length} questions`}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-4" dir={rtl ? 'rtl' : 'ltr'} lang={language}>
          <h2 className="font-display text-xl font-semibold text-brand sm:text-2xl">{section.title}</h2>
          {section.questions.map((q, qi) => {
            const t = q.content[language];
            if (!t) return null;
            const chosen = answers[q.id];
            const done = chosen !== undefined;
            return (
              <article key={q.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6" data-testid="question">
                <p className="text-xs font-medium tracking-wide text-stone-600">
                  Question {qi + 1} · {q.difficulty}
                </p>
                <h3 className="mt-1 text-lg leading-7 font-semibold">{t.question}</h3>
                <div className="mt-4 grid gap-2">
                  {t.options.map((o, oi) => {
                    const isCorrect = oi === q.correctIndex;
                    const state = !done ? 'idle' : isCorrect ? 'correct' : oi === chosen ? 'wrong' : 'dim';
                    return (
                      <button
                        key={oi}
                        disabled={done}
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                        data-state={state}
                        className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-start text-base transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none ${
                          state === 'idle'
                            ? 'border-stone-300 hover:border-brand hover:bg-brand/5'
                            : state === 'correct'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                              : state === 'wrong'
                                ? 'border-red-400 bg-red-50 text-red-900'
                                : 'border-stone-200 text-stone-500'
                        }`}
                      >
                        <span
                          className={`grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold ${
                            state === 'correct' ? 'bg-emerald-600 text-white' : state === 'wrong' ? 'bg-red-600 text-white' : 'bg-stone-100 text-stone-700'
                          }`}
                        >
                          {LETTERS[oi]}
                        </span>
                        <span className="min-w-0 break-words">{o}</span>
                      </button>
                    );
                  })}
                </div>
                {done && (
                  <p className="mt-3 rounded-lg border-s-4 border-accent bg-stone-50 px-3 py-2 text-sm leading-6 text-stone-800">
                    <strong>{chosen === q.correctIndex ? 'Correct. ' : `Not quite — the answer is ${LETTERS[q.correctIndex]}. `}</strong>
                    {t.explanation}
                  </p>
                )}
              </article>
            );
          })}
          <div className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
            <p className="text-sm font-semibold">
              Chapter score: {score(section.questions)} / {section.questions.length}
              <span className="font-normal text-stone-600"> · overall {score(all)} / {all.length}</span>
            </p>
            <div aria-hidden className="flex h-3 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(score(section.questions) / section.questions.length) * 100}%` }} />
              <div
                className="h-full bg-red-500 transition-all"
                style={{ width: `${((answered(section.questions) - score(section.questions)) / section.questions.length) * 100}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className={button.secondary}
                onClick={() => setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([id]) => !section.questions.some((q) => q.id === id))))}
              >
                Retry chapter
              </button>
              {active < sections.length - 1 && (
                <button
                  className={button.primary}
                  onClick={() => {
                    setActive(active + 1);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Next chapter
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
