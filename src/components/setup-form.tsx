'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { AiSourcePicker, defaultAiSource, type AiSource } from '@/components/ai-source';
import { button, Card, input } from '@/components/ui';
import { loadEngine, writeChapter, type DeviceInfo, type LocalEngine, type Material } from '@/lib/quiz/browser-llm';
import { COMMON_LANGUAGES, DIFFICULTIES, MAX_LANGUAGES, MAX_PER_SECTION, MAX_TOTAL } from '@/lib/quiz/types';

type Section = { id: string; title: string; chars: number; preview: string };
type Initial = { countMode: 'total' | 'per_section'; count: number; difficulty: string; languages: string[] };
type Status = 'waiting' | 'working' | 'done' | 'failed';

const DIFFICULTY_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', mixed: 'Mixed' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SetupForm({ quizId, sections, initial, truncated }: { quizId: string; sections: Section[]; initial: Initial; truncated: boolean }) {
  const router = useRouter();
  const [chapters, setChapters] = useState(sections.map((s) => ({ ...s, included: true })));
  const [countMode, setCountMode] = useState(initial.countMode);
  const [count, setCount] = useState(String(initial.count));
  const [difficulty, setDifficulty] = useState(DIFFICULTIES.includes(initial.difficulty as never) ? initial.difficulty : 'mixed');
  const [languages, setLanguages] = useState<string[]>(initial.languages);
  const [other, setOther] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, Status>>({});
  const [plan, setPlan] = useState<{ id: string; questions: number }[]>([]);
  const [source, setSource] = useState<AiSource>(defaultAiSource);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [note, setNote] = useState('');
  const stopped = useRef({ stopped: false });
  const engine = useRef<{ id: string; engine: LocalEngine } | null>(null);

  const kept = chapters.filter((c) => c.included);
  const toggleLanguage = (l: string) =>
    setLanguages((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : cur.length >= MAX_LANGUAGES ? cur : [...cur, l]));
  const addOther = () => {
    const name = other.replace(/[^\p{L}\p{M} \-()]/gu, '').trim();
    if (name && !languages.some((l) => l.toLowerCase() === name.toLowerCase()) && languages.length < MAX_LANGUAGES) setLanguages([...languages, name]);
    setOther('');
  };

  const ownKeyHeaders = (): Record<string, string> =>
    source.kind === 'key' ? { 'x-ai-key': source.apiKey.trim(), 'x-ai-base-url': source.baseUrl.trim(), 'x-ai-model': source.model.trim() } : {};

  async function generateOne(sectionId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`/api/quizzes/${quizId}/sections/${sectionId}/generate`, { method: 'POST', headers: ownKeyHeaders() });
      if (res.ok) return true;
      if (res.status === 429) {
        await sleep((Number(res.headers.get('retry-after')) || 20) * 1000);
        continue;
      }
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error ?? 'Something went wrong while writing the questions.');
      return false;
    }
    setError(source.kind === 'key' ? 'Your AI provider keeps saying it is too busy. Wait a minute, then retry the chapters that failed.' : 'Too many requests right now. Wait a minute, then retry the chapters that failed.');
    return false;
  }

  // On this device: the model writes in this browser, then the questions are sent to be checked and saved.
  async function generateOnDevice(sectionId: string): Promise<boolean> {
    try {
      const eng = engine.current!.engine;
      const mat = await fetch(`/api/quizzes/${quizId}/sections/${sectionId}/material`);
      const matJson = (await mat.json().catch(() => null)) as { ok: boolean; data?: Material } | null;
      if (!mat.ok || !matJson?.data) throw new Error('Could not read the chapter.');
      if (matJson.data.count < 1) return true;
      const raw = await writeChapter(eng, matJson.data, (done, total) => setNote(`${matJson.data!.title}: ${done} of ${total} parts written`), stopped.current);
      if (stopped.current.stopped) return false;
      const res = await fetch(`/api/quizzes/${quizId}/sections/${sectionId}/questions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(raw) });
      if (res.ok) return true;
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error ?? 'The questions could not be saved.');
      return false;
    } catch (err) {
      console.error('on-device writing failed', err);
      setError('The on-device model stopped before finishing. Retry, pick a smaller model, or use another option.');
      return false;
    }
  }

  async function prepareDevice(): Promise<boolean> {
    if (engine.current?.id === source.localModel) return true;
    try {
      await engine.current?.engine.unload().catch(() => undefined);
      engine.current = null;
      setNote('Starting the model…');
      const eng = await loadEngine(source.localModel, setNote);
      engine.current = { id: source.localModel, engine: eng };
      setNote('');
      return true;
    } catch (err) {
      console.error('model load failed', err);
      setNote('');
      setError('The model could not start on this device (it may have run out of memory). Try the Small model, close other heavy tabs, or choose another option.');
      return false;
    }
  }

  async function runSections(list: { id: string }[]) {
    setRunning(true);
    setProgress((p) => ({ ...p, ...Object.fromEntries(list.map((s) => [s.id, 'waiting' as Status])) }));
    const queue = [...list];
    const onDevice = source.kind === 'device';
    if (onDevice && !(await prepareDevice())) {
      setProgress((p) => ({ ...p, ...Object.fromEntries(list.map((s) => [s.id, 'failed' as Status])) }));
      setRunning(false);
      return;
    }
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        setProgress((p) => ({ ...p, [s.id]: 'working' }));
        const ok = await (onDevice ? generateOnDevice(s.id) : generateOne(s.id));
        setProgress((p) => ({ ...p, [s.id]: ok ? 'done' : 'failed' }));
      }
    };
    // the built-in AI and your own key write two chapters at once; a model on this device writes one at a time
    await Promise.all(onDevice ? [worker()] : [worker(), worker()]);
    setNote('');
    setRunning(false);
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (kept.length === 0) return setError('Keep at least one chapter.');
    if (languages.length === 0) return setError('Choose at least one language.');
    if (source.kind === 'key' && source.apiKey.trim().length < 8) return setError('Paste your API key, or choose another way to write the questions.');
    if (source.kind === 'key' && (!source.model.trim() || !source.baseUrl.trim())) return setError('Enter the provider address and the model name.');
    stopped.current.stopped = false;
    const n = Number(count);
    const max = countMode === 'total' ? MAX_TOTAL : MAX_PER_SECTION;
    if (!Number.isInteger(n) || n < 1 || n > max) return setError(`Choose between 1 and ${max} questions.`);
    setRunning(true);
    const res = await fetch(`/api/quizzes/${quizId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sections: chapters.map((c) => ({ id: c.id, title: c.title, included: c.included })), countMode, count: n, difficulty, languages }),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; data?: { sections: { id: string; questions: number }[] } } | null;
    if (!res.ok || !json?.ok || !json.data) {
      setRunning(false);
      return setError(json?.error ?? 'Could not start. Please try again.');
    }
    setPlan(json.data.sections);
    await runSections(json.data.sections);
  }

  const statuses = plan.map((p) => progress[p.id]);
  const finished = plan.length > 0 && !running && statuses.every((s) => s === 'done' || s === 'failed');
  const anyDone = statuses.some((s) => s === 'done');
  const anyFailed = statuses.some((s) => s === 'failed');
  const doneCount = statuses.filter((s) => s === 'done').length;

  if (plan.length > 0) {
    return (
      <Card title="Writing your questions">
        <div className="grid gap-4" data-testid="generation-progress">
          <div className="h-3 overflow-hidden rounded-full bg-stone-100">
            <div className="h-full rounded-full bg-accent shadow-[inset_0_0_0_1px_oklch(0.33_0.085_255/0.25)] transition-all" style={{ width: `${(doneCount / plan.length) * 100}%` }} />
          </div>
          <p className="text-sm text-stone-600">
            {doneCount} of {plan.length} chapters done{running ? (source.kind === 'device' ? ' — on-device writing is slow; keep this tab open and in front.' : ' — this takes a little while, keep this page open.') : '.'}
          </p>
          {note && <p className="text-sm text-brand" data-testid="device-note">{note}</p>}
          <ul className="grid gap-2">
            {plan.map((p) => {
              const c = chapters.find((x) => x.id === p.id)!;
              const st = progress[p.id] ?? 'waiting';
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{c.title}</span>
                  <span className={`shrink-0 text-xs font-medium ${st === 'done' ? 'text-emerald-700' : st === 'failed' ? 'text-red-700' : st === 'working' ? 'text-brand' : 'text-stone-600'}`}>
                    {st === 'done' ? `${p.questions} questions ✓` : st === 'failed' ? 'Failed' : st === 'working' ? 'Writing…' : 'Waiting'}
                  </span>
                </li>
              );
            })}
          </ul>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          {finished && (
            <div className="flex flex-wrap gap-3">
              {anyDone && (
                <button className={button.primary} onClick={() => router.push(`/quiz/${quizId}`)}>
                  Open the quiz
                </button>
              )}
              {anyFailed && (
                <button
                  className={button.secondary}
                  onClick={() => {
                    setError('');
                    void runSections(plan.filter((p) => progress[p.id] === 'failed'));
                  }}
                >
                  Retry the failed chapters
                </button>
              )}
              {anyFailed && (
                <button
                  className={button.secondary}
                  onClick={() => {
                    setError('');
                    setPlan([]);
                    setProgress({});
                  }}
                >
                  Change the settings
                </button>
              )}
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={start} className="grid gap-6">
      {truncated && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">This document is very long, so only its first part was used.</p>
      )}
      <Card title="1. Chapters" action={<span className="text-sm text-stone-600">{kept.length} of {chapters.length} selected</span>}>
        <ul className="grid gap-3" data-testid="chapters">
          {chapters.map((c, i) => (
            <li key={c.id} className={`rounded-xl border p-3 transition-colors ${c.included ? 'border-stone-200 bg-white' : 'border-stone-100 bg-stone-50 opacity-60'}`}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-[var(--color-brand)]"
                  checked={c.included}
                  aria-label={`Include chapter ${i + 1}`}
                  onChange={(e) => setChapters((cur) => cur.map((x) => (x.id === c.id ? { ...x, included: e.target.checked } : x)))}
                />
                <input
                  className={`${input} !mt-0 min-w-0 font-medium`}
                  value={c.title}
                  maxLength={120}
                  aria-label={`Title of chapter ${i + 1}`}
                  onChange={(e) => setChapters((cur) => cur.map((x) => (x.id === c.id ? { ...x, title: e.target.value } : x)))}
                />
                <span className="hidden shrink-0 rounded-full bg-accent/50 px-2 py-0.5 text-xs font-medium text-brand sm:block">{Math.max(1, Math.round(c.chars / 1800))} pp.</span>
              </div>
              {c.preview && <p className="mt-2 line-clamp-2 ps-8 text-sm text-stone-600">{c.preview}</p>}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="2. Questions">
        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-semibold">How many questions?</legend>
            <div className="mt-2 grid gap-2 text-sm">
              {(
                [
                  ['per_section', 'Per chapter'],
                  ['total', 'In total (shared between the chapters by length)'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-stone-300 bg-white px-3 py-2.5 transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40">
                  <input type="radio" name="countMode" className="accent-[var(--color-brand)]" checked={countMode === v} onChange={() => setCountMode(v)} />
                  {label}
                </label>
              ))}
            </div>
            <input
              type="number"
              min={1}
              max={countMode === 'total' ? MAX_TOTAL : MAX_PER_SECTION}
              className={`${input} max-w-32`}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-label="Number of questions"
              name="count"
            />
            <p className="mt-1 text-xs text-stone-600">
              {countMode === 'total' ? `Up to ${MAX_TOTAL} in total.` : `Up to ${MAX_PER_SECTION} per chapter.`}
              {countMode === 'per_section' && Number(count) > 0 && kept.length > 0 ? ` ${Number(count) * kept.length} questions overall.` : ''}
            </p>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-semibold">Difficulty</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DIFFICULTIES.map((d) => (
                <button
                  type="button"
                  key={d}
                  aria-pressed={difficulty === d}
                  onClick={() => setDifficulty(d)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none ${difficulty === d ? 'border-brand bg-brand text-white' : 'border-stone-300 bg-white hover:border-brand'}`}
                >
                  {DIFFICULTY_LABEL[d]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </Card>

      <Card title="3. Languages" action={<span className="text-sm text-stone-600">Up to {MAX_LANGUAGES}</span>}>
        <p className="mb-3 text-sm text-stone-600">The quiz is written in every language you pick, and you can switch between them when taking it or downloading the PDFs.</p>
        <div className="flex flex-wrap gap-2">
          {[...COMMON_LANGUAGES, ...languages.filter((l) => !(COMMON_LANGUAGES as readonly string[]).includes(l))].map((l) => (
            <button
              type="button"
              key={l}
              aria-pressed={languages.includes(l)}
              onClick={() => toggleLanguage(l)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none ${languages.includes(l) ? 'border-brand bg-brand text-white' : 'border-stone-300 bg-white hover:border-brand'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="mt-3 flex max-w-sm gap-2">
          <input
            className={`${input} !mt-0`}
            placeholder="Another language…"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOther();
              }
            }}
            aria-label="Another language"
          />
          <button type="button" className={button.secondary} onClick={addOther}>
            Add
          </button>
        </div>
      </Card>

      <Card title="4. Who writes the questions?">
        <AiSourcePicker value={source} onChange={setSource} device={device} onDevice={setDevice} />
      </Card>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={`${button.primary} px-6 py-3 text-base`} disabled={running}>
          {running ? 'Starting…' : 'Generate the quiz'}
        </button>
        <Link href="/" className={button.secondary}>
          Use another document
        </Link>
      </div>
    </form>
  );
}
