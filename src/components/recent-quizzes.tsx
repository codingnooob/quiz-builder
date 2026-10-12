'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const KEY = 'quiz-builder.recent';
type Recent = { id: string; title: string };

function read(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string' && typeof r.title === 'string') : [];
  } catch {
    return [];
  }
}

/** Remembers a quiz in this browser only (there are no accounts: the link is the access). */
export function rememberQuiz(id: string, title: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([{ id, title }, ...read().filter((r) => r.id !== id)].slice(0, 8)));
  } catch {}
}

export function RecentQuizzes() {
  const [items, setItems] = useState<Recent[]>([]);
  useEffect(() => setItems(read()), []);
  if (items.length === 0) return null;
  return (
    <div data-testid="recent-quizzes">
      <h2 className="font-display text-base font-semibold text-brand">Your recent quizzes on this device</h2>
      <ul className="mt-3 grid gap-2">
        {items.map((r) => (
          <li key={r.id}>
            <Link href={`/quiz/${r.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium transition-colors hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none">
              <span className="min-w-0 truncate">{r.title}</span>
              <span aria-hidden className="shrink-0 text-brand">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
