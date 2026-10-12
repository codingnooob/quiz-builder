# Scheduled jobs — `totalum.cron`

Totalum's scheduler calls a route of this project on a cron `schedule` (5 fields: `'0 8 * * *'` = 08:00 every day,
UTC unless the job has a `timezone`) or `{ everyMinutes: 15 }`. A job is data at Totalum, not code: register it once from a script. Never use
`node-cron`, `setInterval`, `setTimeout` loops or a Vercel cron — nothing keeps running in a Worker between requests.

<!-- totalum-sdk:signatures cron -->
| Call | Returns |
|---|---|
| `totalum.cron.create({ name, schedule, request, enabled?, description?, env?: 'dev' \| 'live', timezone?, pauseAfterFailures? })` | `{ id, name, schedule, request, enabled, status: 'active' \| 'paused' \| 'paused_failures', nextRunAt, createdAt, env: 'dev' \| 'live', pauseAfterFailures, lastRun?, description?, timezone? }` |
| `totalum.cron.list()` | `[{ id, name, schedule, request, enabled, status: 'active' \| 'paused' \| 'paused_failures', nextRunAt, createdAt, env: 'dev' \| 'live', pauseAfterFailures, lastRun?, description?, timezone? }]` |
| `totalum.cron.get(id)` | `{ id, name, schedule, request, enabled, status: 'active' \| 'paused' \| 'paused_failures', nextRunAt, createdAt, env: 'dev' \| 'live', pauseAfterFailures, lastRun?, description?, timezone? }` |
| `totalum.cron.update(id, { name?, schedule?, request?, enabled?, description?, env?: 'dev' \| 'live', timezone?, pauseAfterFailures? })` | `{ id, name, schedule, request, enabled, status: 'active' \| 'paused' \| 'paused_failures', nextRunAt, createdAt, env: 'dev' \| 'live', pauseAfterFailures, lastRun?, description?, timezone? }` |
| `totalum.cron.delete(id)` | — |
| `totalum.cron.pause(id)` | `{ id, name, schedule, request, enabled, status: 'active' \| 'paused' \| 'paused_failures', nextRunAt, createdAt, env: 'dev' \| 'live', pauseAfterFailures, lastRun?, description?, timezone? }` |
| `totalum.cron.resume(id)` | `{ id, name, schedule, request, enabled, status: 'active' \| 'paused' \| 'paused_failures', nextRunAt, createdAt, env: 'dev' \| 'live', pauseAfterFailures, lastRun?, description?, timezone? }` |
| `totalum.cron.runs(id, { limit?, cursor? })` | `{ items, nextCursor }` |
| `totalum.cron.trigger(id)` | `{ runId }` |
<!-- /totalum-sdk:signatures -->

- `request: { method: 'POST' | 'GET', url, headers?, body?, timeoutMs?: ≤ 30000 }` on this project's own host; pass
  `env: 'dev'` while building.
- `timezone`: an IANA zone (`'Europe/Madrid'`, `'America/New_York'`). A job at a local hour (“every day at 9 in the
  morning”, “Mondays at 08:30”) always sets it to the user's zone and writes the local time in `schedule`
  (`'0 9 * * *'`) — never convert to UTC by hand: the scheduler keeps it at 09:00 local through daylight-saving
  changes. Without `timezone` the schedule is UTC. `{ everyMinutes }` ignores it.
- `pauseAfterFailures`: how many failed runs in a row pause the job (1–100, default 3). `null` = never pause (for a job
  that may fail for a while and must keep trying, e.g. polling a flaky provider); the owner is then told once after 10
  failures in a row. Use the default unless the user asks otherwise. `get` returns `null` for a job that is not this project's; `trigger` fires a job now
  (to continue a long task in steps); `runs` lists the last executions (30 days).

Limits: the shortest interval is 1 hour on the Free plan and 1 minute on paid plans (`INVALID_SCHEDULE`
`{ minIntervalSeconds }`); jobs per environment (dev and live each): Free 2, Starter 10, others 20
(`CRON_LIMIT_REACHED`), so every dev job gets its live twin at publish. A job failing `pauseAfterFailures` runs in a row
(3 by default) is paused and the owner is told. Each run costs a tiny amount of credits (its scheduling and the request); what the route calls is charged as usual.

## Recipe — a daily job

1. The work: `src/app/api/cron/<name>/route.ts` exporting `POST` through `cronJob` (`src/lib/cron-job.ts`). It does
   the work **inside the request** and answers with the outcome: `200 { ok: true, result }`, or `500 { ok: false,
   error }` with the error's message, which the job's `runs` and the log keep. Three failures in a row pause the job and
   tell the owner — so a job that fails is never shown as healthy. Never answer first and work in `after()`: the
   scheduler would record success whatever happens. `cronJob` also refuses a call Totalum did not send (the URL is
   public; `isTotalumCall` checks the signature every scheduler call carries, an unsigned call is always refused on the
   live site), stops the work at 25 s (the scheduler waits 30 s; pass `signal` to `fetch`) and tries it once more on a
   failure, so the work must be safe to repeat (else `{ retries: 0 }`). Headers: `Totalum-Cron-Job-Id` names the job
   (for `trigger`), `Totalum-Cron-Run-Id` the run and `Totalum-Scheduled-For` the scheduled time (ISO, UTC):

   ```ts
   import { cronJob } from '@/lib/cron-job';

   export function POST(req: Request) {
     // read the database, call built-ins (with `signal` on fetch), save the results; throw on any failure
     return cronJob(req, 'daily report', (signal) => sendDailyReport(signal));
   }
   ```

   `after()` is only for optional extras whose failure must not fail the job (a cache warm-up, an analytics ping).

2. Register it once, from the sandbox, with `scripts/cron-<name>.ts`, then run `npx tsx scripts/cron-<name>.ts`:

   ```ts
   import { totalum } from 'totalum-sdk';

   const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/cron/<name>`; // the preview's own host
   const jobs = await totalum.cron.list();
   const job =
     jobs.find((j) => j.name === '<name>') ??
     (await totalum.cron.create({
       name: '<name>',
       env: 'dev',
       schedule: '0 8 * * *', // 08:00 local
       timezone: 'Europe/Madrid', // the user's zone
       request: { method: 'POST', url },
     }));
   console.log(job.id);
   ```

   Always `env: 'dev'` and the preview URL — never the live one (`CRON_REQUIRES_PUBLISHED_PROJECT`). Publishing
   creates the live job itself: each dev job gets a live twin of the same name on the published host, and every later
   publish carries the dev job's changes to it (schedule, route, `timezone`, `pauseAfterFailures`, paused or resumed)
   and deletes it when the dev job was deleted — so change and delete the dev job, never a live one (the live jobs are
   refused `LIVE_CRON_READ_ONLY` unless the user's message asks for production). A job the user paused does not go
   live. The preview gets
   this turn's code only after you finish: a run before that reaches the old version and fails, and three failures in
   a row pause the job (`status: 'paused_failures'`; `totalum.cron.resume(id)`). So never trigger it to test now, and
   for a job every 1–2 minutes create it with `enabled: false` and `resume` it from the app's first request that
   needs it.
   To test the route, run the app (`npm run dev`, where no signature is needed) and `curl -X POST
   localhost:3100/api/cron/<name>`.

Work longer than ~30 s (a crawl, an agent run, many e-mails) is done in steps: each call does one step, saves its
progress in the database and, while work is left, calls `totalum.cron.trigger(jobId)` to run again at once
(`agents.md`).

Errors: `INVALID_SCHEDULE`, `CRON_LIMIT_REACHED` (429), `CRON_URL_NOT_ALLOWED` (a URL outside this project's
hosts), `CRON_REQUIRES_PUBLISHED_PROJECT` (use `env: 'dev'`), `CRON_JOB_NOT_FOUND`, `LIVE_CRON_READ_ONLY` (work on the
dev job; publishing carries it live), `VALIDATION_ERROR` (an unknown `timezone`, `pauseAfterFailures` outside 0–100).
