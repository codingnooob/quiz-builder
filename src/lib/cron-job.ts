// B2-PJ8: a scheduled job does its work INSIDE the scheduler's request and answers with its outcome. Acknowledging
// first and working in `after()` made a job failing every hour show `200 {"ok":true}`, so the scheduler never paused it
// and never told the owner. Here a failure answers 500 with the error's message (kept in the job's runs and the log
// line), and three in a row pause the job and tell the owner. Platform-owned.
import { isTotalumCall } from '@/lib/totalum-call';

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * `export const POST = (req: Request) => cronJob(req, 'daily report', (signal) => sendDailyReport(signal));`
 * The work gets `signal` (pass it to `fetch`), must end within `timeoutMs` (the scheduler waits 30 s) and is tried
 * `retries` more times on a failure while time is left — so it must be safe to repeat, or pass `{ retries: 0 }`.
 */
export async function cronJob(
  req: Request,
  name: string,
  work: (signal: AbortSignal) => Promise<unknown>,
  { timeoutMs = 25_000, retries = 1 } = {},
): Promise<Response> {
  if (!(await isTotalumCall(req))) return Response.json({ ok: false }, { status: 401 });
  const signal = AbortSignal.timeout(timeoutMs);
  const late = `timed out after ${String(timeoutMs / 1000)} s`;
  const over = () => signal.aborted;
  const timedOut = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(new Error(late));
    });
  });
  timedOut.catch(() => undefined);
  let error = '';
  for (let attempt = 0; attempt <= retries && !over(); attempt++) {
    try {
      const result = await Promise.race([work(signal), timedOut]);
      return Response.json({ ok: true, ...(result === undefined ? {} : { result }) });
    } catch (err) {
      error = over() ? late : text(err);
      // the message is in the line itself: a log keeps it even where an Error object prints as its stack only
      console.error(`${name} failed (attempt ${String(attempt + 1)}): ${error}`);
    }
  }
  return Response.json({ ok: false, error }, { status: 500 });
}
