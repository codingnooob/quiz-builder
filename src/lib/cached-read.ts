import { headers } from 'next/headers';

/**
 * A read that is the same for every visitor (a home page's listing, a catalogue, a public profile), kept by this Worker
 * instance for `seconds` (1–10), so a busy page reaches the database a few times a second instead of on every view:
 * one database copy answers ≈ 300 calls a second and the visitors of one country all share one copy (research 75 §14,
 * §15). Concurrent requests share one call. Never for data that depends on who asks (`me`, the session, a cookie);
 * `npm run check` refuses it in a file that reads the session or writes (CACHED_READ_USER_DATA).
 *
 * Guards (A10.37, research 75 §15.8), so it can never serve one visitor's data to another nor hide a write:
 * - read fresh and never kept: a signed-in request (session cookie or `Authorization`), a browser that wrote in the
 *   last 10 s (`__tlm_d1_w`: it sees its own write; hence the 10 s cap), a server action, a call outside a request
 *   (cron, script) and `next dev` (the agent's checks and migrations see the database as it is);
 * - every caller gets its own copy (`structuredClone`): a page that sorts or annotates its rows changes nobody else's;
 * - at most 500 keys and 8 MB, the least recently used dropped first; a value over 1 MB or not copyable is not kept;
 * - keys are per project, database (dev/live, D1/Turso) and Worker (preview/published); a new version is a new Worker,
 *   with empty memory, so a publish or a migration never serves rows of the old shape;
 * - a failed read is never kept: it answers the last value if that is at most 60 s old, else it throws to every caller.
 */
const MAX_KEYS = 500;
const MAX_BYTES = 8_000_000;
const MAX_VALUE_BYTES = 1_000_000;
const MAX_MS = 10_000;
const STALE_MS = 60_000;
const FRESH_COOKIE = /(?:^|;\s*)(?:__tlm_d1_w|[^=;\s]*\.session_(?:token|data))=/;
interface Kept {
  value?: { v: unknown; at: number; until: number; bytes: number };
  pending?: Promise<unknown>;
}
const kept = new Map<string, Kept>();
let bytes = 0;

export async function cachedRead<T>(key: string, seconds: number, read: () => Promise<T>): Promise<T> {
  if (!(await shareable())) return read();
  const k = [
    process.env.TOTALUM_PROJECT_ID,
    process.env.TOTALUM_ENV,
    process.env.TOTALUM_USAGE_ENV,
    process.env.TURSO_DATABASE_URL ?? 'd1',
    key,
  ].join('|');
  const now = Date.now();
  const entry = kept.get(k) ?? {};
  if (entry.value && now < entry.value.until) {
    keep(k, entry); // most recently used
    return structuredClone(entry.value.v) as T;
  }
  if (entry.pending) return entry.pending.then((v) => (copy(v) ?? { v: read() }).v) as Promise<T>;
  const ms = Number.isFinite(seconds) ? Math.min(MAX_MS, Math.max(1_000, seconds * 1_000)) : 1_000;
  const pending = Promise.resolve()
    .then(read)
    .then(
      (v) => {
        if (kept.get(k)?.pending === pending) keep(k, { value: stored(v, now, now + ms) });
        return v;
      },
      (error: unknown) => {
        const last = entry.value && Date.now() - entry.value.at <= STALE_MS ? entry.value : undefined;
        if (kept.get(k)?.pending === pending) keep(k, { value: last });
        if (!last) throw error;
        console.warn(JSON.stringify({ event: 'cached_read_stale', key, error: String(error).slice(0, 200) }));
        return structuredClone(last.v) as T;
      },
    );
  keep(k, { ...entry, pending });
  return pending;
}

async function shareable(): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return false;
  try {
    const h = await headers();
    return !h.has('next-action') && !h.has('authorization') && !FRESH_COOKIE.test(h.get('cookie') ?? '');
  } catch {
    return false; // outside a request (cron, script): nothing to share with
  }
}

const copy = (v: unknown): { v: unknown } | undefined => {
  try {
    return { v: structuredClone(v) };
  } catch {
    return undefined;
  }
};

function stored(v: unknown, at: number, until: number): Kept['value'] {
  const c = copy(v);
  if (!c) return undefined;
  let size: number;
  try {
    // `undefined` has no JSON: its `.length` throws and it is not kept, like anything JSON cannot measure
    size = JSON.stringify(c.v, (_, x: unknown) => (typeof x === 'bigint' ? String(x) : x)).length;
  } catch {
    return undefined;
  }
  return size > MAX_VALUE_BYTES ? undefined : { v: c.v, at, until, bytes: size };
}

function keep(key: string, entry: Kept): void {
  const old = kept.get(key);
  if (old) {
    bytes -= old.value?.bytes ?? 0;
    kept.delete(key);
  }
  if (!entry.value && !entry.pending) return;
  bytes += entry.value?.bytes ?? 0;
  kept.set(key, entry);
  for (const [k, e] of kept) {
    if (kept.size <= MAX_KEYS && bytes <= MAX_BYTES) break;
    bytes -= e.value?.bytes ?? 0;
    kept.delete(k);
  }
}
