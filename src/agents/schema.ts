import type { ModelMessage } from 'ai';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// The durable agent's tables (A5.27; `_system-docs/totalum-sdk/agents.md`). Opt-in: to use them add
// `export * from '@/agents/schema';` to src/db/schema.ts, then `npm run db:generate` and `npm run db:migrate`.

export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
  'done',
  'failed',
  'stopped',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** One agent run: its goal, the whole conversation (its working memory), progress, caps spent and the outcome. */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text().primaryKey(),
    ownerId: text(), // the user who started it, or null for a scheduled run
    goal: text().notNull(),
    status: text({ enum: AGENT_RUN_STATUSES }).notNull().default('queued'),
    messages: text({ mode: 'json' }).$type<ModelMessage[]>().notNull(),
    /** Set while `status` is `waiting_approval`: the tool call a person must approve or deny. */
    pendingApproval: text({ mode: 'json' }).$type<{
      approvalId: string;
      toolName: string;
      input: unknown;
      /** more approvals asked in the same step: never shown, so `decide` denies them (the model asks again) */
      others?: string[];
    }>(),
    steps: integer().notNull().default(0),
    credits: real().notNull().default(0), // the Totalum credits the run's model calls were charged
    progress: text(), // the last step, in words, for the progress view
    /** While a slice runs: no second caller (the page and the cron at once) runs the same run. */
    leaseUntil: text(),
    result: text(),
    error: text(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
  },
  (t) => [index('agent_runs_status_idx').on(t.status), index('agent_runs_owner_id_idx').on(t.ownerId)],
);

/** Long-term memory the agent writes and reads with its tools, across one owner's runs (null: scheduled runs). */
export const agentMemories = sqliteTable(
  'agent_memories',
  {
    id: text().primaryKey(),
    ownerId: text(),
    topic: text().notNull(),
    content: text().notNull(),
    runId: text(),
    createdAt: text().notNull(),
  },
  (t) => [index('agent_memories_owner_id_topic_idx').on(t.ownerId, t.topic)],
);
