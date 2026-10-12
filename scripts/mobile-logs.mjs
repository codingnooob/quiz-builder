// `npm run mobile:logs` (A7.10 amendment 2026-09-28): the newest mobile build when it failed — its error and the tail
// of its Codemagic log — from Totalum, so "the mobile build fails" needs no pasted log. `npm run mobile:status`
// (A7.10b): the newest builds and, while one waits for the build servers, its place in the queue. Read-only, free.
import { pathToFileURL } from 'node:url';

/**
 * One line per fact, then the log; `null` data prints that the latest build did not fail.
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} fetchImpl
 */
export async function mobileLogs(env = process.env, fetchImpl = fetch) {
  const f = await get(env, fetchImpl, '/v1/mobile/build-failure');
  if (!f) return 'The latest mobile build did not fail (or there is none).';
  return [
    `Mobile build ${f.buildId} (${f.platform}, ${f.artifact}) failed at ${f.finishedAt}: ${f.error.code} — ${f.error.message}`,
    '--- log (tail) ---',
    f.log || '(no log)',
  ].join('\n');
}

/**
 * One line per recent build: status (with the queue position while it waits), platform, artefact, times.
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string>}
 */
export async function mobileStatus(env = process.env, fetchImpl = fetch) {
  const { builds } = await get(env, fetchImpl, '/v1/mobile/builds');
  if (!builds.length) return 'No mobile build yet.';
  return builds
    .map((b) =>
      [
        b.id,
        b.queuePosition ? `queued (position ${String(b.queuePosition)})` : b.status,
        b.platform,
        b.artifact?.type ?? '',
        b.error ? `${b.error.code}: ${b.error.message}` : (b.finishedAt ?? b.startedAt ?? ''),
      ]
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n');
}

async function get(env, fetchImpl, path) {
  const key = env.TOTALUM_PROJECT_KEY;
  if (!key) throw new Error('TOTALUM_PROJECT_KEY is not set');
  const res = await fetchImpl(`${env.TOTALUM_SDK_API_URL || 'https://sdk-api.totalum.app'}${path}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.errors?.errorMessage ?? `HTTP ${String(res.status)}`);
  return body?.data;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    console.log(await (process.argv.includes('--status') ? mobileStatus() : mobileLogs()));
  } catch (err) {
    console.error(
      `mobile:${process.argv.includes('--status') ? 'status' : 'logs'} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}
