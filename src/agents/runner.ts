import { isStepCount } from 'ai';
import type { ModelMessage, StopCondition, ToolApprovalRequestOutput, ToolSet } from 'ai';
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import { creditsExceeded, stepCredits } from './example-agent';
import { agentRuns } from './schema';

import { db } from '@/db';

// A durable agent run (A5.27; `_system-docs/totalum-sdk/agents.md`): a Worker request is short, so a run advances in
// slices — each loads the conversation from `agent_runs`, runs a few steps, and saves it back with its progress. A
// route, the page or a cron job calls `runSlice` until the run is `done`; a tool that needs a person stops the run at
// `waiting_approval` until `decide`. The step and credit caps hold across slices.

export const RUN_MAX_STEPS = 30;
export const RUN_MAX_CREDITS = 25;
/**
 * A slice run in `after()` or a cron call: Cloudflare cancels work after the response at ~30 s, and one step (a model
 * call and its tools: a search, a page read) can take 10–20 s, so one step per call.
 */
export const BACKGROUND_SLICE = { maxSteps: 1, maxMs: 8_000 };

type Run = typeof agentRuns.$inferSelect;
/** Builds the agent for one slice with the stop conditions the runner computes (steps and credits left, time). */
export type AgentFactory = (stopWhen: StopCondition<ToolSet>[]) => {
  generate(call: { messages: ModelMessage[] }): Promise<SliceOutput>;
};
/** What a slice reads of `agent.generate()`'s result. */
interface SliceOutput {
  /** every message of the call: an approved tool's output (run before the first step) and each step's */
  responseMessages: ModelMessage[];
  steps: {
    toolCalls: { toolName: string }[];
    usage?: Parameters<typeof stepCredits>[0]['usage'];
  }[];
  content: { type: string }[];
  finishReason: string;
  text: string;
}

const now = () => new Date().toISOString();

export async function startRun(goal: string, ownerId: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(agentRuns).values({
    id,
    ownerId,
    goal,
    messages: [{ role: 'user', content: goal }],
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

/** The run; with `ownerId`, only when that user started it (a route passes the signed-in user's id). */
export async function getRun(id: string, ownerId?: string): Promise<Run | undefined> {
  const mine = ownerId === undefined ? undefined : eq(agentRuns.ownerId, ownerId);
  return db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, id), mine))
    .get();
}

/** Runs up to `maxSteps` steps or `maxMs` of work of a `queued`/`running` run, then saves where it got to. */
export async function runSlice(
  makeAgent: AgentFactory,
  id: string,
  { maxSteps = 8, maxMs = 20_000 } = {},
): Promise<Run | undefined> {
  // the lease: a second caller meanwhile (the page and the cron at once) gets the run back untouched
  const claimed = (await db
    .update(agentRuns)
    .set({
      status: 'running',
      leaseUntil: new Date(Date.now() + maxMs + 60_000).toISOString(),
      updatedAt: now(),
    })
    .where(and(eq(agentRuns.id, id), inArray(agentRuns.status, ['queued', 'running']), free()))
    .returning()
    .get()) as Run | undefined; // no row when another slice holds the lease
  if (!claimed) return getRun(id);
  const started = Date.now();
  const agent = makeAgent([
    isStepCount(Math.max(1, Math.min(maxSteps, RUN_MAX_STEPS - claimed.steps))),
    creditsExceeded(RUN_MAX_CREDITS - claimed.credits),
    () => Date.now() - started > maxMs,
  ]);
  try {
    const out = await agent.generate({ messages: claimed.messages });
    const messages: ModelMessage[] = [...claimed.messages, ...out.responseMessages];
    const steps = claimed.steps + out.steps.length;
    const credits = claimed.credits + out.steps.reduce((sum, s) => sum + stepCredits(s), 0);
    const approvals = out.content.filter(
      (p) => p.type === 'tool-approval-request',
    ) as ToolApprovalRequestOutput<ToolSet>[];
    const approval = approvals.at(0);
    const others = approvals.slice(1);
    const last = out.steps.at(-1);
    const lastTool = last?.toolCalls.at(-1)?.toolName;
    const base = {
      messages,
      steps,
      credits,
      updatedAt: now(),
      progress: lastTool ? `used ${lastTool}` : 'thinking',
    };
    if (approval)
      return await save(id, {
        ...base,
        status: 'waiting_approval',
        progress: `waiting for approval: ${approval.toolCall.toolName}`,
        pendingApproval: {
          approvalId: approval.approvalId,
          toolName: approval.toolCall.toolName,
          input: approval.toolCall.input,
          ...(others.length ? { others: others.map((o) => o.approvalId) } : {}),
        },
      });
    if (out.finishReason === 'stop' && !last?.toolCalls.length)
      return await save(id, { ...base, status: 'done', progress: 'done', result: out.text });
    if (steps >= RUN_MAX_STEPS || credits >= RUN_MAX_CREDITS)
      return await save(id, {
        ...base,
        status: 'stopped',
        error:
          steps >= RUN_MAX_STEPS
            ? `step cap (${String(RUN_MAX_STEPS)})`
            : `credit cap (${String(RUN_MAX_CREDITS)} credits)`,
      });
    return await save(id, base); // more to do: the next slice continues from here
  } catch (err) {
    const code = (err as { errorCode?: string }).errorCode;
    return save(id, { status: 'failed', error: code ?? String(err), updatedAt: now() });
  }
}

/**
 * A person's answer to the pending approval; the next slice runs (or skips) the tool call. Every approval of the step
 * needs an answer (the model API refuses a tool call without one): the ones the person never saw are denied.
 */
export async function decide(id: string, approved: boolean, reason?: string): Promise<Run | undefined> {
  const run = await getRun(id);
  if (run?.status !== 'waiting_approval' || !run.pendingApproval) return run;
  const unseen = 'Not shown to the person: ask for it again, one at a time';
  const answer: ModelMessage = {
    role: 'tool',
    content: [
      { type: 'tool-approval-response', approvalId: run.pendingApproval.approvalId, approved, reason },
      ...(run.pendingApproval.others ?? []).map((approvalId) => ({
        type: 'tool-approval-response' as const,
        approvalId,
        approved: false,
        reason: unseen,
      })),
    ],
  };
  return save(id, {
    status: 'running',
    pendingApproval: null,
    messages: [...run.messages, answer],
    progress: approved ? 'approved' : 'denied',
    updatedAt: now(),
  });
}

/** Unfinished runs no slice is running now, oldest first — what a cron job advances by one slice each. */
export async function activeRuns(limit = 3): Promise<Run[]> {
  return db
    .select()
    .from(agentRuns)
    .where(and(inArray(agentRuns.status, ['queued', 'running']), free()))
    .orderBy(agentRuns.updatedAt)
    .limit(limit)
    .all();
}

const free = () => or(isNull(agentRuns.leaseUntil), lt(agentRuns.leaseUntil, now()));

const save = (id: string, set: Partial<Run>) =>
  db
    .update(agentRuns)
    .set({ ...set, leaseUntil: null })
    .where(eq(agentRuns.id, id))
    .returning()
    .get();
