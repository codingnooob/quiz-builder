import { APICallError } from 'ai';
import { isTotalumError } from 'totalum-sdk';

/** A failed built-in call as the visitor should see it: credits out → 503, too many calls → 429, anything else → 502. */
export function failure(err: unknown, what: string): Response {
  console.error(`${what} failed`, err);
  const status = APICallError.isInstance(err) ? err.statusCode : undefined;
  const code = isTotalumError(err) ? err.errorCode : undefined;
  if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
    const retry = (APICallError.isInstance(err) && err.responseHeaders?.['retry-after']) || '30';
    return Response.json({ ok: false, error: 'Too many requests right now — try again in a minute.' }, { status: 429, headers: { 'retry-after': String(retry) } });
  }
  if (status === 402 || status === 403 || code === 'INSUFFICIENT_CREDITS')
    return Response.json({ ok: false, error: 'Temporarily unavailable. Please try again later.' }, { status: 503 });
  return Response.json({ ok: false, error: `${what} failed. Please try again.` }, { status: 502 });
}
