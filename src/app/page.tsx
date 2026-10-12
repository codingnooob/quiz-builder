import type { ReactNode } from 'react';

import { RecentQuizzes } from '@/components/recent-quizzes';
import { UploadForm } from '@/components/upload-form';

const steps = [
  { title: 'Upload', text: 'Drop in your document. If you know how many chapters it has, say so; otherwise we find them.' },
  { title: 'Review chapters', text: 'Rename or drop chapters, then choose the question count, difficulty and languages.' },
  { title: 'Take or download the quiz', text: 'Answer on screen with instant feedback, or save questions and answers as separate PDFs.' },
];

const formats = ['PDF', 'Word', 'PowerPoint', 'TXT', 'Markdown', 'HTML', 'Images'];

const faq = [
  {
    q: 'Which files can I upload?',
    a: 'PDF, Word, PowerPoint, plain text, Markdown, HTML and images (scans or photos of pages), up to 25 MB per file. Very long documents are trimmed, and you are told when that happens.',
  },
  {
    q: 'How do I choose the number of questions?',
    a: 'Either a fixed number for each chapter, or a total that is shared between the chapters according to their length. You can also pick Easy, Medium, Hard or a mix.',
  },
  {
    q: 'Can the quiz be in another language than my document?',
    a: 'Yes. Pick one or several languages, or type any other one. When you take the quiz or download the PDFs you switch between the languages you chose. Right-to-left languages such as Arabic are laid out right to left.',
  },
  {
    q: 'What do the PDFs contain?',
    a: 'Two separate files: one with the questions only, to print or hand out, and one with the answers and explanations, to keep for yourself.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. There is nothing to sign in to. Your recent quizzes are remembered in this browser, so you can come back to them from this page on the same device.',
  },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-10 place-items-center rounded-xl bg-accent text-brand">
      <svg aria-hidden className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} viewBox="0 0 24 24">
        {children}
      </svg>
    </span>
  );
}

export default function Home() {
  return (
    <main>
      {/* Hero: the tool itself */}
      <section className="relative overflow-x-clip bg-paper">
        <div aria-hidden className="ruled pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-x-16 lg:gap-y-10 lg:py-20">
          <div className="lg:col-start-1 lg:row-start-1">
            <h1 className="font-display text-4xl leading-[1.08] font-semibold tracking-tight text-brand sm:text-5xl lg:text-6xl">
              Turn any document into a quiz, <span className="highlight">chapter by chapter</span>.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-7 text-stone-700">
              Drop in your notes, a textbook PDF or a slide deck. Quiz Builder splits it into chapters and writes the questions at the difficulty and in the languages you choose.
            </p>
          </div>

          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1" id="upload" style={{ scrollMarginTop: '5rem' }}>
            <div className="relative">
              <div aria-hidden className="absolute inset-0 hidden -rotate-2 rounded-3xl border border-stone-200 bg-white/80 sm:block" />
              <div aria-hidden className="absolute inset-0 hidden rotate-1 rounded-3xl border border-brand/10 bg-accent/50 sm:block" />
              <div className="relative">
                <UploadForm />
              </div>
            </div>
            <div className="mt-8">
              <RecentQuizzes />
            </div>
          </div>

          <div className="lg:col-start-1 lg:row-start-2" id="how-it-works" style={{ scrollMarginTop: '5rem' }}>
            <h2 className="font-display text-2xl font-semibold text-brand">How it works</h2>
            <ol className="mt-5 grid gap-5">
              {steps.map((s, i) => (
                <li className="flex gap-4" key={s.title}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand font-display text-base font-semibold text-white">{i + 1}</span>
                  <div className="min-w-0">
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="mt-0.5 leading-6 text-stone-700">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-7 border-t border-brand/15 pt-5">
              <ul aria-label="Supported formats" className="flex flex-wrap gap-2">
                {formats.map((f) => (
                  <li className="rounded-md border border-brand/20 bg-white px-2.5 py-1 text-sm font-medium text-brand" key={f}>
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                Up to 25 MB per file. Quizzes in any language. PDFs for questions and answers, separately.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Showcase: the quiz on screen (an example) */}
      <section className="border-y border-brand/10 bg-white py-16 sm:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-brand sm:text-4xl">Answer it on screen. Get told why.</h2>
            <p className="mt-4 max-w-prose leading-7 text-stone-700">
              Every chapter becomes its own set of multiple-choice questions. Pick an option and it turns green or red straight away, with a short explanation taken from your material.
            </p>
            <ul className="mt-6 grid gap-3 text-stone-800">
              {['A tab and a running score for each chapter', 'Retry one chapter without losing the others', 'Switch the quiz language with one tap'].map((t) => (
                <li className="flex items-start gap-3" key={t}>
                  <svg aria-hidden className="mt-1 size-5 shrink-0 text-brand" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <figure className="relative">
            <div aria-hidden className="absolute -inset-3 -rotate-1 rounded-3xl bg-accent/40" />
            <div className="relative rounded-2xl border border-stone-200 bg-paper p-4 shadow-xl sm:p-6">
              <div className="flex gap-2 overflow-hidden">
                <span className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">1. Cell structure · 1/1</span>
                <span className="shrink-0 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600">2. Energy · 6 questions</span>
              </div>
              <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
                <p className="text-xs font-medium tracking-wide text-stone-500">Question 1 · medium</p>
                <p className="mt-1 font-semibold">Which organelle produces most of a cell's ATP?</p>
                <div className="mt-3 grid gap-2 text-sm">
                  {[
                    ['A', 'Nucleus', 'idle'],
                    ['B', 'Mitochondrion', 'correct'],
                    ['C', 'Golgi apparatus', 'idle'],
                    ['D', 'Ribosome', 'idle'],
                  ].map(([l, o, st]) => (
                    <div
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${st === 'correct' ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-stone-200 text-stone-500'}`}
                      key={l}
                    >
                      <span className={`grid size-6 place-items-center rounded-md text-xs font-bold ${st === 'correct' ? 'bg-emerald-600 text-white' : 'bg-stone-100'}`}>{l}</span>
                      {o}
                    </div>
                  ))}
                </div>
                <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  <strong>Correct. </strong>Mitochondria run cellular respiration, which is where most ATP is made.
                </p>
              </div>
              <figcaption className="mt-3 text-xs text-stone-500">Example question, not from a real upload.</figcaption>
            </div>
          </figure>
        </div>
      </section>

      {/* What you control: dark band */}
      <section className="bg-brand py-16 text-white sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-4xl">You stay in charge of what ends up in the quiz.</h2>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl bg-white/8 p-6 ring-1 ring-white/15 lg:col-span-2">
              <Icon>
                <path d="M5 5h14M5 12h14M5 19h9" />
              </Icon>
              <h3 className="mt-4 font-display text-xl font-semibold">Chapters you can edit</h3>
              <p className="mt-2 max-w-prose leading-7 text-white/85">
                We propose the split; you rename chapters, untick the ones you do not need and set how many questions each one gets.
              </p>
              <ul aria-hidden className="mt-5 grid gap-2 text-sm text-stone-900 sm:max-w-md">
                {[
                  ['Introduction', true],
                  ['Chapter 1 · Core concepts', true],
                  ['Appendix and references', false],
                ].map(([t, on]) => (
                  <li className={`flex items-center gap-3 rounded-lg px-3 py-2 ${on ? 'bg-white' : 'bg-white/60'}`} key={String(t)}>
                    <span className={`grid size-4 place-items-center rounded-sm ${on ? 'bg-brand text-white' : 'border border-stone-400'}`}>
                      {on ? (
                        <svg className="size-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </span>
                    <span className={on ? 'font-medium' : 'text-stone-600 line-through'}>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-white/8 p-6 ring-1 ring-white/15">
              <Icon>
                <path d="M3 5h12M9 3v2m1 0c0 4-3 7-7 8m3-4c1 2 3 4 6 5m3 5 4-10 4 10m-1.5-3h-5" />
              </Icon>
              <h3 className="mt-4 font-display text-xl font-semibold">Any language</h3>
              <p className="mt-2 leading-7 text-white/85">English, Spanish, Arabic, or anything you type in. Add several and switch between them.</p>
            </div>
            <div className="rounded-2xl bg-white/8 p-6 ring-1 ring-white/15 lg:col-span-3">
              <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
                <Icon>
                  <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />
                </Icon>
                <div>
                  <h3 className="font-display text-xl font-semibold">Two PDFs, kept apart</h3>
                  <p className="mt-2 max-w-3xl leading-7 text-white/85">
                    Download the questions on their own to print or share with a class, and the answers with explanations as a separate file for the teacher. One pair per language.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-paper py-16 sm:py-24" id="faq" style={{ scrollMarginTop: '4rem' }}>
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-brand sm:text-4xl">Questions before you start</h2>
            <p className="mt-3 max-w-sm leading-7 text-stone-700">Short answers about formats, languages and PDFs.</p>
          </div>
          <div className="divide-y divide-brand/15 border-y border-brand/15">
            {faq.map((f) => (
              <details className="group py-4" key={f.q}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md font-semibold focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none">
                  {f.q}
                  <svg aria-hidden className="size-5 shrink-0 text-brand transition-transform group-open:rotate-45" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p className="mt-3 max-w-prose leading-7 text-stone-700">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="bg-brand py-14 text-white sm:py-20">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
          <h2 className="max-w-xl font-display text-2xl font-semibold tracking-tight sm:text-4xl">Your next test is already in your notes.</h2>
          <a
            className="inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 text-base font-semibold text-brand transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
            href="#upload"
          >
            Upload a document
          </a>
        </div>
      </section>
    </main>
  );
}
