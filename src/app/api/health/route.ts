import { isTotalumError, totalum } from 'totalum-sdk';

import { isTotalumCall } from '@/lib/totalum-call';

// The reachability probe of AM and PGM (plan 06 §17 #7). With `?integrations=1` it is also PGM's post-deploy check that
// this Worker reaches Totalum's built-in integrations with its own key (research 45: pages rendered while every
// upload, e-mail and real-time call failed): one short-lived real-time ticket, never returned — only for PGM's signed
// call, since each ticket spends the project's real-time budget (review 57 R4).
export async function GET(request: Request) {
  const env = process.env.TOTALUM_ENV ?? null;
  if (!new URL(request.url).searchParams.has('integrations') || !(await isTotalumCall(request)))
    return Response.json({ ok: true, env });
  try {
    await totalum.realtime.ticket({ room: 'totalum-health', identity: { id: 'totalum-probe' }, ttl: 5 });
    return Response.json({ ok: true, env, integrations: { ok: true } });
  } catch (err) {
    const code = isTotalumError(err) ? err.errorCode : 'UNKNOWN';
    const status = isTotalumError(err) ? err.status : 0;
    return Response.json({ ok: true, env, integrations: { ok: false, code, status } });
  }
}
