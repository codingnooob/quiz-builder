import { isStepCount, ToolLoopAgent, tool } from 'ai';
import type { StopCondition, ToolSet } from 'ai';
import { gte } from 'drizzle-orm';
import { z } from 'zod';

import { model } from './model';

import { db } from '@/db';
import { users } from '@/db/schema';

// Plan 06 §17b (A5.19, A5.27): an opt-in AI agent (Vercel AI SDK 7). Nothing imports it, so it costs the app nothing
// until a route does — copy and adapt it: tools over the project's own `db` and `totalum-sdk`, and a step and cost
// ceiling in credits on every run. A long, background or approved run: `research-agent.ts` + `runner.ts` (agents.md).
// A streaming chat route:
//   export const POST = async (req: Request) =>
//     createAgentUIStreamResponse({ agent: createExampleAgent(), uiMessages: (await req.json()).messages });  // from 'ai'

export const MAX_STEPS = 20;
export const MAX_CREDITS = 50;

/**
 * The gateway answers each model call with the Totalum credits it charged (`usage.totalum_credits`; it never shows
 * tokens or a cost), which the AI SDK keeps as `step.usage.raw`; a run stops once the sum reaches the ceiling.
 */
export const stepCredits = (step: { usage?: { raw?: unknown } }) =>
  (step.usage?.raw as { totalum_credits?: number } | undefined)?.totalum_credits ?? 0;
export const creditsExceeded =
  <T extends ToolSet>(maxCredits = MAX_CREDITS): StopCondition<T> =>
  ({ steps }) =>
    steps.reduce((sum, step) => sum + stepCredits(step), 0) >= maxCredits;

const tools = {
  countSignups: tool({
    description: 'How many users signed up since a date',
    inputSchema: z.object({ since: z.iso.datetime() }),
    execute: async ({ since }) => ({
      since,
      count: await db.$count(users, gte(users.createdAt, new Date(since))),
    }),
  }),
};

// per request: the gateway URL and key are read when the agent is built
export const createExampleAgent = () =>
  new ToolLoopAgent({
    model: model('smart'),
    instructions:
      "You answer the owner's questions about this app's users. Use the tools; never guess numbers.",
    tools,
    stopWhen: [isStepCount(MAX_STEPS), creditsExceeded()],
  });
