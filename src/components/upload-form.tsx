'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { rememberQuiz } from '@/components/recent-quizzes';
import { button, input } from '@/components/ui';

const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.markdown,.html,.htm,.csv,.png,.jpg,.jpeg,.webp';

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sections, setSections] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  function pick(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setError('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError('Choose a document first.');
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set('file', file);
      if (sections) body.set('sections', sections);
      const res = await fetch('/api/quizzes', { method: 'POST', body });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; data?: { id: string; title: string } } | null;
      if (!res.ok || !json?.ok || !json.data) throw new Error(json?.error ?? 'The upload failed. Please try again.');
      rememberQuiz(json.data.id, json.data.title);
      router.push(`/quiz/${json.data.id}/setup`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-3xl border border-stone-200 bg-white p-4 shadow-[0_20px_40px_-20px_oklch(0.33_0.085_255/0.35)] sm:p-6"
      data-testid="upload-form"
    >
      <h2 className="font-display text-xl font-semibold text-brand">Start with your document</h2>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors sm:px-6 sm:py-10 ${
          dragging ? 'border-brand bg-accent/30' : 'border-brand/30 bg-paper'
        }`}
      >
        <svg viewBox="0 0 24 24" className="size-11 rounded-xl bg-accent p-2.5 text-brand" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M12 16V4m0 0 4 4m-4-4L8 8M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {file ? (
          <p className="font-semibold break-all">
            {file.name} <span className="text-sm font-normal text-stone-600">({(file.size / 1_000_000).toFixed(1)} MB)</span>
          </p>
        ) : (
          <p className="font-display text-lg font-semibold">Drop a document here</p>
        )}
        <p className="text-sm text-stone-600">PDF, Word, PowerPoint, TXT, Markdown, HTML or an image · up to 25 MB</p>
        <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" name="file" onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className={button.secondary} onClick={() => inputRef.current?.click()} disabled={busy}>
          {file ? 'Choose another file' : 'Choose a file'}
        </button>
      </div>

      <label className="block text-sm">
        <span className="block font-semibold">Number of chapters <span className="font-normal text-stone-600">(optional)</span></span>
        <span className="block text-stone-600">Leave empty to detect them automatically.</span>
        <input
          type="number"
          min={1}
          max={30}
          inputMode="numeric"
          className={`${input} max-w-40`}
          value={sections}
          onChange={(e) => setSections(e.target.value)}
          name="sections"
          disabled={busy}
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="submit" className={`${button.primary} px-5 py-3.5 text-center text-base leading-snug`} disabled={busy || !file}>
        {busy ? 'Reading your document and finding chapters… this can take up to a minute' : 'Split into chapters'}
      </button>
      {busy && (
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-stone-100">
          <div className="h-full w-1/3 rounded-full bg-accent motion-safe:animate-pulse" />
        </div>
      )}
    </form>
  );
}
