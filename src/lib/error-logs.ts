// Platform-owned (worker.ts). B2-BI9 (e): workerd's tail writes an Error passed to `console.*` as `String(err)` (or
// its stack only), so a wrapped error's reason — Drizzle's "Failed query" around D1's "no such table" — never reached
// the owner's logs. Each Error argument becomes one line: its own text, then its cause chain.

const MAX_CAUSES = 5;

function text(value: unknown): string {
  if (value instanceof Error || typeof value === 'string') return String(value);
  return JSON.stringify(value); // undefined for a function: the line then says "undefined"
}

export function errorLine(err: Error): string {
  let line = String(err);
  let cause: unknown = err.cause;
  for (let i = 0; cause !== undefined && cause !== null && i < MAX_CAUSES; i++) {
    line += ` [cause: ${text(cause)}]`;
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return line;
}

const KEPT = Symbol.for('totalum.errorLogs');
type Log = (...args: unknown[]) => void;

/** Wraps console.error/warn/log/info/debug once, so every Error argument is logged as `errorLine(err)`. */
export function keepErrorMessages(target: Console = console): void {
  const marked = target as Console & { [KEPT]?: true };
  if (marked[KEPT]) return;
  marked[KEPT] = true;
  for (const level of ['error', 'warn', 'log', 'info', 'debug'] as const) {
    if (typeof target[level] !== 'function') continue;
    const original: Log = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      original(...args.map((a) => (a instanceof Error ? errorLine(a) : a)));
    };
  }
}
