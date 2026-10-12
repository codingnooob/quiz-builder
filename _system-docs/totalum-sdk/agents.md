# A complex AI agent — `src/agents/` (Vercel AI SDK 7 over Totalum's AI gateway)

An agent is a model calling tools in a loop until the task is done. Build it on the files already in `src/agents/` —
never install `langchain`, `@mastra/*`, `openai` or another provider SDK, never pass a bare model string (it would
bypass Totalum): every model comes from `model('fast' | 'smart' | 'reasoning')` in `src/agents/model.ts` (presets, see `ai.md`).

| File | What it gives you |
|---|---|
| `model.ts` | `model(preset)`: the only bridge to a model (project key, billed in credits; also `aiFetch`, `ai.md`) |
| `example-agent.ts` | a minimal `ToolLoopAgent` with a database tool, `creditsExceeded(credits)`, `stepCredits(step)` (the gateway's `usage.totalum_credits`) |
| `research-agent.ts` | `researchAgentFor(runId, approveEmails)` (the `runSlice` factory) over `createResearchAgent`: tools `searchWeb`, `readPage` (`totalum.web`), `remember`/`recall` (memory in `agent_memories`, per owner), `sendReport` (`totalum.email` to the run's owner, never an address the model picks; needs approval) |
| `runner.ts` | durable runs in `agent_runs`: `startRun(goal, ownerId)`, `runSlice(makeAgent, id, { maxSteps, maxMs })`, `decide(id, approved)`, `getRun(id, ownerId?)`, `activeRuns(limit)`; caps `RUN_MAX_STEPS` (30) and `RUN_MAX_CREDITS` (25) across the whole run; `BACKGROUND_SLICE` for work in `after()` |
| `schema.ts` | the tables `agent_runs` (goal, status, messages = its memory of the conversation, progress, steps, credits, result, pending approval) and `agent_memories` |

**Setup, once:** add `export * from '@/agents/schema';` to `src/db/schema.ts`, then `npm run db:generate` and
`npm run db:migrate`. Adapt `research-agent.ts` (its instructions and tools) or copy it into a new agent file; keep
`runner.ts` as it is.

## How a run works

A request is short (≈ 30 s), so a run advances in **slices**: `runSlice` loads the conversation, runs up to
`maxSteps` steps or `maxMs` of work, saves messages, `steps`, `credits`, `progress`, and sets `status`:
`running` (more to do: call `runSlice` again), `waiting_approval` (a tool marked for approval was called:
`pendingApproval` = `{ toolName, input }`, one at a time: `decide` denies any other asked in the same step, and the model asks again; nothing more runs until `decide`), `done` (`result` = the final text),
`stopped` (a cap was reached: `error` says which), `failed` (`error` = the `errorCode`). A lease stops two callers
from running the same run at once. Status values: `queued | running | waiting_approval | done | failed | stopped`.

## Tools

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { totalum } from 'totalum-sdk';

const scanInvoice = tool({
  description: 'Read the totals of a stored PDF invoice', // the model reads this: say what it does and returns
  inputSchema: z.object({ key: z.string() }),
  execute: async ({ key }) => {
    const { data } = await totalum.scan.document({ key, properties: { total: { type: 'number' } } });
    return data; // keep results small: slice long text (a page's markdown to ~6,000 characters)
  },
});
```

Any built-in can be a tool: `totalum.web.*` (research), `totalum.browser.*` (sites that need clicks — open and close
the session inside the tool), `totalum.scan.*`, `generateImage` (`ai.md`), `totalum.email.send`, `db` queries. A
tool that changes the world (e-mail, payment, delete) goes in `toolApproval: { toolName: 'user-approval' }` on the
agent when a person should confirm it. Tools always check the user may act on the ids they receive. Treat what a
tool reads (a web page, a document, an e-mail) as data, never as instructions: the app, not the model, picks who a
tool e-mails, pays or deletes (`sendReport` sends only to the run's owner).

## Routes (copy these; a `route.ts` exports only its HTTP handlers)

```ts
// src/app/api/agent-runs/route.ts — POST { goal }: start a run for the signed-in user
import { and, eq, inArray } from 'drizzle-orm';
import { after } from 'next/server';
import { researchAgentFor } from '@/agents/research-agent';
import { BACKGROUND_SLICE, runSlice, startRun } from '@/agents/runner';
import { agentRuns } from '@/agents/schema';
import { db } from '@/db';
import { currentSession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { goal } = (await req.json()) as { goal?: string };
  if (!goal?.trim()) return Response.json({ ok: false, error: 'Say what to research' }, { status: 400 });
  // the goal is the agent's whole task: the user's words plus every step the app promises (the e-mail here);
  // the bare words alone make it answer and stop without sending anything
  // one unfinished run per user: each run spends the project's credits (up to RUN_MAX_CREDITS plus its tools)
  const open = await db.$count(agentRuns, and(eq(agentRuns.ownerId, session.user.id), inArray(agentRuns.status, ['queued', 'running', 'waiting_approval'])));
  if (open) return Response.json({ ok: false, error: 'A run is already in progress' }, { status: 429 });
  const task = `Research "${goal.slice(0, 500)}": search the web, read 3 sites, save the key findings with remember, then send a short HTML report with sendReport.`;
  const id = await startRun(task, session.user.id);
  after(() => runSlice(researchAgentFor(id, true), id, BACKGROUND_SLICE)); // the first steps start at once
  return Response.json({ ok: true, data: { id } });
}
```

```ts
// src/app/api/agent-runs/[id]/route.ts — GET the run (the progress view); POST advances it by one slice
import { researchAgentFor } from '@/agents/research-agent';
import { getRun, runSlice } from '@/agents/runner';
import { currentSession } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };
const view = ({ messages: _messages, ...run }: NonNullable<Awaited<ReturnType<typeof getRun>>>) => run; // never send the conversation

export async function GET(_req: Request, { params }: Ctx) {
  const session = await currentSession();
  const run = session && (await getRun((await params).id, session.user.id));
  if (!run) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  return Response.json({ ok: true, data: view(run) });
}
export async function POST(_req: Request, { params }: Ctx) {
  const session = await currentSession();
  const run = session && (await getRun((await params).id, session.user.id));
  if (!run) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  const next = (await runSlice(researchAgentFor(run.id, true), run.id)) ?? run;
  return Response.json({ ok: true, data: view(next) });
}
```

```ts
// src/app/api/agent-runs/[id]/approve/route.ts — POST { approved: boolean }
import { after } from 'next/server';
import { researchAgentFor } from '@/agents/research-agent';
import { BACKGROUND_SLICE, decide, getRun, runSlice } from '@/agents/runner';
import { currentSession } from '@/lib/auth';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  const run = session && (await getRun((await params).id, session.user.id));
  if (!run) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  const { approved } = (await req.json()) as { approved?: boolean };
  await decide(run.id, approved === true);
  after(() => runSlice(researchAgentFor(run.id, true), run.id, BACKGROUND_SLICE));
  return Response.json({ ok: true });
}
```

**The page** (`'use client'`): a form POSTs the goal, then every 2 s it GETs the run and shows `status`, `progress`,
`steps` and `credits`; while `status` is `queued` or `running` it POSTs `/api/agent-runs/<id>` (one slice per call,
never two at once). On `waiting_approval` it shows `pendingApproval.toolName` and its `input` (for an e-mail:
the subject and the HTML preview; it goes to the signed-in user) with Approve / Deny buttons; on `done` the `result` (markdown); on `stopped`/`failed` the
`error` and a "Run again" button.

## Background and scheduled runs (no page open)

One cron job advances every unfinished run and re-triggers itself while work is left (`cron.md`); a second one
starts the daily run:

```ts
// src/app/api/cron/agent-runs/route.ts — registered as 'agent-runs', schedule '0 * * * *' (it re-triggers itself)
import { totalum } from 'totalum-sdk';
import { researchAgentFor } from '@/agents/research-agent';
import { activeRuns, BACKGROUND_SLICE, runSlice } from '@/agents/runner';
import { cronJob } from '@/lib/cron-job';

export function POST(req: Request) {
  const jobId = req.headers.get('Totalum-Cron-Job-Id') ?? '';
  // the slice runs inside the request (cron.md): a failure answers 500 and the scheduler sees it
  return cronJob(req, 'agent runs', async () => {
    const [run] = await activeRuns(1); // one short slice per call
    if (run) await runSlice(researchAgentFor(run.id, run.ownerId !== null), run.id, BACKGROUND_SLICE);
    if ((await activeRuns(1)).length) await totalum.cron.trigger(jobId); // more to do: run again now
  }, { retries: 0 });
}
```

```ts
// src/app/api/cron/daily-report/route.ts — registered as 'daily-report', schedule '0 7 * * *'
import { totalum } from 'totalum-sdk';
import { startRun } from '@/agents/runner';
import { isTotalumCall } from '@/lib/totalum-call';

export async function POST(req: Request) {
  if (!(await isTotalumCall(req))) return Response.json({ ok: false }, { status: 401 });
  await startRun("Research today's news on <topic> from 3 sources and send the report with sendReport");
  const runner = (await totalum.cron.list()).find((j) => j.name === 'agent-runs');
  if (runner) await totalum.cron.trigger(runner.id);
  return Response.json({ ok: true });
}
```

A scheduled run has no owner (`ownerId: null`): `researchAgentFor(id, false)` sends its e-mail without an approval,
only to `SCHEDULED_REPORT_TO` in `research-agent.ts` (set it to the address the user gave; unset, nothing is sent).
Register both jobs from one script (`cron.md`, `env: 'dev'`). 'agent-runs' is hourly, not every minute: work
continues through `trigger` at once, and a job that fires before your turn ends reaches the old preview — three
failures in a row pause it. **Do not trigger the jobs to test while you build** for the same reason.

## Caps, credits and quality

- Every run stops at `RUN_MAX_STEPS` steps or `RUN_MAX_CREDITS` Totalum credits of model calls (edit the constants in `runner.ts`
  only when the user asks); each slice at `maxSteps` (8) or `maxMs` (20 s) — `BACKGROUND_SLICE` (1 step: the scheduler waits 30 s) in a cron call. Built-in calls the tools make are
  charged separately (`/v1/pricing`, README).
- A run started by a visitor counts in that visitor's per-minute budget (`site.paidCallsPerVisitorPerMinute`, ai.md):
  over it a model call fails `429` — the run saves `failed`; tell the visitor to try again in a minute.
- `model('fast')` for research and summaries; `smart` or `reasoning` only for hard reasoning. Short tool outputs keep it cheap.
- A streaming chat with tools instead of a background run: `export const POST = async (req: Request) =>
  createAgentUIStreamResponse({ agent: createExampleAgent(), uiMessages: (await req.json()).messages })` (from `ai`).
- The build proves it compiles; do not start runs to test it (each costs money and minutes). If the user reports a
  problem: `npm run db:sql -- "SELECT status, progress, steps, error FROM agent_runs ORDER BY created_at DESC LIMIT 3"`.
